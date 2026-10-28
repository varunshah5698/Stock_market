from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session as DbSession

from ..alerts_engine import evaluate_alerts
from ..db import get_db
from ..deps import audit, current_user
from ..models import Alert, AlertEvent, Notification, User
from ..ratelimit import client_ip, job_limiter
from ..schemas import AlertIn, AlertUpdateIn

router = APIRouter(prefix="/api/v1", tags=["alerts"])


def _alert_dict(alert: Alert) -> dict:
    return {
        "id": alert.id,
        "symbol": alert.symbol,
        "kind": alert.kind,
        "threshold": (alert.params or {}).get("threshold"),
        "cooldown_minutes": alert.cooldown_minutes,
        "is_active": alert.is_active,
        "last_fired_at": alert.last_fired_at.isoformat() if alert.last_fired_at else None,
        "created_at": alert.created_at.isoformat(),
        "monitoring": "periodic (not streaming)",
    }


def _owned(db: DbSession, user: User, alert_id: str) -> Alert:
    alert = db.query(Alert).filter(Alert.id == alert_id, Alert.user_id == user.id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


@router.get("/alerts")
def list_alerts(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    alerts = db.query(Alert).filter(Alert.user_id == user.id).order_by(Alert.created_at.desc()).all()
    events = (
        db.query(AlertEvent)
        .filter(AlertEvent.user_id == user.id)
        .order_by(AlertEvent.triggered_at.desc())
        .limit(30)
        .all()
    )
    return {
        "alerts": [_alert_dict(a) for a in alerts],
        "events": [
            {
                "id": e.id,
                "alert_id": e.alert_id,
                "message": e.message,
                "value": float(e.value) if e.value is not None else None,
                "data": e.data,
                "triggered_at": e.triggered_at.isoformat(),
            }
            for e in events
        ],
        "monitoring": {
            "mode": "periodic",
            "note": "Alerts are evaluated by a periodic server job and on-demand checks. This is not a WebSocket price feed; firing can be delayed.",
        },
    }


@router.post("/alerts")
def create_alert(payload: AlertIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    alert = Alert(
        user_id=user.id,
        symbol=payload.symbol,
        kind=payload.kind,
        params={"threshold": payload.threshold},
        cooldown_minutes=payload.cooldown_minutes,
    )
    db.add(alert)
    audit(db, user.id, "alert.create", target=f"{payload.symbol}:{payload.kind}")
    db.commit()
    return _alert_dict(alert)


@router.patch("/alerts/{alert_id}")
def update_alert(alert_id: str, payload: AlertUpdateIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    alert = _owned(db, user, alert_id)
    if payload.threshold is not None:
        alert.params = {**(alert.params or {}), "threshold": payload.threshold}
    if payload.cooldown_minutes is not None:
        alert.cooldown_minutes = payload.cooldown_minutes
    if payload.is_active is not None:
        alert.is_active = payload.is_active
    db.commit()
    return _alert_dict(alert)


@router.delete("/alerts/{alert_id}")
def delete_alert(alert_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    alert = _owned(db, user, alert_id)
    db.delete(alert)
    audit(db, user.id, "alert.delete", target=alert_id)
    db.commit()
    return {"deleted": True}


@router.post("/alerts/check")
def check_alerts(alert_ids: str = Query("", max_length=1000), user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    job_limiter.check(f"alert-check:{user.id}")
    ids = [i for i in alert_ids.split(",") if i] or None
    fired = evaluate_alerts(db, user.id, alert_ids=ids, limit=50)
    return {"checked_at": datetime.now(timezone.utc).isoformat(), "triggered": fired, "note": "Evaluation uses delayed quotes."}


@router.get("/notifications")
def notifications(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    rows = (
        db.query(Notification)
        .filter(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc())
        .limit(50)
        .all()
    )
    unread = (
        db.query(Notification)
        .filter(Notification.user_id == user.id, Notification.read_at.is_(None))
        .count()
    )
    return {
        "notifications": [
            {
                "id": n.id,
                "title": n.title,
                "body": n.body,
                "kind": n.kind,
                "link": n.link,
                "read": n.read_at is not None,
                "created_at": n.created_at.isoformat(),
            }
            for n in rows
        ],
        "unread": unread,
    }


@router.post("/notifications/{notification_id}/read")
def mark_read(notification_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    row = db.query(Notification).filter(Notification.id == notification_id, Notification.user_id == user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    row.read_at = datetime.now(timezone.utc)
    db.commit()
    return {"read": True}


@router.post("/notifications/read-all")
def mark_all_read(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    db.query(Notification).filter(Notification.user_id == user.id, Notification.read_at.is_(None)).update(
        {"read_at": datetime.now(timezone.utc)}
    )
    db.commit()
    return {"read": True}
