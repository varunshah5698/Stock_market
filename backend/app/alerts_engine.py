from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session as DbSession

from .analytics.indicators import rsi
from .marketdata.service import cached_frame, get_quote
from .models import Alert, AlertEvent, Notification

logger = logging.getLogger("stockpulse.alerts")


def _evaluate(alert: Alert, value: float, change_pct: float | None, rsi_value: float | None) -> tuple[bool, str]:
    threshold = float((alert.params or {}).get("threshold", 0))
    if alert.kind == "price_above":
        return value >= threshold, f"{alert.symbol} traded at {value:.2f}, at or above the {threshold:.2f} threshold."
    if alert.kind == "price_below":
        return value <= threshold, f"{alert.symbol} traded at {value:.2f}, at or below the {threshold:.2f} threshold."
    if alert.kind == "pct_move":
        if change_pct is None:
            return False, ""
        return abs(change_pct) >= abs(threshold), f"{alert.symbol} moved {change_pct:.2f}% versus the previous close (threshold {threshold:.2f}%)."
    if alert.kind == "rsi_above":
        if rsi_value is None:
            return False, ""
        return rsi_value >= threshold, f"{alert.symbol} RSI(14) reached {rsi_value:.1f} (threshold {threshold:.1f})."
    if alert.kind == "rsi_below":
        if rsi_value is None:
            return False, ""
        return rsi_value <= threshold, f"{alert.symbol} RSI(14) fell to {rsi_value:.1f} (threshold {threshold:.1f})."
    return False, ""


def evaluate_alerts(db: DbSession, user_id: str, alert_ids: list[str] | None = None, limit: int = 50) -> list[dict]:
    now = datetime.now(timezone.utc)
    query = db.query(Alert).filter(Alert.user_id == user_id, Alert.is_active.is_(True))
    if alert_ids:
        query = query.filter(Alert.id.in_(alert_ids))
    alerts = query.order_by(Alert.created_at).limit(limit).all()
    fired: list[dict] = []
    for alert in alerts:
        if alert.last_fired_at is not None:
            last = alert.last_fired_at.replace(tzinfo=timezone.utc) if alert.last_fired_at.tzinfo is None else alert.last_fired_at
            if now - last < timedelta(minutes=alert.cooldown_minutes):
                continue
        try:
            quote = get_quote(db, alert.symbol)
            change_pct = (quote.price / quote.previous_close - 1) * 100 if quote.previous_close else None
            rsi_value = None
            if alert.kind.startswith("rsi_"):
                frame = cached_frame(db, alert.symbol, "1y")
                if frame is None or len(frame) < 30:
                    continue
                series = rsi(frame["adj_close"].astype(float), 14)
                if series.dropna().empty:
                    continue
                rsi_value = float(series.iloc[-1])
            triggered, message = _evaluate(alert, quote.price, change_pct, rsi_value)
        except Exception as exc:
            logger.info("Alert %s skipped: %s", alert.id, exc)
            continue
        if not triggered:
            continue
        event = AlertEvent(
            alert_id=alert.id,
            user_id=user_id,
            message=message,
            value=quote.price,
            data={
                "kind": alert.kind,
                "threshold": (alert.params or {}).get("threshold"),
                "price": quote.price,
                "change_pct": change_pct,
                "rsi_14": rsi_value,
                "data_status": quote.meta.data_status,
                "provider": quote.meta.provider,
                "observation_time": quote.meta.observation_end.isoformat() if quote.meta.observation_end else None,
            },
        )
        db.add(event)
        db.add(
            Notification(
                user_id=user_id,
                title=f"Alert: {alert.symbol}",
                body=message,
                kind="alert",
                link=f"/research/{alert.symbol}",
            )
        )
        alert.last_fired_at = now
        db.flush()
        fired.append(
            {
                "alert_id": alert.id,
                "event_id": event.id,
                "symbol": alert.symbol,
                "message": message,
                "price": quote.price,
                "data_status": quote.meta.data_status,
                "triggered_at": now.isoformat(),
            }
        )
    db.commit()
    return fired


def evaluate_all_active(db: DbSession, limit: int = 100) -> int:
    """Scheduler entry point. Alerts are evaluated on a periodic cadence, not streaming."""
    alerts = db.query(Alert).filter(Alert.is_active.is_(True)).order_by(Alert.created_at).limit(limit).all()
    user_ids = list({a.user_id for a in alerts})
    total = 0
    for user_id in user_ids:
        try:
            total += len(evaluate_alerts(db, user_id, limit=25))
        except Exception as exc:
            logger.warning("Alert evaluation failed for user %s: %s", user_id, exc)
            db.rollback()
    return total


def run_scheduler_cycle(db: DbSession, limit: int = 100) -> dict:
    """One scheduler tick: evaluate alerts and fill resting paper orders.

    Called by the in-process thread in development and by the cron endpoint on
    serverless, so the behaviour cannot drift between the two.
    """
    from .models import PaperAccount, PaperOrder
    from .paper.engine import process_open_orders

    fired = evaluate_all_active(db, limit=limit)
    account_ids = {
        row[0]
        for row in db.query(PaperOrder.account_id).filter(PaperOrder.status == "OPEN").distinct().limit(limit).all()
    }
    processed = 0
    for account_id in account_ids:
        account = db.get(PaperAccount, account_id)
        if account:
            try:
                process_open_orders(db, account)
                processed += 1
            except Exception as exc:
                logger.warning("Paper order processing failed for account %s: %s", account_id, exc)
                db.rollback()
    return {"alerts_fired": fired, "accounts_processed": processed}


def drain_queued_jobs(budget_seconds: float = 40.0, max_jobs: int = 20) -> dict:
    """Run queued experiments/backtests until the budget is spent.

    A serverless request cannot hold a queue, so jobs that were only enqueued
    (for example the rest of a large sweep) are picked up here. The loop is
    bounded by both a deadline and a job count so it always returns in time.
    """
    import time

    from .backtest.engine import launch_backtest_job
    from .db import SessionLocal
    from .ml.runner import launch_experiment
    from .models import Backtest, Experiment

    started = {"experiments": 0, "backtests": 0}
    deadline = time.monotonic() + budget_seconds
    db = SessionLocal()
    try:
        for _ in range(max_jobs):
            if time.monotonic() >= deadline:
                break
            db.expire_all()  # the job writes through its own session
            exp = db.query(Experiment).filter(Experiment.status == "queued").order_by(Experiment.created_at).first()
            if exp is not None:
                launch_experiment(exp.id)
                started["experiments"] += 1
                continue
            bt = db.query(Backtest).filter(Backtest.status == "queued").order_by(Backtest.created_at).first()
            if bt is not None:
                launch_backtest_job(bt.id)
                started["backtests"] += 1
                continue
            break
    finally:
        db.close()
    return started
