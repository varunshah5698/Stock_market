from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session as DbSession

from ..analytics.portfolio import portfolio_detail, scenario_analysis
from ..db import get_db
from ..deps import audit, current_user
from ..models import Portfolio, PortfolioTransaction, Position, User
from ..schemas import PortfolioIn, PositionIn, ScenarioIn

router = APIRouter(prefix="/api/v1/portfolios", tags=["portfolios"])


def _owned(db: DbSession, user: User, portfolio_id: str) -> Portfolio:
    portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id, Portfolio.user_id == user.id).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return portfolio


@router.get("")
def list_portfolios(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    rows = db.query(Portfolio).filter(Portfolio.user_id == user.id).order_by(Portfolio.created_at).all()
    return {
        "portfolios": [
            {
                "id": p.id,
                "name": p.name,
                "base_currency": p.base_currency,
                "positions": len(p.positions),
                "created_at": p.created_at.isoformat(),
            }
            for p in rows
        ]
    }


@router.post("")
def create_portfolio(payload: PortfolioIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    portfolio = Portfolio(user_id=user.id, name=payload.name.strip(), base_currency=payload.base_currency.upper()[:8])
    db.add(portfolio)
    db.commit()
    return {"id": portfolio.id, "name": portfolio.name, "base_currency": portfolio.base_currency}


@router.get("/{portfolio_id}")
def get_portfolio(
    portfolio_id: str,
    benchmark: str = Query("SPY", max_length=32),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    portfolio = _owned(db, user, portfolio_id)
    return portfolio_detail(db, portfolio, benchmark=benchmark.upper())


@router.put("/{portfolio_id}")
def update_portfolio(portfolio_id: str, payload: dict, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    portfolio = _owned(db, user, portfolio_id)
    if "name" in payload:
        name = str(payload["name"]).strip()
        if not name:
            raise HTTPException(status_code=422, detail="Name cannot be empty")
        portfolio.name = name[:80]
    if "base_currency" in payload:
        portfolio.base_currency = str(payload["base_currency"]).upper()[:8]
    db.commit()
    return {"id": portfolio.id, "name": portfolio.name, "base_currency": portfolio.base_currency}


@router.delete("/{portfolio_id}")
def delete_portfolio(portfolio_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    portfolio = _owned(db, user, portfolio_id)
    db.delete(portfolio)
    audit(db, user.id, "portfolio.delete", target=portfolio_id)
    db.commit()
    return {"deleted": True}


@router.post("/{portfolio_id}/positions")
def add_position(portfolio_id: str, payload: PositionIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    portfolio = _owned(db, user, portfolio_id)
    existing = (
        db.query(Position)
        .filter(Position.portfolio_id == portfolio.id, Position.symbol == payload.symbol)
        .first()
    )
    qty = Decimal(str(payload.quantity))
    cost = Decimal(str(payload.avg_cost))
    if existing:
        new_qty = existing.quantity + qty
        existing.avg_cost = (existing.quantity * existing.avg_cost + qty * cost) / new_qty
        existing.quantity = new_qty
        existing.notes = payload.notes or existing.notes
        position = existing
    else:
        position = Position(
            portfolio_id=portfolio.id,
            symbol=payload.symbol,
            quantity=qty,
            avg_cost=cost,
            notes=payload.notes,
        )
        db.add(position)
    db.add(
        PortfolioTransaction(
            portfolio_id=portfolio.id,
            symbol=payload.symbol,
            side="buy",
            quantity=qty,
            price=cost,
            note="Manual position entry",
        )
    )
    audit(db, user.id, "portfolio.add_position", target=f"{portfolio.id}:{payload.symbol}")
    db.commit()
    return {"position_id": position.id, "symbol": position.symbol, "quantity": float(position.quantity), "avg_cost": float(position.avg_cost)}


@router.put("/{portfolio_id}/positions/{position_id}")
def update_position(
    portfolio_id: str,
    position_id: str,
    payload: PositionIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    portfolio = _owned(db, user, portfolio_id)
    position = (
        db.query(Position)
        .filter(Position.id == position_id, Position.portfolio_id == portfolio.id)
        .first()
    )
    if not position:
        raise HTTPException(status_code=404, detail="Position not found")
    position.symbol = payload.symbol
    position.quantity = Decimal(str(payload.quantity))
    position.avg_cost = Decimal(str(payload.avg_cost))
    position.notes = payload.notes
    db.commit()
    return {"position_id": position.id, "symbol": position.symbol, "quantity": float(position.quantity), "avg_cost": float(position.avg_cost)}


@router.delete("/{portfolio_id}/positions/{position_id}")
def delete_position(portfolio_id: str, position_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    portfolio = _owned(db, user, portfolio_id)
    position = db.query(Position).filter(Position.id == position_id, Position.portfolio_id == portfolio.id).first()
    if not position:
        raise HTTPException(status_code=404, detail="Position not found")
    db.add(
        PortfolioTransaction(
            portfolio_id=portfolio.id,
            symbol=position.symbol,
            side="sell",
            quantity=position.quantity,
            price=position.avg_cost,
            note="Manual position removal at cost (no realized P/L recorded)",
        )
    )
    db.delete(position)
    audit(db, user.id, "portfolio.remove_position", target=f"{portfolio.id}:{position.symbol}")
    db.commit()
    return {"deleted": True}


@router.get("/{portfolio_id}/transactions")
def transactions(portfolio_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    portfolio = _owned(db, user, portfolio_id)
    rows = (
        db.query(PortfolioTransaction)
        .filter(PortfolioTransaction.portfolio_id == portfolio.id)
        .order_by(PortfolioTransaction.executed_at.desc())
        .limit(200)
        .all()
    )
    return {
        "transactions": [
            {
                "id": t.id,
                "symbol": t.symbol,
                "side": t.side,
                "quantity": float(t.quantity),
                "price": float(t.price),
                "fees": float(t.fees),
                "note": t.note,
                "executed_at": t.executed_at.isoformat(),
            }
            for t in rows
        ],
        "note": "Manually recorded entries only. Removing a position does not compute realized P/L.",
    }


@router.post("/{portfolio_id}/scenario")
def scenario(portfolio_id: str, payload: ScenarioIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    conflict = _owned(db, user, portfolio_id)
    try:
        result = scenario_analysis(db, conflict, payload.weights)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    result["portfolio_id"] = portfolio_id
    result["generated_at"] = datetime.now(timezone.utc).isoformat()
    return result
