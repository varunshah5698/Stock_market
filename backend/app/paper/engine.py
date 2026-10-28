"""Paper-trading ledger.

Cash, quantities and fees are Decimal values. Money is quantized to 4 decimals
and quantities to 6. Every state change is committed in a single transaction.
This is a simulation: it never contacts a broker and never represents fills as
real executions.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from ..config import settings
from ..marketdata.service import get_quote, snapshots
from ..models import PaperAccount, PaperFill, PaperOrder, PaperPosition

MONEY = Decimal("0.0001")
QTY = Decimal("0.000001")


def dec(value) -> Decimal:
    return Decimal(str(value))


def q_money(value: Decimal) -> Decimal:
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


def q_qty(value: Decimal) -> Decimal:
    return value.quantize(QTY, rounding=ROUND_HALF_UP)


def order_dict(order: PaperOrder) -> dict:
    return {
        "id": order.id,
        "account_id": order.account_id,
        "symbol": order.symbol,
        "side": order.side,
        "quantity": float(order.quantity),
        "order_type": order.order_type,
        "limit_price": float(order.limit_price) if order.limit_price is not None else None,
        "status": order.status,
        "filled_quantity": float(order.filled_quantity),
        "avg_fill_price": float(order.avg_fill_price) if order.avg_fill_price is not None else None,
        "fees": float(order.fees),
        "reference_price": float(order.reference_price) if order.reference_price is not None else None,
        "rejection_reason": order.rejection_reason or None,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "mode": "PAPER",
        "idempotency_key": order.idempotency_key,
    }


def _reject(order: PaperOrder, reason: str, db: DbSession) -> dict:
    order.status = "REJECTED"
    order.rejection_reason = reason[:300]
    order.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"order": order_dict(order), "accepted": False}


def _try_fill(db: DbSession, account: PaperAccount, order: PaperOrder, reference: float) -> dict:
    ref = dec(reference)
    order.reference_price = ref
    order.updated_at = datetime.now(timezone.utc)
    marketable = True
    if order.order_type == "limit":
        limit = order.limit_price
        if limit is None:
            return _reject(order, "Limit order requires a limit price.", db)
        marketable = (order.side == "buy" and ref <= limit) or (order.side == "sell" and ref >= limit)
    if not marketable:
        order.status = "OPEN"
        db.commit()
        return {"order": order_dict(order), "accepted": True, "message": "Limit order is resting; it fills only if the market reaches the limit."}

    slip = dec(settings.paper_slippage_bps) / dec(10_000)
    commission_rate = dec(settings.paper_commission_bps) / dec(10_000)
    if order.side == "buy":
        fill_price = ref * (1 + slip)
        if order.order_type == "limit" and order.limit_price is not None:
            fill_price = min(fill_price, order.limit_price)
    else:
        fill_price = ref * (1 - slip)
        if order.order_type == "limit" and order.limit_price is not None:
            fill_price = max(fill_price, order.limit_price)
    fill_price = q_money(fill_price)
    qty = q_qty(order.quantity)
    notional = q_money(fill_price * qty)
    fee = q_money(notional * commission_rate)
    position = (
        db.query(PaperPosition)
        .filter(PaperPosition.account_id == account.id, PaperPosition.symbol == order.symbol)
        .first()
    )

    if order.side == "buy":
        total_cost = notional + fee
        if total_cost > account.cash:
            return _reject(order, f"Insufficient paper cash: need {total_cost}, available {account.cash}.", db)
        if notional < Decimal("1"):
            return _reject(order, "Order notional is below the 1.00 minimum.", db)
        if position:
            new_qty = q_qty(position.quantity + qty)
            position.avg_cost = q_money((position.quantity * position.avg_cost + notional + fee) / new_qty)
            position.quantity = new_qty
        else:
            position = PaperPosition(
                account_id=account.id,
                symbol=order.symbol,
                quantity=qty,
                avg_cost=q_money((notional + fee) / qty),
                realized_pnl=Decimal("0"),
            )
            db.add(position)
        account.cash = q_money(account.cash - total_cost)
    else:
        if not position or position.quantity < qty:
            return _reject(order, "Insufficient paper position to sell (short selling is not supported).", db)
        realized = q_money((fill_price - position.avg_cost) * qty - fee)
        position.quantity = q_qty(position.quantity - qty)
        position.realized_pnl = q_money(position.realized_pnl + realized)
        if position.quantity == 0:
            position.avg_cost = Decimal("0")
        account.cash = q_money(account.cash + notional - fee)

    order.status = "FILLED"
    order.filled_quantity = qty
    order.avg_fill_price = fill_price
    order.fees = fee
    order.rejection_reason = ""
    db.add(
        PaperFill(
            order_id=order.id,
            quantity=qty,
            price=fill_price,
            fees=fee,
        )
    )
    db.commit()
    return {"order": order_dict(order), "accepted": True}


def submit_order(db: DbSession, account: PaperAccount, payload) -> dict:
    existing = (
        db.query(PaperOrder)
        .filter(PaperOrder.account_id == account.id, PaperOrder.idempotency_key == payload.idempotency_key)
        .first()
    )
    if existing:
        return {"order": order_dict(existing), "accepted": existing.status != "REJECTED", "duplicate": True}

    try:
        quote = get_quote(db, payload.symbol)
    except Exception as exc:
        raise ValueError(f"Could not obtain a reference price for {payload.symbol}: {str(exc)[:200]}") from exc

    order = PaperOrder(
        account_id=account.id,
        user_id=account.user_id,
        symbol=payload.symbol.upper(),
        side=payload.side,
        quantity=q_qty(dec(payload.quantity)),
        order_type=payload.order_type,
        limit_price=dec(payload.limit_price) if payload.limit_price is not None else None,
        status="NEW",
        idempotency_key=payload.idempotency_key,
        reference_price=dec(quote.price),
    )
    db.add(order)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        existing = (
            db.query(PaperOrder)
            .filter(PaperOrder.account_id == account.id, PaperOrder.idempotency_key == payload.idempotency_key)
            .first()
        )
        if existing:
            return {"order": order_dict(existing), "accepted": True, "duplicate": True}
        raise
    return _try_fill(db, account, order, quote.price)


def process_open_orders(db: DbSession, account: PaperAccount) -> list[dict]:
    orders = (
        db.query(PaperOrder)
        .filter(PaperOrder.account_id == account.id, PaperOrder.status == "OPEN")
        .order_by(PaperOrder.created_at)
        .limit(50)
        .all()
    )
    results = []
    price_cache: dict[str, float] = {}
    for order in orders:
        if order.symbol not in price_cache:
            try:
                price_cache[order.symbol] = get_quote(db, order.symbol).price
            except Exception:
                continue
        results.append(_try_fill(db, account, order, price_cache[order.symbol]))
    return results


def cancel_order(db: DbSession, account: PaperAccount, order_id: str) -> dict:
    order = (
        db.query(PaperOrder)
        .filter(PaperOrder.id == order_id, PaperOrder.account_id == account.id)
        .first()
    )
    if not order:
        raise ValueError("Order not found")
    if order.status not in ("OPEN", "NEW"):
        raise ValueError(f"Cannot cancel an order in state {order.status}")
    order.status = "CANCELLED"
    order.updated_at = datetime.now(timezone.utc)
    db.commit()
    return order_dict(order)


def account_detail(db: DbSession, account: PaperAccount) -> dict:
    all_positions = db.query(PaperPosition).filter(PaperPosition.account_id == account.id).all()
    positions = [p for p in all_positions if p.quantity > 0]
    symbols = [p.symbol for p in positions]
    prices = snapshots(db, symbols) if symbols else {}
    rows = []
    warnings: list[str] = []
    for p in positions:
        if p.quantity <= 0:
            continue
        snap = prices.get(p.symbol)
        if not snap:
            try:
                quote = get_quote(db, p.symbol)
                price = quote.price
                as_of = quote.meta.observation_end.isoformat() if quote.meta.observation_end else None
                status = quote.meta.data_status
            except Exception:
                warnings.append(f"No current price for {p.symbol}; it is valued at cost.")
                price = float(p.avg_cost)
                as_of = None
                status = "unavailable"
        else:
            price = snap["price"]
            as_of = snap["as_of"]
            status = snap["data_status"]
        market_value = float(p.quantity) * price
        cost = float(p.quantity) * float(p.avg_cost)
        rows.append(
            {
                "symbol": p.symbol,
                "quantity": float(p.quantity),
                "avg_cost": float(p.avg_cost),
                "price": round(price, 4),
                "market_value": round(market_value, 4),
                "unrealized_pnl": round(market_value - cost, 4),
                "realized_pnl": float(p.realized_pnl),
                "as_of": as_of,
                "data_status": status,
            }
        )
    market_value = sum(r["market_value"] for r in rows)
    equity = float(account.cash) + market_value
    orders = (
        db.query(PaperOrder)
        .filter(PaperOrder.account_id == account.id)
        .order_by(PaperOrder.created_at.desc())
        .limit(50)
        .all()
    )
    fills = (
        db.query(PaperFill)
        .join(PaperOrder, PaperFill.order_id == PaperOrder.id)
        .filter(PaperOrder.account_id == account.id)
        .order_by(PaperFill.filled_at.desc())
        .limit(50)
        .all()
    )
    realized = sum(float(p.realized_pnl) for p in all_positions)
    return {
        "account": {
            "id": account.id,
            "name": account.name,
            "currency": account.currency,
            "starting_cash": float(account.starting_cash),
            "cash": float(account.cash),
            "mode": "PAPER",
        },
        "summary": {
            "cash": round(float(account.cash), 4),
            "market_value": round(market_value, 4),
            "equity": round(equity, 4),
            "unrealized_pnl": round(market_value - sum(r["quantity"] * r["avg_cost"] for r in rows), 4),
            "realized_pnl": round(realized, 4),
            "total_return_pct": round((equity / float(account.starting_cash) - 1) * 100, 4),
            "positions": len(rows),
        },
        "positions": rows,
        "orders": [order_dict(o) for o in orders],
        "fills": [
            {
                "id": f.id,
                "order_id": f.order_id,
                "quantity": float(f.quantity),
                "price": float(f.price),
                "fees": float(f.fees),
                "filled_at": f.filled_at.isoformat(),
            }
            for f in fills
        ],
        "warnings": warnings
        + [
            "PAPER TRADING ONLY. Orders are simulated locally and are never sent to an exchange or broker.",
            "Fills use delayed provider prices with configured slippage and commission; they are not achievable-fill guarantees.",
            "Limit orders do not reserve cash. Cash and positions are re-checked at fill time.",
        ],
        "costs": {
            "commission_bps": settings.paper_commission_bps,
            "slippage_bps": settings.paper_slippage_bps,
        },
    }
