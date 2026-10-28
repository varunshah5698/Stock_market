from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession

from ..config import settings
from ..db import get_db
from ..deps import audit, current_user
from ..models import PaperAccount, User
from ..paper.engine import account_detail, cancel_order, dec, process_open_orders, q_money, submit_order
from ..schemas import PaperAccountIn, PaperOrderIn

router = APIRouter(prefix="/api/v1/paper-trading", tags=["paper-trading"])


def _owned(db: DbSession, user: User, account_id: str) -> PaperAccount:
    account = db.query(PaperAccount).filter(PaperAccount.id == account_id, PaperAccount.user_id == user.id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Paper account not found")
    return account


@router.get("/accounts")
def list_accounts(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    rows = db.query(PaperAccount).filter(PaperAccount.user_id == user.id).order_by(PaperAccount.created_at).all()
    return {
        "accounts": [
            {
                "id": a.id,
                "name": a.name,
                "currency": a.currency,
                "starting_cash": float(a.starting_cash),
                "cash": float(a.cash),
                "mode": "PAPER",
                "created_at": a.created_at.isoformat(),
            }
            for a in rows
        ],
        "note": "All paper accounts are simulated. They are never connected to a broker.",
    }


@router.post("/accounts")
def create_account(payload: PaperAccountIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    account = PaperAccount(
        user_id=user.id,
        name=payload.name[:80],
        currency="USD",
        starting_cash=q_money(dec(payload.starting_cash)),
        cash=q_money(dec(payload.starting_cash)),
    )
    db.add(account)
    db.flush()
    audit(db, user.id, "paper.account_create", target=account.id)
    db.commit()
    return {
        "account": {
            "id": account.id,
            "name": account.name,
            "currency": account.currency,
            "starting_cash": float(account.starting_cash),
            "cash": float(account.cash),
            "mode": "PAPER",
        }
    }


@router.get("/accounts/{account_id}")
def get_account(account_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    return account_detail(db, _owned(db, user, account_id))


@router.post("/orders")
def place_order(payload: PaperOrderIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    account = _owned(db, user, payload.account_id)
    if payload.order_type == "limit" and payload.limit_price is None:
        raise HTTPException(status_code=422, detail="Limit orders require a limit price")
    try:
        result = submit_order(db, account, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    audit(db, user.id, "paper.order", target=f"{payload.symbol}:{payload.side}:{result['order']['status']}")
    db.commit()
    return result


@router.post("/accounts/{account_id}/orders/{order_id}/cancel")
def cancel(account_id: str, order_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    account = _owned(db, user, account_id)
    try:
        order = cancel_order(db, account, order_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return {"order": order, "mode": "PAPER"}


@router.post("/accounts/{account_id}/process-orders")
def process_orders(account_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    account = _owned(db, user, account_id)
    results = process_open_orders(db, account)
    return {
        "evaluated": len(results),
        "results": results,
        "note": "Resting limit orders are evaluated against the latest delayed quote. This is not a live order book.",
    }


@router.post("/accounts/{account_id}/reset")
def reset_account(account_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    account = _owned(db, user, account_id)
    from ..models import PaperFill, PaperOrder, PaperPosition

    db.query(PaperFill).filter(PaperFill.order_id.in_([o.id for o in db.query(PaperOrder).filter(PaperOrder.account_id == account.id).all()])).delete(synchronize_session=False)
    db.query(PaperOrder).filter(PaperOrder.account_id == account.id).delete(synchronize_session=False)
    db.query(PaperPosition).filter(PaperPosition.account_id == account.id).delete(synchronize_session=False)
    account.cash = account.starting_cash
    audit(db, user.id, "paper.account_reset", target=account.id)
    db.commit()
    return {"reset": True, "cash": float(account.cash), "mode": "PAPER"}
