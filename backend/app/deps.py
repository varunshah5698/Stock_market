from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session as DbSession

from .db import get_db
from .models import AuditEvent, Session, User
from .security import SESSION_COOKIE, token_hash


def current_user(request: Request, db: DbSession = Depends(get_db)) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    session = db.query(Session).filter(Session.token_hash == token_hash(token)).first()
    if not session or session.revoked_at is not None:
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    expires = session.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    user = db.get(User, session.user_id)
    if not user or user.deleted_at is not None:
        raise HTTPException(status_code=401, detail="Account unavailable")
    return user


def audit(db: DbSession, user_id: str | None, action: str, target: str | None = "", ip: str | None = "", **meta) -> None:
    db.add(AuditEvent(user_id=user_id, action=action, target=(target or "")[:120], ip=(ip or "")[:64], meta=meta))
