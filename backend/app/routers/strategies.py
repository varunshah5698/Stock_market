from __future__ import annotations

import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session as DbSession

from ..backtest.engine import evaluate_rules, launch_backtest_job
from ..db import get_db
from ..deps import audit, current_user
from ..marketdata.base import ProviderError
from ..marketdata.service import get_history
from ..models import Backtest, BacktestTrade, Strategy, User
from ..ml.validation import to_builtin
from ..ratelimit import job_limiter
from ..schemas import BacktestIn, StrategyIn

router = APIRouter(prefix="/api/v1", tags=["strategies"])

TEMPLATES = [
    {
        "name": "Trend following (SMA 200 filter)",
        "description": "Hold while price is above its 200-session SMA and medium-term momentum is positive.",
        "rules": {
            "entry": [
                {"indicator": "price_vs_sma", "op": ">", "value": 0.0, "params": {"window": 200}},
                {"indicator": "momentum", "op": ">", "value": 0.02, "params": {"window": 63}},
            ],
            "exit": [{"indicator": "price_vs_sma", "op": "<", "value": -0.02, "params": {"window": 50}}],
            "entry_logic": "all",
            "exit_logic": "any",
            "stop_loss_pct": 10,
            "take_profit_pct": None,
            "max_holding_days": None,
            "position_size_pct": 100,
        },
    },
    {
        "name": "RSI mean reversion",
        "description": "Buy oversold conditions and exit when RSI normalizes, with a stop-loss.",
        "rules": {
            "entry": [{"indicator": "rsi", "op": "<", "value": 30, "params": {"window": 14}}],
            "exit": [{"indicator": "rsi", "op": ">", "value": 55, "params": {"window": 14}}],
            "entry_logic": "all",
            "exit_logic": "any",
            "stop_loss_pct": 8,
            "max_holding_days": 20,
            "position_size_pct": 100,
        },
    },
    {
        "name": "Six-month momentum",
        "description": "Enter on strong 126-session momentum, exit when momentum fades.",
        "rules": {
            "entry": [{"indicator": "momentum", "op": ">", "value": 0.10, "params": {"window": 126}}],
            "exit": [{"indicator": "momentum", "op": "<", "value": 0.0, "params": {"window": 63}}],
            "entry_logic": "all",
            "exit_logic": "any",
            "stop_loss_pct": 12,
            "position_size_pct": 100,
        },
    },
    {
        "name": "Bollinger reversion",
        "description": "Buy lower-band extremes; exit near the middle band.",
        "rules": {
            "entry": [{"indicator": "bb_pctb", "op": "<", "value": 0.05, "params": {"window": 20}}],
            "exit": [{"indicator": "bb_pctb", "op": ">", "value": 0.5, "params": {"window": 20}}],
            "entry_logic": "all",
            "exit_logic": "any",
            "stop_loss_pct": 7,
            "max_holding_days": 30,
            "position_size_pct": 100,
        },
    },
    {
        "name": "20-day breakout",
        "description": "Buy new 20-session highs with trend confirmation; exit on momentum loss.",
        "rules": {
            "entry": [
                {"indicator": "breakout_high", "op": ">=", "value": -0.001, "params": {"window": 20}},
                {"indicator": "price_vs_sma", "op": ">", "value": 0.0, "params": {"window": 50}},
                {"indicator": "volume_ratio", "op": ">", "value": 0.0, "params": {}},
            ],
            "exit": [{"indicator": "momentum", "op": "<", "value": 0.0, "params": {"window": 10}}],
            "entry_logic": "all",
            "exit_logic": "any",
            "stop_loss_pct": 8,
            "position_size_pct": 100,
        },
    },
    {
        "name": "Low-volatility trend",
        "description": "Trend exposure filtered by realized volatility, with a tighter risk cap.",
        "rules": {
            "entry": [
                {"indicator": "price_vs_sma", "op": ">", "value": 0.0, "params": {"window": 100}},
                {"indicator": "volatility", "op": "<", "value": 0.35, "params": {"window": 20}},
            ],
            "exit": [{"indicator": "price_vs_sma", "op": "<", "value": -0.03, "params": {"window": 50}}],
            "entry_logic": "all",
            "exit_logic": "any",
            "stop_loss_pct": 10,
            "position_size_pct": 60,
        },
    },
]


def _ensure_templates(db: DbSession, user: User) -> None:
    count = db.query(Strategy).filter(Strategy.user_id == user.id, Strategy.is_template.is_(True)).count()
    if count:
        return
    for template in TEMPLATES:
        db.add(
            Strategy(
                user_id=user.id,
                name=template["name"],
                description=template["description"],
                rules=template["rules"],
                is_template=True,
            )
        )
    db.commit()


def _strategy_dict(s: Strategy) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "description": s.description,
        "rules": s.rules,
        "version": s.version,
        "is_template": s.is_template,
        "created_at": s.created_at.isoformat(),
        "updated_at": s.updated_at.isoformat(),
    }


def _owned_strategy(db: DbSession, user: User, strategy_id: str) -> Strategy:
    row = db.query(Strategy).filter(Strategy.id == strategy_id, Strategy.user_id == user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return row


@router.get("/strategies")
def list_strategies(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    _ensure_templates(db, user)
    rows = (
        db.query(Strategy)
        .filter(Strategy.user_id == user.id)
        .order_by(Strategy.is_template.desc(), Strategy.updated_at.desc())
        .all()
    )
    return {"strategies": [_strategy_dict(s) for s in rows], "templates_available": sum(1 for s in rows if s.is_template)}


@router.post("/strategies")
def create_strategy(payload: StrategyIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    strategy = Strategy(
        user_id=user.id,
        name=payload.name.strip(),
        description=payload.description,
        rules=payload.rules.model_dump(),
    )
    db.add(strategy)
    audit(db, user.id, "strategy.create", target=strategy.name)
    db.commit()
    return _strategy_dict(strategy)


@router.get("/strategies/{strategy_id}")
def get_strategy(strategy_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    return _strategy_dict(_owned_strategy(db, user, strategy_id))


@router.put("/strategies/{strategy_id}")
def update_strategy(strategy_id: str, payload: StrategyIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    strategy = _owned_strategy(db, user, strategy_id)
    strategy.name = payload.name.strip()
    strategy.description = payload.description
    strategy.rules = payload.rules.model_dump()
    strategy.version += 1
    audit(db, user.id, "strategy.update", target=strategy_id, version=strategy.version)
    db.commit()
    return _strategy_dict(strategy)


@router.delete("/strategies/{strategy_id}")
def delete_strategy(strategy_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    strategy = _owned_strategy(db, user, strategy_id)
    if strategy.is_template:
        raise HTTPException(status_code=409, detail="Templates cannot be deleted; clone one instead")
    db.delete(strategy)
    db.commit()
    return {"deleted": True}


@router.post("/strategies/{strategy_id}/clone")
def clone_strategy(strategy_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    strategy = _owned_strategy(db, user, strategy_id)
    clone = Strategy(
        user_id=user.id,
        name=f"{strategy.name} (copy)"[:120],
        description=strategy.description,
        rules=strategy.rules,
        is_template=False,
    )
    db.add(clone)
    db.commit()
    return _strategy_dict(clone)


@router.get("/strategies/{strategy_id}/preview")
def preview(
    strategy_id: str,
    symbol: str = Query(..., max_length=32),
    period: str = Query("2y", pattern=r"^(1y|2y|3y|5y)$"),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    strategy = _owned_strategy(db, user, strategy_id)
    try:
        history = get_history(db, symbol, period=period, interval="1d")
    except ProviderError as exc:
        raise HTTPException(status_code=503, detail=exc.message)
    frame = history.frame
    rules = strategy.rules or {}
    entry = evaluate_rules(frame, rules.get("entry") or [], rules.get("entry_logic", "all"))
    exit_ = evaluate_rules(frame, rules.get("exit") or [], rules.get("exit_logic", "any"))
    markers = []
    for ts, value in entry.items():
        if bool(value):
            markers.append({"date": str(ts.date()), "type": "entry"})
    for ts, value in exit_.items():
        if bool(value):
            markers.append({"date": str(ts.date()), "type": "exit"})
    markers.sort(key=lambda m: m["date"])
    return {
        "strategy_id": strategy.id,
        "strategy_version": strategy.version,
        "symbol": symbol.upper(),
        "period": period,
        "signal_days": {"entry": int(entry.sum()), "exit": int(exit_.sum())},
        "markers": markers[-200:],
        "latest_signal": "entry" if bool(entry.iloc[-1]) else ("exit" if bool(exit_.iloc[-1]) else "none"),
        "current_state": "flat" if bool(entry.iloc[-1]) else "unknown_without_position_state",
        "data": {"start": str(frame.index[0].date()), "end": str(frame.index[-1].date()), "provider": history.meta.provider, "status": history.meta.data_status},
        "warnings": [
            "A signal preview is not a backtest.",
            "Signals are evaluated at each close and would execute no earlier than the next open.",
        ],
    }


@router.post("/backtests")
def create_backtest(payload: BacktestIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    job_limiter.check(f"backtest:{user.id}")
    strategy = _owned_strategy(db, user, payload.strategy_id)
    bt = Backtest(
        user_id=user.id,
        strategy_id=strategy.id,
        symbol=payload.symbol,
        benchmark=payload.benchmark,
        status="queued",
        config={
            "period": payload.period,
            "start": payload.start.isoformat() if payload.start else None,
            "end": payload.end.isoformat() if payload.end else None,
            "initial_capital": payload.initial_capital,
            "commission_bps": payload.commission_bps,
            "slippage_bps": payload.slippage_bps,
            "spread_bps": payload.spread_bps,
            "position_size_pct": payload.position_size_pct,
            "strategy_version": strategy.version,
            "strategy_name": strategy.name,
        },
    )
    db.add(bt)
    audit(db, user.id, "backtest.create", target=f"{payload.symbol}:{strategy.id}")
    db.commit()
    launch_backtest_job(bt.id)
    return {"backtest": {"id": bt.id, "status": bt.status, "symbol": bt.symbol}, "message": "Backtest queued."}


@router.get("/backtests")
def list_backtests(
    symbol: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=5, le=100),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    query = db.query(Backtest).filter(Backtest.user_id == user.id)
    if symbol:
        query = query.filter(Backtest.symbol == symbol.upper())
    total = query.count()
    rows = query.order_by(Backtest.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    strategies = {s.id: s.name for s in db.query(Strategy).filter(Strategy.user_id == user.id).all()}
    return {
        "backtests": [
            {
                "id": b.id,
                "symbol": b.symbol,
                "benchmark": b.benchmark,
                "strategy_id": b.strategy_id,
                "strategy_name": strategies.get(b.strategy_id, "Deleted strategy"),
                "status": b.status,
                "error": b.error or None,
                "metrics": b.metrics,
                "created_at": b.created_at.isoformat(),
                "finished_at": b.finished_at.isoformat() if b.finished_at else None,
            }
            for b in rows
        ],
        "pagination": {"page": page, "page_size": page_size, "total": total},
    }


@router.get("/backtests/{backtest_id}")
def get_backtest(backtest_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    bt = db.query(Backtest).filter(Backtest.id == backtest_id, Backtest.user_id == user.id).first()
    if not bt:
        raise HTTPException(status_code=404, detail="Backtest not found")
    strategy = db.get(Strategy, bt.strategy_id)
    return {
        "id": bt.id,
        "symbol": bt.symbol,
        "benchmark": bt.benchmark,
        "status": bt.status,
        "error": bt.error or None,
        "config": bt.config,
        "metrics": bt.metrics,
        "equity": bt.equity,
        "strategy": _strategy_dict(strategy) if strategy else None,
        "data_start": bt.data_start.isoformat() if bt.data_start else None,
        "data_end": bt.data_end.isoformat() if bt.data_end else None,
        "created_at": bt.created_at.isoformat(),
        "started_at": bt.started_at.isoformat() if bt.started_at else None,
        "finished_at": bt.finished_at.isoformat() if bt.finished_at else None,
        "disclaimer": "Historical simulation with modeled costs. Not live trading performance and not investment advice.",
    }


@router.get("/backtests/{backtest_id}/trades")
def get_trades(
    backtest_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=5, le=200),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    bt = db.query(Backtest).filter(Backtest.id == backtest_id, Backtest.user_id == user.id).first()
    if not bt:
        raise HTTPException(status_code=404, detail="Backtest not found")
    query = db.query(BacktestTrade).filter(BacktestTrade.backtest_id == bt.id)
    total = query.count()
    rows = query.order_by(BacktestTrade.entry_date).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "trades": [
            {
                "id": t.id,
                "entry_date": t.entry_date.isoformat(),
                "exit_date": t.exit_date.isoformat() if t.exit_date else None,
                "side": t.side,
                "quantity": float(t.quantity),
                "entry_price": float(t.entry_price),
                "exit_price": float(t.exit_price) if t.exit_price is not None else None,
                "fees": float(t.fees),
                "pnl": float(t.pnl) if t.pnl is not None else None,
                "return_pct": float(t.return_pct) if t.return_pct is not None else None,
                "exit_reason": t.exit_reason,
            }
            for t in rows
        ],
        "pagination": {"page": page, "page_size": page_size, "total": total},
    }


@router.get("/backtests/{backtest_id}/export.csv")
def export_backtest(backtest_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    bt = db.query(Backtest).filter(Backtest.id == backtest_id, Backtest.user_id == user.id).first()
    if not bt:
        raise HTTPException(status_code=404, detail="Backtest not found")
    equity = bt.equity or {}
    dates = equity.get("dates") or []
    strat = equity.get("strategy") or []
    bench = equity.get("benchmark") or []
    buffer = io.StringIO()
    buffer.write("date,strategy_equity,benchmark_equity,drawdown\n")
    drawdown = equity.get("drawdown") or []
    for i, date in enumerate(dates):
        buffer.write(
            f"{date},{strat[i] if i < len(strat) else ''},{bench[i] if bench and i < len(bench) else ''},{drawdown[i] if i < len(drawdown) else ''}\n"
        )
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=stockpulse-backtest-{bt.id}.csv"},
    )
