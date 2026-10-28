"""Event-driven daily backtester.

Rules:
- Signals are evaluated on the close of session t using causal indicators.
- Orders execute at the open of session t+1 (never at the signal close).
- Commission, slippage and half-spread are charged on both sides.
- Stops and take-profits are evaluated on closes and executed at the next open;
  this is conservative about intrabar assumptions and disclosed in the report.
- Long-only, integer shares, no leverage, no shorting.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session as DbSession

from ..analytics.indicators import atr_pct, bollinger, drawdown_duration, macd, max_drawdown, rsi, sma
from ..marketdata.service import get_history, normalize_symbol
from ..models import Backtest, BacktestTrade, Strategy
from ..ml.validation import to_builtin


def _indicator_series(frame: pd.DataFrame, name: str, params: dict) -> pd.Series:
    close = frame["adj_close"].astype(float)
    high = frame["high"].astype(float)
    low = frame["low"].astype(float)
    volume = frame["volume"].astype(float)
    if name == "price":
        return close
    if name == "sma":
        return sma(close, int(params.get("window", 20)))
    if name == "ema":
        from ..analytics.indicators import ema

        return ema(close, int(params.get("window", 20)))
    if name == "price_vs_sma":
        window = int(params.get("window", 50))
        return close / sma(close, window) - 1
    if name == "rsi":
        return rsi(close, int(params.get("window", 14)))
    if name == "macd_hist":
        return macd(close)["hist"]
    if name == "bb_pctb":
        return bollinger(close, int(params.get("window", 20)))["pctb"]
    if name == "atr_pct":
        return atr_pct(high, low, close, int(params.get("window", 14)))
    if name == "momentum":
        window = int(params.get("window", 63))
        return close.pct_change(window)
    if name == "breakout_high":
        window = int(params.get("window", 20))
        return close / close.rolling(window, min_periods=window).max() - 1
    if name == "volatility":
        window = int(params.get("window", 20))
        return close.pct_change().rolling(window, min_periods=window).std(ddof=0) * np.sqrt(252)
    if name == "volume_ratio":
        avg = volume.rolling(20, min_periods=10).mean()
        return volume / avg - 1
    raise ValueError(f"Unsupported indicator: {name}")


def _rule_mask(series: pd.Series, op: str, value: float | None) -> pd.Series:
    if op in ("cross_above", "cross_below"):
        if value is None:
            raise ValueError("cross_above/cross_below rules require a value")
        if op == "cross_above":
            return (series > value) & (series.shift(1) <= value)
        return (series < value) & (series.shift(1) >= value)
    if value is None:
        raise ValueError("Comparison rules require a value")
    if op == ">":
        return series > value
    if op == ">=":
        return series >= value
    if op == "<":
        return series < value
    if op == "<=":
        return series <= value
    raise ValueError(f"Unsupported operator: {op}")


def evaluate_rules(frame: pd.DataFrame, rules: list[dict], logic: str) -> pd.Series:
    if not rules:
        return pd.Series(False, index=frame.index)
    masks = []
    for rule in rules:
        series = _indicator_series(frame, rule["indicator"], rule.get("params") or {})
        masks.append(_rule_mask(series, rule["op"], rule.get("value")))
    combined = masks[0].fillna(False)
    for mask in masks[1:]:
        combined = (combined & mask.fillna(False)) if logic == "all" else (combined | mask.fillna(False))
    return combined.fillna(False)


def _monthly_returns(equity: pd.Series) -> list[dict]:
    if equity.empty:
        return []
    monthly = equity.resample("ME").last().dropna()
    if len(monthly) < 2:
        return []
    rets = monthly.pct_change().dropna()
    return [{"month": str(idx.date()), "return_pct": round(float(v) * 100, 4)} for idx, v in rets.items()]


def run_backtest(db: DbSession, bt: Backtest, strategy: Strategy) -> dict:
    cfg = bt.config or {}
    rules = strategy.rules or {}
    symbol = normalize_symbol(bt.symbol)
    period = cfg.get("period", "5y")
    history = get_history(db, symbol, period=period, interval="1d")
    frame = history.frame.copy()
    if cfg.get("start"):
        frame = frame[frame.index >= pd.Timestamp(cfg["start"])]
    if cfg.get("end"):
        frame = frame[frame.index <= pd.Timestamp(cfg["end"])]
    if len(frame) < 80:
        raise ValueError(f"Only {len(frame)} bars available after date filtering; at least 80 are required for a meaningful backtest")

    close = frame["adj_close"].astype(float)
    open_ = frame["open"].astype(float)
    entry_signal = evaluate_rules(frame, rules.get("entry") or [], rules.get("entry_logic", "all"))
    exit_signal = evaluate_rules(frame, rules.get("exit") or [], rules.get("exit_logic", "any"))

    commission_bps = float(cfg.get("commission_bps", 2))
    slippage_bps = float(cfg.get("slippage_bps", 5))
    spread_bps = float(cfg.get("spread_bps", 0))
    position_pct = float(cfg.get("position_size_pct") or rules.get("position_size_pct") or 100) / 100
    stop_loss = rules.get("stop_loss_pct")
    take_profit = rules.get("take_profit_pct")
    max_holding = rules.get("max_holding_days")
    stop_loss = float(stop_loss) / 100 if stop_loss else None
    take_profit = float(take_profit) / 100 if take_profit else None

    capital = float(cfg.get("initial_capital", 100_000))
    cash = capital
    qty = 0
    entry_price = 0.0
    entry_fee = 0.0
    entry_date = None
    entry_index = None
    total_fees = 0.0
    traded_notional = 0.0
    trades: list[dict] = []
    equity_values: list[float] = []
    exposure_days = 0

    def buy_cost(price: float) -> float:
        return price * (1 + (slippage_bps + spread_bps / 2) / 10_000)

    def sell_price(price: float) -> float:
        return price * (1 - (slippage_bps + spread_bps / 2) / 10_000)

    for i in range(1, len(frame)):
        current_date = frame.index[i]
        # Act on the previous close's signal at today's open.
        if qty == 0 and bool(entry_signal.iloc[i - 1]):
            exec_price = buy_cost(float(open_.iloc[i]))
            budget = cash * position_pct
            # Reserve commission in the sizing calculation so an all-in order
            # is not rejected by its own costs.
            shares = math.floor(budget / (exec_price * (1 + commission_bps / 10_000))) if exec_price > 0 else 0
            if shares > 0:
                notional = shares * exec_price
                fee = notional * commission_bps / 10_000
                if notional + fee <= cash:
                    cash -= notional + fee
                    total_fees += fee
                    traded_notional += notional
                    qty = shares
                    entry_price = exec_price
                    entry_fee = fee
                    entry_date = current_date
                    entry_index = i
        elif qty > 0:
            prev_close = float(close.iloc[i - 1])
            held = i - 1 - int(entry_index)
            reason = None
            price = sell_price(float(open_.iloc[i]))
            if bool(exit_signal.iloc[i - 1]):
                reason = "exit_signal"
            elif stop_loss is not None and prev_close <= entry_price * (1 - stop_loss):
                reason = "stop_loss"
            elif take_profit is not None and prev_close >= entry_price * (1 + take_profit):
                reason = "take_profit"
            elif max_holding is not None and held >= int(max_holding):
                reason = "max_holding"
            if reason:
                notional = qty * price
                fee = notional * commission_bps / 10_000
                cash += notional - fee
                total_fees += fee
                traded_notional += notional
                total_trade_fees = entry_fee + fee
                pnl = (price - entry_price) * qty - total_trade_fees
                trades.append(
                    {
                        "entry_date": entry_date.date() if hasattr(entry_date, "date") else entry_date,
                        "exit_date": current_date.date(),
                        "side": "long",
                        "quantity": qty,
                        "entry_price": round(entry_price, 6),
                        "exit_price": round(price, 6),
                        "fees": round(total_trade_fees, 6),
                        "pnl": round(pnl, 4),
                        "return_pct": round(pnl / (entry_price * qty) * 100, 5),
                        "exit_reason": reason,
                    }
                )
                qty = 0
                entry_price = 0.0
                entry_fee = 0.0
                entry_date = None
                entry_index = None
        equity = cash + qty * float(close.iloc[i])
        if qty > 0:
            exposure_days += 1
        equity_values.append(equity)

    if qty > 0:
        last_close = float(close.iloc[-1])
        unrealized = (last_close - entry_price) * qty - entry_fee
        trades.append(
            {
                "entry_date": entry_date.date() if hasattr(entry_date, "date") else entry_date,
                "exit_date": None,
                "side": "long",
                "quantity": qty,
                "entry_price": round(entry_price, 6),
                "exit_price": round(last_close, 6),
                "fees": round(entry_fee, 6),
                "pnl": round(unrealized, 4),
                "return_pct": round(unrealized / (entry_price * qty) * 100, 5),
                "exit_reason": "open_at_end",
            }
        )

    equity_index = frame.index[1:]
    equity = pd.Series(equity_values, index=equity_index, dtype=float)
    if equity.empty:
        raise ValueError("Backtest produced no equity observations")
    returns = equity.pct_change().dropna()
    periods = 252
    years = max(len(equity) / periods, 1e-9)
    total_return = float(equity.iloc[-1] / capital - 1)
    cagr = float((equity.iloc[-1] / capital) ** (1 / years) - 1) if equity.iloc[-1] > 0 else None
    vol = float(returns.std(ddof=0) * np.sqrt(periods)) if len(returns) > 1 else 0.0
    downside = returns[returns < 0]
    downside_vol = float(downside.std(ddof=0) * np.sqrt(periods)) if len(downside) > 1 else 0.0
    dd_series = equity / equity.cummax() - 1
    max_dd = float(dd_series.min())
    closed = [t for t in trades if t["exit_reason"] != "open_at_end"]
    wins = [t for t in closed if (t["pnl"] or 0) > 0]
    losses = [t for t in closed if (t["pnl"] or 0) < 0]
    gross_profit = sum(t["pnl"] for t in wins)
    gross_loss = abs(sum(t["pnl"] for t in losses))
    avg_equity = float(equity.mean())

    benchmark_curve: list[float] | None = None
    benchmark_stats: dict = {}
    benchmark_symbol = normalize_symbol(bt.benchmark) if bt.benchmark else ""
    if benchmark_symbol and benchmark_symbol != symbol:
        try:
            bench_hist = get_history(db, benchmark_symbol, period=period, interval="1d")
            bench_close = bench_hist.frame["adj_close"].astype(float).reindex(frame.index).ffill()
            first_price = float(bench_close.iloc[0])
            if first_price > 0:
                bench_entry = buy_cost(first_price)
                bench_qty = math.floor(capital / bench_entry)
                bench_cash = capital - bench_qty * bench_entry
                benchmark_curve = [
                    round(bench_cash + bench_qty * float(bench_close.iloc[i]), 4) for i in range(1, len(frame))
                ]
                bench_series = pd.Series(benchmark_curve, index=equity_index)
                benchmark_stats = {
                    "symbol": benchmark_symbol,
                    "total_return": float(bench_series.iloc[-1] / capital - 1),
                    "max_drawdown": max_drawdown(bench_series),
                    "annualized_volatility": float(bench_series.pct_change().std(ddof=0) * np.sqrt(periods)),
                    "note": "Buy-and-hold benchmark includes the same entry costs, integer shares and no dividends beyond adjusted prices.",
                }
        except Exception as exc:
            benchmark_stats = {"symbol": benchmark_symbol, "error": f"Benchmark unavailable: {str(exc)[:160]}"}

    monthly = _monthly_returns(equity)
    start_equity = [capital] + [float(v) for v in equity.values]
    curve_dates = [str(d.date()) for d in frame.index]
    result = {
        "strategy": {"id": strategy.id, "name": strategy.name, "version": strategy.version},
        "symbol": symbol,
        "currency": history.meta.currency,
        "data": {
            "provider": history.meta.provider,
            "data_status": history.meta.data_status,
            "start": str(frame.index[0].date()),
            "end": str(frame.index[-1].date()),
            "observations": len(frame),
            "price_basis": "adjusted OHLC (splits and dividends incorporated by the provider)",
        },
        "assumptions": {
            "execution": "signal at close t, order at open t+1",
            "commission_bps": commission_bps,
            "slippage_bps": slippage_bps,
            "spread_bps": spread_bps,
            "position_size_pct": position_pct * 100,
            "shares": "integer, long-only, no leverage or shorting",
            "stops": "evaluated on closes, executed at next open; gap risk is not eliminated",
            "risk_free_rate": 0.0,
        },
        "metrics": {
            "initial_capital": capital,
            "final_equity": round(float(equity.iloc[-1]), 4),
            "total_return": total_return,
            "cagr": cagr,
            "annualized_volatility": vol,
            "sharpe_rf_zero": float(returns.mean() / returns.std(ddof=0) * np.sqrt(periods)) if len(returns) > 1 and returns.std(ddof=0) > 0 else None,
            "sortino_rf_zero": float(returns.mean() / downside.std(ddof=0) * np.sqrt(periods)) if len(downside) > 1 and downside.std(ddof=0) > 0 else None,
            "max_drawdown": max_dd,
            "drawdown_duration_days": drawdown_duration(equity),
            "closed_trades": len(closed),
            "win_rate": len(wins) / len(closed) if closed else None,
            "profit_factor": gross_profit / gross_loss if gross_loss > 0 else None,
            "average_win": float(np.mean([t["pnl"] for t in wins])) if wins else None,
            "average_loss": float(np.mean([t["pnl"] for t in losses])) if losses else None,
            "total_fees": round(total_fees, 4),
            "cost_drag_pct_of_initial": round(total_fees / capital * 100, 4),
            "turnover_total": round(traded_notional / avg_equity, 4) if avg_equity else None,
            "exposure_pct": exposure_days / len(equity) * 100,
            "open_position": qty > 0,
            "benchmark": benchmark_stats,
            "excess_vs_benchmark": (total_return - benchmark_stats["total_return"]) if "total_return" in benchmark_stats else None,
            "note": "Historical simulation after modeled costs. Not live performance and not a forecast.",
        },
        "equity": {
            "dates": curve_dates,
            "strategy": [round(float(v), 4) for v in start_equity],
            "benchmark": [capital] + benchmark_curve if benchmark_curve else None,
            "drawdown": [round(float(v), 6) for v in [0.0] + list(dd_series.values)],
        },
        "trades": trades,
        "monthly_returns": monthly,
        "warnings": [
            "Historical simulation, not live trading performance.",
            "Adjusted prices reduce split/dividend distortions but are not a point-in-time execution feed.",
            "Results are sensitive to the chosen dates, costs and execution assumptions.",
        ],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    if history.meta.data_status == "simulated":
        result["warnings"].append("SIMULATED provider is active; this is not historical market performance.")
    if benchmark_stats.get("error"):
        result["warnings"].append(benchmark_stats["error"])
    return to_builtin(result)


def persist_result(db: DbSession, bt: Backtest, report: dict) -> None:
    db.query(BacktestTrade).filter(BacktestTrade.backtest_id == bt.id).delete()
    for trade in report["trades"]:
        db.add(
            BacktestTrade(
                backtest_id=bt.id,
                entry_date=trade["entry_date"],
                exit_date=trade["exit_date"],
                side="long",
                quantity=trade["quantity"],
                entry_price=trade["entry_price"],
                exit_price=trade["exit_price"],
                fees=trade["fees"],
                pnl=trade["pnl"],
                return_pct=trade["return_pct"],
                exit_reason=trade["exit_reason"],
            )
        )
    bt.status = "succeeded"
    bt.finished_at = datetime.now(timezone.utc)
    bt.metrics = report["metrics"]
    bt.equity = {**report["equity"], "monthly_returns": report["monthly_returns"], "assumptions": report["assumptions"], "data": report["data"], "warnings": report["warnings"]}
    bt.data_start = datetime.strptime(report["data"]["start"], "%Y-%m-%d").date()
    bt.data_end = datetime.strptime(report["data"]["end"], "%Y-%m-%d").date()
    db.commit()


def launch_backtest_job(backtest_id: str) -> None:
    import threading

    def job():
        from ..db import SessionLocal

        db = SessionLocal()
        try:
            bt = db.get(Backtest, backtest_id)
            if not bt:
                return
            bt.status = "running"
            bt.started_at = datetime.now(timezone.utc)
            db.commit()
            strategy = db.get(Strategy, bt.strategy_id)
            if not strategy:
                raise ValueError("Strategy not found")
            report = run_backtest(db, bt, strategy)
            persist_result(db, bt, report)
        except Exception as exc:
            db.rollback()
            bt = db.get(Backtest, backtest_id)
            if bt:
                bt.status = "failed"
                bt.error = f"{type(exc).__name__}: {str(exc)[:800]}"
                bt.finished_at = datetime.now(timezone.utc)
                db.commit()
        finally:
            db.close()

    threading.Thread(target=job, daemon=True, name=f"bt-{backtest_id[:8]}").start()
