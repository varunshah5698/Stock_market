from __future__ import annotations

import json
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func, text
from sqlalchemy.orm import Session as DbSession

from ..config import settings, storage_root
from ..db import get_db
from ..deps import audit, current_user
from ..marketdata.service import bar_count, cached_frame, get_provider, provider_info
from ..models import (
    Alert,
    AuditEvent,
    Backtest,
    BrokerConnection,
    DataCacheMeta,
    Dataset,
    Experiment,
    ModelVersion,
    PaperAccount,
    PaperOrder,
    Portfolio,
    PortfolioTransaction,
    Prediction,
    Preference,
    Session as SessionRow,
    Strategy,
    User,
    Watchlist,
)
from ..ml.validation import to_builtin
from ..schemas import PreferencesIn
from ..security import SESSION_COOKIE, token_hash, verify_password

router = APIRouter(prefix="/api/v1", tags=["system"])
STORAGE_ROOT = storage_root()


@router.get("/system/status")
def system_status(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    db_ok = True
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    last_cache = db.query(func.max(DataCacheMeta.fetched_at)).scalar()
    jobs = {
        "experiments": {
            s: db.query(Experiment).filter(Experiment.user_id == user.id, Experiment.status == s).count()
            for s in ("queued", "running", "succeeded", "failed", "cancelled")
        },
        "backtests": {
            s: db.query(Backtest).filter(Backtest.user_id == user.id, Backtest.status == s).count()
            for s in ("queued", "running", "succeeded", "failed")
        },
    }
    recent_failures = []
    for exp in db.query(Experiment).filter(Experiment.user_id == user.id, Experiment.status == "failed").order_by(Experiment.created_at.desc()).limit(5):
        recent_failures.append({"kind": "experiment", "id": exp.id, "symbol": exp.symbol, "error": exp.error, "at": exp.created_at.isoformat()})
    for bt in db.query(Backtest).filter(Backtest.user_id == user.id, Backtest.status == "failed").order_by(Backtest.created_at.desc()).limit(5):
        recent_failures.append({"kind": "backtest", "id": bt.id, "symbol": bt.symbol, "error": bt.error, "at": bt.created_at.isoformat()})
    approved = db.query(ModelVersion).filter(ModelVersion.user_id == user.id, ModelVersion.approved.is_(True)).count()
    return {
        "version": "0.1.0",
        "environment": settings.app_env,
        "database": {"connected": db_ok, "dialect": db.get_bind().dialect.name if db.get_bind() else None},
        "provider": provider_info(),
        "coverage": {
            "cached_bars": bar_count(db),
            "last_cache_refresh": last_cache.replace(tzinfo=timezone.utc).isoformat() if last_cache and last_cache.tzinfo is None else (last_cache.isoformat() if last_cache else None),
            "approved_models": approved,
        },
        "jobs": jobs,
        "recent_failures": recent_failures,
        "capabilities": {
            "market_data": True,
            "historical_research": True,
            "paper_trading": True,
            "email_delivery": False,
            "news_provider": False,
            "live_broker": False,
            "streaming_market_data": False,
            "autonomous_live_trading": False,
            "deep_learning_models": False,
            "fundamentals": False,
            "drift_monitoring": False,
        },
        "warnings": [
            "Background training runs in-process worker threads in this build; it is not a durable external queue and jobs are marked failed on restart.",
            "Live broker execution and streaming market data are not implemented. Paper trading only.",
        ],
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/settings/preferences")
def get_preferences(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    pref = db.get(Preference, user.id)
    if not pref:
        pref = Preference(user_id=user.id)
        db.add(pref)
        db.commit()
    return {
        "base_currency": pref.base_currency,
        "default_market": pref.default_market,
        "default_horizon": pref.default_horizon,
        "theme": pref.theme,
        "chart_defaults": pref.chart_defaults,
        "notifications": pref.notifications,
    }


@router.put("/settings/preferences")
def put_preferences(payload: PreferencesIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    pref = db.get(Preference, user.id)
    if not pref:
        pref = Preference(user_id=user.id)
        db.add(pref)
    pref.base_currency = payload.base_currency.upper()
    pref.default_market = payload.default_market.upper()
    pref.default_horizon = payload.default_horizon
    pref.theme = payload.theme
    pref.chart_defaults = payload.chart_defaults
    pref.notifications = payload.notifications
    db.commit()
    return {"updated": True}


@router.get("/settings/sessions")
def sessions(request: Request, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    token = request.cookies.get(SESSION_COOKIE)
    current_hash = token_hash(token) if token else None
    rows = (
        db.query(SessionRow)
        .filter(SessionRow.user_id == user.id, SessionRow.revoked_at.is_(None))
        .order_by(SessionRow.created_at.desc())
        .all()
    )
    return {
        "sessions": [
            {
                "id": s.id,
                "created_at": s.created_at.isoformat(),
                "expires_at": s.expires_at.isoformat(),
                "user_agent": s.user_agent,
                "ip": s.ip,
                "current": s.token_hash == current_hash,
            }
            for s in rows
        ],
        "note": "Opaque server-side sessions. Tokens are stored only as SHA-256 hashes.",
    }


@router.delete("/settings/sessions/{session_id}")
def revoke_session(session_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    row = db.query(SessionRow).filter(SessionRow.id == session_id, SessionRow.user_id == user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    row.revoked_at = datetime.now(timezone.utc)
    audit(db, user.id, "session.revoke", target=session_id)
    db.commit()
    return {"revoked": True}


@router.post("/settings/sessions/revoke-others")
def revoke_others(request: Request, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    current = token_hash(token)
    rows = (
        db.query(SessionRow)
        .filter(SessionRow.user_id == user.id, SessionRow.revoked_at.is_(None), SessionRow.token_hash != current)
        .all()
    )
    for row in rows:
        row.revoked_at = datetime.now(timezone.utc)
    audit(db, user.id, "session.revoke_others", target=str(len(rows)))
    db.commit()
    return {"revoked": len(rows)}


@router.get("/settings/audit")
def audit_log(limit: int = 50, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    rows = (
        db.query(AuditEvent)
        .filter(AuditEvent.user_id == user.id)
        .order_by(AuditEvent.created_at.desc())
        .limit(min(limit, 200))
        .all()
    )
    return {
        "events": [
            {
                "id": e.id,
                "action": e.action,
                "target": e.target,
                "meta": e.meta,
                "ip": e.ip,
                "created_at": e.created_at.isoformat(),
            }
            for e in rows
        ]
    }


@router.get("/settings/integrations")
def integrations(user: User = Depends(current_user)):
    return {
        "market_data": {
            "configured": True,
            "provider": get_provider().name,
            "status": "simulated" if get_provider().name == "sample" else "delayed",
            "requires": "No API key for yfinance; usage is subject to Yahoo terms and rate limits.",
        },
        "news": {
            "configured": True,
            "status": "live_keyless_rss",
            "provider": "google_news_rss",
            "requires": (
                "No key required: keyless public RSS aggregator, headlines only. Set NEWS_API_KEY only if you "
                "switch to a licensed provider with redistribution rights."
            ),
            "env": ["NEWS_API_KEY (optional)"],
        },
        "broker": {
            "configured": False,
            "status": "disabled",
            "requires": "Official broker OAuth/API credentials, account eligibility checks and a reviewed broker adapter. Live orders are hard-disabled.",
            "env": ["BROKER_ADAPTER", "BROKER_API_KEY", "BROKER_API_SECRET"],
        },
        "email": {
            "configured": False,
            "status": "not_implemented",
            "requires": "SMTP or transactional email credentials; verification and reset delivery are not wired up.",
        },
        "mfa": {"configured": False, "status": "not_implemented"},
        "streaming": {
            "configured": False,
            "status": "not_implemented",
            "requires": "A licensed streaming market-data feed with exchange permissions. yfinance is not used as a one-second executable quote source.",
        },
    }


@router.get("/settings/export")
def export_account(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    pref = db.get(Preference, user.id)
    watchlists = db.query(Watchlist).filter(Watchlist.user_id == user.id).all()
    portfolios = db.query(Portfolio).filter(Portfolio.user_id == user.id).all()
    experiments = db.query(Experiment).filter(Experiment.user_id == user.id).order_by(Experiment.created_at).all()
    backtests = db.query(Backtest).filter(Backtest.user_id == user.id).order_by(Backtest.created_at).all()
    strategies = db.query(Strategy).filter(Strategy.user_id == user.id).all()
    predictions = db.query(Prediction).filter(Prediction.user_id == user.id).order_by(Prediction.created_at).limit(500).all()
    accounts = db.query(PaperAccount).filter(PaperAccount.user_id == user.id).all()
    alerts = db.query(Alert).filter(Alert.user_id == user.id).all()
    datasets = db.query(Dataset).filter(Dataset.user_id == user.id, Dataset.deleted_at.is_(None)).all()
    payload = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "user": {"id": user.id, "email": user.email, "display_name": user.display_name, "created_at": user.created_at.isoformat()},
        "preferences": {
            "base_currency": pref.base_currency if pref else None,
            "default_market": pref.default_market if pref else None,
            "default_horizon": pref.default_horizon if pref else None,
            "theme": pref.theme if pref else None,
        },
        "watchlists": [
            {"name": w.name, "items": [{"symbol": i.symbol, "note": i.note} for i in w.items]} for w in watchlists
        ],
        "portfolios": [
            {
                "name": p.name,
                "base_currency": p.base_currency,
                "positions": [{"symbol": x.symbol, "quantity": float(x.quantity), "avg_cost": float(x.avg_cost), "notes": x.notes} for x in p.positions],
                "transactions": [
                    {"symbol": t.symbol, "side": t.side, "quantity": float(t.quantity), "price": float(t.price), "executed_at": t.executed_at.isoformat()}
                    for t in db.query(PortfolioTransaction).filter(PortfolioTransaction.portfolio_id == p.id).all()
                ],
            }
            for p in portfolios
        ],
        "strategies": [{"name": s.name, "rules": s.rules, "version": s.version, "is_template": s.is_template} for s in strategies],
        "experiments": [
            {
                "id": e.id,
                "symbol": e.symbol,
                "status": e.status,
                "config": e.config,
                "selected": ((e.metrics or {}).get("selected") or {}),
                "created_at": e.created_at.isoformat(),
            }
            for e in experiments
        ],
        "backtests": [{"id": b.id, "symbol": b.symbol, "config": b.config, "metrics": b.metrics, "created_at": b.created_at.isoformat()} for b in backtests],
        "predictions": [
            {"symbol": p.symbol, "target": p.target, "horizon": p.horizon, "point": float(p.point), "as_of": p.as_of.isoformat(), "warnings": p.warnings}
            for p in predictions
        ],
        "alerts": [{"symbol": a.symbol, "kind": a.kind, "params": a.params, "active": a.is_active} for a in alerts],
        "datasets": [{"id": d.id, "name": d.name, "rows": d.rows, "validation": d.validation} for d in datasets],
        "paper_accounts": [
            {
                "id": a.id,
                "name": a.name,
                "cash": float(a.cash),
                "starting_cash": float(a.starting_cash),
                "mode": "PAPER",
                "orders": [
                    {
                        "symbol": o.symbol,
                        "side": o.side,
                        "quantity": float(o.quantity),
                        "status": o.status,
                        "avg_fill_price": float(o.avg_fill_price) if o.avg_fill_price is not None else None,
                        "created_at": o.created_at.isoformat(),
                    }
                    for o in db.query(PaperOrder).filter(PaperOrder.account_id == a.id).limit(500).all()
                ],
            }
            for a in accounts
        ],
        "audit_events": [
            {"action": e.action, "target": e.target, "created_at": e.created_at.isoformat(), "ip": e.ip}
            for e in db.query(AuditEvent).filter(AuditEvent.user_id == user.id).order_by(AuditEvent.created_at.desc()).limit(500).all()
        ],
        "notes": [
            "Session tokens and password hashes are excluded from this export.",
            "Dataset file contents are not embedded; download each dataset separately before deleting the account.",
        ],
    }
    body = json.dumps(to_builtin(payload), default=str, indent=2)
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename=stockpulse-export-{user.id[:8]}.json"},
    )


@router.delete("/settings/account")
def delete_account(payload: dict, response: Response, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    if payload.get("confirm") != "DELETE":
        raise HTTPException(status_code=422, detail="Type DELETE to confirm account deletion")
    password = str(payload.get("password", ""))
    if not verify_password(password, user.password_hash):
        raise HTTPException(status_code=403, detail="Password confirmation failed")
    active_jobs = db.query(Experiment).filter(
        Experiment.user_id == user.id, Experiment.status.in_(["queued", "running"])
    ).count() + db.query(Backtest).filter(
        Backtest.user_id == user.id, Backtest.status.in_(["queued", "running"])
    ).count()
    if active_jobs:
        raise HTTPException(
            status_code=409,
            detail="Wait for or cancel active training/backtest jobs before deleting the account. In-flight jobs cannot be safely interrupted.",
        )
    for dataset in db.query(Dataset).filter(Dataset.user_id == user.id).all():
        path = (STORAGE_ROOT / dataset.storage_path).resolve()
        if str(path).startswith(str((STORAGE_ROOT / "storage" / "datasets").resolve()) + "/") and path.exists():
            path.unlink()
    for exp in db.query(Experiment).filter(Experiment.user_id == user.id).all():
        if exp.artifact_path:
            path = (STORAGE_ROOT / exp.artifact_path).resolve()
            if str(path).startswith(str((STORAGE_ROOT / "storage" / "models").resolve()) + "/") and path.exists():
                path.unlink()
    audit(db, user.id, "account.delete", target=user.id)
    db.delete(user)
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"deleted": True, "message": "Account and owned records deleted. Backup retention is governed by the deployment's backup policy."}


@router.get("/broker-connections")
def broker_connections(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    rows = db.query(BrokerConnection).filter(BrokerConnection.user_id == user.id).all()
    return {
        "connections": [
            {
                "id": r.id,
                "broker": r.broker,
                "status": r.status,
                "account_ref": r.account_ref,
                "permissions": r.permissions,
                "last_sync_at": r.last_sync_at.isoformat() if r.last_sync_at else None,
            }
            for r in rows
        ],
        "available": False,
        "reason": "No official broker adapter is implemented in this deployment. Live brokerage connections and order routing are disabled.",
        "requirements": [
            "Official broker OAuth/API application with approved scopes",
            "Server-side encrypted token storage and refresh handling",
            "Account, instrument and order-type eligibility checks",
            "Order reconciliation, idempotency and audit trail",
            "A tested kill switch and restart-recovery procedure",
        ],
    }


@router.post("/broker-connections")
def connect_broker(payload: dict, user: User = Depends(current_user)):
    raise HTTPException(
        status_code=501,
        detail="Broker connections are not available. No official adapter is implemented; this platform will not simulate a brokerage connection.",
    )


@router.delete("/broker-connections/{connection_id}")
def delete_broker(connection_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    row = db.query(BrokerConnection).filter(BrokerConnection.id == connection_id, BrokerConnection.user_id == user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Connection not found")
    db.delete(row)
    db.commit()
    return {"deleted": True}


@router.post("/broker-connections/{connection_id}/orders")
def live_order(connection_id: str, payload: dict, user: User = Depends(current_user)):
    raise HTTPException(
        status_code=503,
        detail="Live order submission is disabled. Paper trading is available; no order was sent anywhere.",
    )


@router.get("/news")
def news(
    symbol: str = Query("", max_length=32),
    limit: int = Query(20, ge=1, le=50),
    user: User = Depends(current_user),
):
    """Live headlines from a keyless public RSS aggregator.

    ``symbol`` narrows the query (e.g. AAPL -> "AAPL stock"); omitted means a
    general market query. Nothing is cached to the database, and a provider
    failure surfaces as an explicit error rather than empty placeholder content.
    """
    from ..news import news_payload, query_for_symbol

    query = query_for_symbol(symbol)
    try:
        payload = news_payload(query, limit=limit)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"News provider unavailable: {type(exc).__name__}. No headlines are fabricated while it is down.",
        )
    payload["disclaimer"] = (
        "News and the keyword tone are informational only and are not evidence that a price will rise or fall. "
        "They are not used as a model input."
    )
    return payload


@router.get("/model-health")
def model_health(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    approved = (
        db.query(ModelVersion)
        .filter(ModelVersion.user_id == user.id, ModelVersion.approved.is_(True))
        .order_by(ModelVersion.approved_at.desc())
        .all()
    )
    candidates = (
        db.query(Experiment)
        .filter(Experiment.user_id == user.id, Experiment.status == "succeeded")
        .order_by(Experiment.finished_at.desc())
        .limit(10)
        .all()
    )
    predictions = (
        db.query(Prediction)
        .filter(Prediction.user_id == user.id)
        .order_by(Prediction.created_at.desc())
        .limit(40)
        .all()
    )
    matured = []
    for p in predictions:
        frame = cached_frame(db, p.symbol, "2y")
        if frame is None or frame.empty:
            continue
        dates = frame.index.date
        matches = [i for i, d in enumerate(dates) if d == p.as_of]
        if not matches:
            continue
        pos = matches[-1]
        if pos + p.horizon >= len(frame):
            continue
        start = float(frame["adj_close"].iloc[pos])
        end = float(frame["adj_close"].iloc[pos + p.horizon])
        realized = end / start - 1
        if p.target == "return":
            error = realized - float(p.point)
            direction_hit = (realized > 0) == (float(p.point) > 0)
        else:
            direction_hit = (realized > 0) == ((float(p.probability) if p.probability is not None else 0.5) > 0.5)
            error = None
        matured.append(
            {
                "prediction_id": p.id,
                "symbol": p.symbol,
                "as_of": p.as_of.isoformat(),
                "horizon": p.horizon,
                "predicted": float(p.point),
                "realized_return": round(realized, 6),
                "abs_error": round(abs(error), 6) if error is not None else None,
                "direction_hit": bool(direction_hit),
                "model_version_id": p.model_version_id,
            }
        )
    summary = {
        "matured": len(matured),
        "direction_hit_rate": round(sum(1 for m in matured if m["direction_hit"]) / len(matured), 4) if matured else None,
        "mean_abs_error": round(float(sum(m["abs_error"] for m in matured if m["abs_error"] is not None)) / max(1, sum(1 for m in matured if m["abs_error"] is not None)), 8)
        if any(m["abs_error"] is not None for m in matured)
        else None,
        "note": "Computed only when enough later bars exist. Small samples are not evidence of reliability.",
    }
    status = "validated_candidate" if approved else ("research_only" if candidates else "no_models")
    return {
        "status": status,
        "approved_models": [
            {
                "model_version_id": v.id,
                "experiment_id": v.experiment_id,
                "name": v.name,
                "target": v.target,
                "horizon": v.horizon,
                "approved_at": v.approved_at.isoformat() if v.approved_at else None,
                "validation": v.val_metrics,
                "test": v.test_metrics,
            }
            for v in approved
        ],
        "recent_candidates": [
            {
                "experiment_id": e.id,
                "symbol": e.symbol,
                "n_models_compared": len((e.metrics or {}).get("models") or []),
                "selected": ((e.metrics or {}).get("selected") or {}).get("name"),
                "validation": ((e.metrics or {}).get("selected") or {}).get("validation"),
                "test": ((e.metrics or {}).get("selected") or {}).get("test"),
                "warnings": (e.metrics or {}).get("warnings") or [],
            }
            for e in candidates
        ],
        "prediction_outcomes": {"summary": summary, "recent": matured[:20]},
        "drift": {
            "input_drift": "not_implemented",
            "prediction_drift": "not_implemented",
            "calibration_drift": "not_implemented",
            "reason": "No scheduled feature-distribution or calibration monitoring job is implemented. This dashboard does not claim drift detection.",
        },
        "warnings": [
            "No model is approved for production trading." if not approved else "Approval is a research promotion gate, not proof of future performance.",
            "Delayed-label outcomes cover only predictions with a matured horizon and available cached bars.",
        ],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/trading/status")
def trading_status(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    paper_accounts = db.query(PaperAccount).filter(PaperAccount.user_id == user.id).all()
    return {
        "modes": [
            {
                "id": "monitor",
                "label": "Monitor only",
                "available": False,
                "reason": "No streaming market-data feed or scheduled signal monitor is implemented.",
            },
            {
                "id": "paper",
                "label": "Manual paper trading",
                "available": True,
                "reason": "Simulated orders against delayed quotes with local accounting.",
                "accounts": len(paper_accounts),
            },
            {
                "id": "live_signals",
                "label": "Live signals, manual execution",
                "available": False,
                "reason": "No broker adapter or streaming feed; the platform will not present delayed research as executable live signals.",
            },
            {
                "id": "autonomous_live",
                "label": "Autonomous live trading",
                "available": False,
                "reason": "Hard-disabled. Requires a licensed streaming feed, official broker integration, reconciliation, tested risk limits and restart recovery.",
            },
        ],
        "live_trading_enabled": False,
        "paper_only": True,
        "kill_switch": {"exists": False, "reason": "No live execution path exists to halt."},
        "requirements_for_live": [
            "Official broker adapter with OAuth and account permissions",
            "Licensed streaming data with measured latency and staleness handling",
            "Idempotent order intents and broker reconciliation",
            "Server-side risk engine with daily-loss and exposure limits",
            "Tested restart recovery, emergency halt and audit trail",
            "Separate explicit activation flow and affirmative risk disclosure",
        ],
        "note": "One-second evaluation is not implemented. Even if it were, one-second evaluation would not imply one-second execution or profitable trading.",
    }


@router.get("/health")
def health():
    return {"status": "ok", "service": "stockpulse-api", "time": datetime.now(timezone.utc).isoformat()}


@router.get("/ready")
def ready(db: DbSession = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        raise HTTPException(status_code=503, detail="Database unavailable")
    return {"status": "ready", "provider": get_provider().name}


@router.get("/system/cron")
def cron_tick(request: Request, db: DbSession = Depends(get_db)) -> dict:
    """Scheduler tick for serverless deployments with no long-lived process.

    Vercel Cron requests this path and attaches ``Authorization: Bearer
    $CRON_SECRET`` whenever that variable is configured, so the endpoint is not
    open to the internet. It evaluates alerts, fills resting paper orders and
    runs any experiments/backtests still marked queued (bounded by a deadline).
    """
    secret = os.environ.get("CRON_SECRET", "").strip()
    if secret and request.headers.get("authorization", "") != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    from ..alerts_engine import drain_queued_jobs, run_scheduler_cycle

    result = run_scheduler_cycle(db)
    result.update(drain_queued_jobs())
    return {"ok": True, **result}
