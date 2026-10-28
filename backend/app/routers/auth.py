from __future__ import annotations

import io
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session as DbSession

from ..config import settings
from ..db import get_db
from ..deps import audit, current_user
from ..models import PasswordReset, Preference, User, Watchlist, WatchlistItem
from ..ratelimit import client_ip, login_account_limiter, login_ip_limiter, register_limiter, reset_limiter
from ..schemas import ChangePasswordIn, ForgotIn, LoginIn, RegisterIn, ResetIn, UserOut
from ..security import (
    SESSION_COOKIE,
    create_session,
    hash_password,
    password_problem,
    secure_cookie_kwargs,
    token_hash,
    verify_password,
)
from ..marketdata.universe import WATCHLIST_STARTERS

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_days * 86400,
        **secure_cookie_kwargs(),
    )


@router.post("/register")
def register(payload: RegisterIn, request: Request, response: Response, db: DbSession = Depends(get_db)):
    ip = client_ip(request)
    register_limiter.check(ip)
    problem = password_problem(payload.password)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    email = payload.email.strip().lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        display_name=(payload.display_name or email.split("@")[0])[:120],
    )
    db.add(user)
    db.flush()
    db.add(Preference(user_id=user.id))
    default = Watchlist(user_id=user.id, name="Starter watchlist", is_default=True)
    db.add(default)
    db.flush()
    for i, symbol in enumerate(WATCHLIST_STARTERS):
        db.add(WatchlistItem(watchlist_id=default.id, symbol=symbol, sort_order=i))
    audit(db, user.id, "auth.register", ip=ip)
    db.commit()
    token = create_session(db, user, request)
    _set_cookie(response, token)
    return {"user": UserOut.model_validate(user), "message": "Account created."}


@router.post("/login")
def login(payload: LoginIn, request: Request, response: Response, db: DbSession = Depends(get_db)):
    ip = client_ip(request)
    email = payload.email.strip().lower()
    login_ip_limiter.check(ip)
    login_account_limiter.check(f"{ip}:{email}")
    user = db.query(User).filter(User.email == email, User.deleted_at.is_(None)).first()
    if not user or not verify_password(payload.password, user.password_hash):
        audit(db, user.id if user else None, "auth.login_failed", target=email, ip=ip)
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    token = create_session(db, user, request)
    login_account_limiter.reset(f"{ip}:{email}")
    audit(db, user.id, "auth.login", ip=ip)
    db.commit()
    _set_cookie(response, token)
    return {"user": UserOut.model_validate(user)}


@router.post("/logout")
def logout(request: Request, response: Response, db: DbSession = Depends(get_db)):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        from ..security import revoke_session

        revoke_session(db, token)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"message": "Signed out."}


@router.get("/me")
def me(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    pref = db.get(Preference, user.id)
    return {
        "user": UserOut.model_validate(user),
        "preferences": {
            "base_currency": pref.base_currency if pref else "USD",
            "default_market": pref.default_market if pref else "US",
            "default_horizon": pref.default_horizon if pref else 5,
            "theme": pref.theme if pref else "dark",
            "chart_defaults": pref.chart_defaults if pref else {},
            "notifications": pref.notifications if pref else {},
        },
        "capabilities": {
            "email_delivery": False,
            "mfa": False,
            "news_provider": bool(settings.news_api_key),
            "broker": bool(settings.broker_adapter),
            "market_data": settings.market_data_provider,
        },
    }


@router.post("/forgot-password")
def forgot_password(payload: ForgotIn, request: Request, db: DbSession = Depends(get_db)):
    reset_limiter.check(client_ip(request))
    user = db.query(User).filter(User.email == payload.email.strip().lower(), User.deleted_at.is_(None)).first()
    token = None
    if user:
        raw = secrets.token_urlsafe(32)
        db.add(
            PasswordReset(
                user_id=user.id,
                token_hash=token_hash(raw),
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
            )
        )
        db.commit()
        token = raw
    result = {
        "message": "If an account exists for that email, a password-reset link has been created.",
        "email_delivery": "not_configured",
        "note": "No email provider is configured in this deployment, so reset delivery is not active.",
    }
    if token and not settings.is_production:
        # Development convenience only; never returned in production.
        result["development_reset_token"] = token
    return result


@router.post("/change-password")
def change_password(
    payload: ChangePasswordIn,
    request: Request,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=403, detail="Current password is incorrect.")
    problem = password_problem(payload.new_password)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    user.password_hash = hash_password(payload.new_password)
    from ..models import Session as SessionRow

    current = request.cookies.get(SESSION_COOKIE)
    keep = token_hash(current) if current else None
    for session in db.query(SessionRow).filter(SessionRow.user_id == user.id, SessionRow.revoked_at.is_(None)).all():
        if session.token_hash != keep:
            session.revoked_at = datetime.now(timezone.utc)
    audit(db, user.id, "auth.change_password", ip=client_ip(request))
    db.commit()
    return {"message": "Password changed. Other sessions were revoked."}


@router.post("/reset-password")
def reset_password(payload: ResetIn, request: Request, db: DbSession = Depends(get_db)):
    reset_limiter.check(client_ip(request))
    problem = password_problem(payload.password)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    row = db.query(PasswordReset).filter(PasswordReset.token_hash == token_hash(payload.token)).first()
    now = datetime.now(timezone.utc)
    if not row:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token.")
    expires = row.expires_at.replace(tzinfo=timezone.utc) if row.expires_at.tzinfo is None else row.expires_at
    if row.used_at is not None or expires < now:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token.")
    user = db.get(User, row.user_id)
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token.")
    user.password_hash = hash_password(payload.password)
    row.used_at = now
    from ..models import Session as SessionRow

    for session in db.query(SessionRow).filter(SessionRow.user_id == user.id, SessionRow.revoked_at.is_(None)).all():
        session.revoked_at = now
    audit(db, user.id, "auth.password_reset", ip=client_ip(request))
    db.commit()
    return {"message": "Password updated. Sign in with your new password."}
