from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session as DbSession

from ..marketdata.service import cached_frame, get_history, snapshots
from ..models import Portfolio
from ..ml.validation import to_builtin


def _weights(positions: list[dict]) -> dict[str, float]:
    total = sum(p["market_value"] for p in positions)
    if total <= 0:
        return {}
    return {p["symbol"]: p["market_value"] / total for p in positions}


def _risk_block(weights: dict[str, float], returns: pd.DataFrame, benchmark_returns: pd.Series | None) -> dict:
    if not weights:
        return {"available": False, "reason": "No valued positions"}
    symbols = [s for s in weights if s in returns.columns]
    if len(symbols) < 1:
        return {"available": False, "reason": "No overlapping price history"}
    rets = returns[symbols].dropna()
    if len(rets) < 60:
        return {"available": False, "reason": f"Only {len(rets)} aligned observations; at least 60 are required"}
    w = np.array([weights[s] for s in symbols])
    w = w / w.sum()
    cov = rets.cov().to_numpy() * 252
    variance = float(w @ cov @ w)
    port_vol = float(np.sqrt(max(variance, 0)))
    port_returns = rets.to_numpy() @ w
    equity = np.cumprod(1 + port_returns)
    peak = np.maximum.accumulate(equity)
    dd = equity / peak - 1
    var_contrib = w * (cov @ w)
    contributions = var_contrib / variance if variance > 0 else np.zeros_like(w)
    corr = rets.corr()
    out = {
        "available": True,
        "observations": int(len(rets)),
        "window_start": str(rets.index[0].date()),
        "window_end": str(rets.index[-1].date()),
        "annualized_volatility": round(port_vol, 6),
        "max_drawdown": round(float(dd.min()), 6) if len(dd) else None,
        "cumulative_return": round(float(equity[-1] - 1), 6),
        "weights": {s: round(float(x), 6) for s, x in zip(symbols, w)},
        "risk_contribution": [
            {"symbol": s, "weight": round(float(x), 6), "variance_contribution_pct": round(float(c) * 100, 3)}
            for s, x, c in zip(symbols, w, contributions)
        ],
        "correlation": {
            "symbols": symbols,
            "matrix": [[round(float(v), 4) for v in row] for row in corr.to_numpy()],
        },
        "note": "Risk contributions use current weights held constant over the aligned window; they are estimates, not forecasts.",
    }
    if benchmark_returns is not None:
        bench = benchmark_returns.reindex(rets.index).dropna()
        if len(bench) > 30:
            common = rets.index.intersection(bench.index)
            pr = pd.Series(port_returns, index=rets.index).reindex(common)
            br = bench.reindex(common)
            out["benchmark"] = {
                "cumulative_return": round(float((1 + pr).prod() - 1), 6),
                "benchmark_return": round(float((1 + br).prod() - 1), 6),
                "excess_return": round(float((1 + pr).prod() - (1 + br).prod()), 6),
                "beta": round(float(np.cov(pr, br)[0, 1] / np.var(br, ddof=0)), 4) if np.var(br, ddof=0) > 0 else None,
            }
    return out


def portfolio_detail(db: DbSession, portfolio: Portfolio, benchmark: str = "SPY") -> dict:
    positions = portfolio.positions
    if not positions:
        return {
            "portfolio": {"id": portfolio.id, "name": portfolio.name, "base_currency": portfolio.base_currency},
            "positions": [],
            "summary": {
                "positions": 0,
                "market_value": 0,
                "cost_basis": 0,
                "unrealized_pnl": 0,
                "unrealized_pct": None,
                "concentration_hhi": 0,
                "top_weight_pct": 0,
                "currencies": [],
                "valuation_source": "Manual positions valued at delayed/end-of-day prices. Not a broker-confirmed balance.",
            },
            "allocation": [],
            "risk": {"available": False, "reason": "No positions"},
            "warnings": [],
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
    prices = snapshots(db, [p.symbol for p in positions])
    rows = []
    warnings: list[str] = []
    for p in positions:
        snap = prices.get(p.symbol)
        if not snap:
            warnings.append(f"No price available for {p.symbol}; position excluded from valuation.")
            continue
        qty = float(p.quantity)
        cost = float(p.avg_cost)
        value = qty * snap["price"]
        rows.append(
            {
                "id": p.id,
                "symbol": p.symbol,
                "quantity": qty,
                "avg_cost": cost,
                "price": snap["price"],
                "market_value": round(value, 4),
                "cost_basis": round(qty * cost, 4),
                "unrealized_pnl": round(value - qty * cost, 4),
                "unrealized_pct": round((snap["price"] / cost - 1) * 100, 4) if cost else None,
                "change_1d_pct": snap["change_pct"],
                "currency": snap["currency"],
                "as_of": snap["as_of"],
                "data_status": snap["data_status"],
            }
        )
    total_value = sum(r["market_value"] for r in rows)
    total_cost = sum(r["cost_basis"] for r in rows)
    for row in rows:
        row["weight_pct"] = round(row["market_value"] / total_value * 100, 3) if total_value else None
    currencies = {r["currency"] for r in rows}
    if len(currencies) > 1:
        warnings.append(
            f"Positions span multiple currencies ({', '.join(sorted(currencies))}). Values are summed at face value without FX conversion."
        )
    weights = _weights(rows)

    frames = {}
    for symbol in weights:
        frame = cached_frame(db, symbol, "1y")
        if frame is not None and len(frame) > 40:
            frames[symbol] = frame["adj_close"]
    returns = None
    if frames:
        prices_df = pd.DataFrame(frames).sort_index().ffill()
        returns = prices_df.pct_change().dropna(how="all")
    benchmark_returns = None
    if benchmark:
        try:
            bench = get_history(db, benchmark, period="1y", interval="1d")
            benchmark_returns = bench.frame["adj_close"].pct_change()
        except Exception:
            warnings.append(f"Benchmark {benchmark} could not be loaded; benchmark comparison is unavailable.")
    risk = _risk_block(weights, returns, benchmark_returns) if returns is not None else {"available": False, "reason": "No cached history"}

    hhi = sum((r["market_value"] / total_value) ** 2 for r in rows) if total_value else 0
    return {
        "portfolio": {"id": portfolio.id, "name": portfolio.name, "base_currency": portfolio.base_currency},
        "positions": rows,
        "summary": {
            "positions": len(rows),
            "market_value": round(total_value, 4),
            "cost_basis": round(total_cost, 4),
            "unrealized_pnl": round(total_value - total_cost, 4),
            "unrealized_pct": round((total_value / total_cost - 1) * 100, 4) if total_cost else None,
            "concentration_hhi": round(hhi, 4),
            "top_weight_pct": round(max((r["weight_pct"] or 0) for r in rows), 3),
            "currencies": sorted(currencies),
            "valuation_source": "Manual positions valued at delayed/end-of-day prices. Not a broker-confirmed balance.",
        },
        "allocation": sorted(
            [{"symbol": r["symbol"], "weight_pct": r["weight_pct"], "market_value": r["market_value"]} for r in rows],
            key=lambda x: x["weight_pct"] or 0,
            reverse=True,
        ),
        "risk": risk,
        "warnings": warnings,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def scenario_analysis(db: DbSession, portfolio: Portfolio, weights: dict[str, float]) -> dict:
    frames = {}
    for symbol in weights:
        frame = cached_frame(db, symbol, "1y")
        if frame is not None and len(frame) > 40:
            frames[symbol] = frame["adj_close"]
    if not frames:
        raise ValueError("No cached price history available for the requested symbols")
    prices_df = pd.DataFrame(frames).sort_index().ffill()
    returns = prices_df.pct_change().dropna(how="all")
    result = _risk_block(weights, returns, None)
    result["scenario_weights"] = weights
    result["disclaimer"] = "Hypothetical allocation applied to historical returns. Not a forecast and not investment advice."
    return to_builtin(result)
