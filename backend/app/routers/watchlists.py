from __future__ import annotations

import re
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session as DbSession

from ..db import get_db
from ..deps import audit, current_user
from ..marketdata.service import get_history, snapshots
from ..models import User, Watchlist, WatchlistItem
from ..schemas import ReorderIn, WatchlistIn, WatchlistItemIn
from ..ml.validation import to_builtin

router = APIRouter(prefix="/api/v1/watchlists", tags=["watchlists"])
SYMBOL_RE = re.compile(r"^[A-Z0-9.\-^=]{1,32}$")


def _get_owned(db: DbSession, user: User, watchlist_id: str) -> Watchlist:
    wl = db.query(Watchlist).filter(Watchlist.id == watchlist_id, Watchlist.user_id == user.id).first()
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    return wl


def _serialize(wl: Watchlist, prices: dict[str, dict] | None = None) -> dict:
    return {
        "id": wl.id,
        "name": wl.name,
        "is_default": wl.is_default,
        "created_at": wl.created_at.isoformat(),
        "items": [
            {
                "id": item.id,
                "symbol": item.symbol,
                "note": item.note,
                "sort_order": item.sort_order,
                "added_at": item.added_at.isoformat(),
                **({"quote": prices[item.symbol]} if prices and item.symbol in prices else {}),
            }
            for item in sorted(wl.items, key=lambda i: i.sort_order)
        ],
    }


@router.get("")
def list_watchlists(with_prices: bool = True, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    lists = (
        db.query(Watchlist)
        .filter(Watchlist.user_id == user.id)
        .order_by(Watchlist.is_default.desc(), Watchlist.created_at)
        .all()
    )
    symbols = list({i.symbol for wl in lists for i in wl.items})
    prices = {}
    warnings = []
    if with_prices and symbols:
        try:
            prices = snapshots(db, symbols)
        except Exception as exc:
            warnings.append(f"Prices unavailable: {str(exc)[:160]}")
    return {
        "watchlists": [_serialize(wl, prices) for wl in lists],
        "warnings": warnings,
        "note": "Prices are delayed/end-of-day snapshots. Percent changes are not portfolio returns.",
    }


@router.post("")
def create_watchlist(payload: WatchlistIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    if payload.is_default:
        db.query(Watchlist).filter(Watchlist.user_id == user.id).update({"is_default": False})
    wl = Watchlist(user_id=user.id, name=payload.name.strip(), is_default=payload.is_default)
    db.add(wl)
    db.flush()
    audit(db, user.id, "watchlist.create", target=wl.id)
    db.commit()
    return _serialize(wl)


@router.put("/{watchlist_id}")
def update_watchlist(watchlist_id: str, payload: dict, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    wl = _get_owned(db, user, watchlist_id)
    if "name" in payload:
        name = str(payload["name"]).strip()
        if not name:
            raise HTTPException(status_code=422, detail="Name cannot be empty")
        wl.name = name[:80]
    if payload.get("is_default"):
        db.query(Watchlist).filter(Watchlist.user_id == user.id).update({"is_default": False})
        wl.is_default = True
    db.commit()
    return _serialize(wl)


@router.delete("/{watchlist_id}")
def delete_watchlist(watchlist_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    wl = _get_owned(db, user, watchlist_id)
    db.delete(wl)
    audit(db, user.id, "watchlist.delete", target=watchlist_id)
    db.commit()
    return {"deleted": True}


@router.post("/{watchlist_id}/items")
def add_item(watchlist_id: str, payload: WatchlistItemIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    wl = _get_owned(db, user, watchlist_id)
    symbol = payload.symbol
    if not SYMBOL_RE.match(symbol):
        raise HTTPException(status_code=422, detail="Invalid symbol format")
    existing = next((i for i in wl.items if i.symbol == symbol), None)
    if existing:
        return {"item": _serialize(wl)["items"][[i.symbol for i in wl.items].index(symbol)], "duplicate": True}
    order = max((i.sort_order for i in wl.items), default=-1) + 1
    item = WatchlistItem(watchlist_id=wl.id, symbol=symbol, note=payload.note, sort_order=order)
    db.add(item)
    audit(db, user.id, "watchlist.add_symbol", target=f"{wl.id}:{symbol}")
    db.commit()
    db.refresh(item)
    return {
        "item": {"id": item.id, "symbol": item.symbol, "note": item.note, "sort_order": item.sort_order},
        "duplicate": False,
    }


@router.delete("/{watchlist_id}/items/{symbol}")
def remove_item(watchlist_id: str, symbol: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    wl = _get_owned(db, user, watchlist_id)
    item = next((i for i in wl.items if i.symbol == symbol.upper()), None)
    if not item:
        raise HTTPException(status_code=404, detail="Symbol not in watchlist")
    db.delete(item)
    db.commit()
    return {"deleted": True}


@router.put("/{watchlist_id}/reorder")
def reorder(watchlist_id: str, payload: ReorderIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    wl = _get_owned(db, user, watchlist_id)
    by_symbol = {i.symbol: i for i in wl.items}
    unknown = [s for s in payload.symbols if s.upper() not in by_symbol]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown symbols: {', '.join(unknown)}")
    for idx, symbol in enumerate(payload.symbols):
        by_symbol[symbol.upper()].sort_order = idx
    db.commit()
    return _serialize(wl)


def _performance(db: DbSession, symbols: list[str], period: str) -> dict:
    series = []
    used = []
    failed = []
    for symbol in symbols:
        try:
            result = get_history(db, symbol, period=period, interval="1d")
            series.append(result.frame["adj_close"].rename(symbol))
            used.append(symbol)
        except Exception as exc:
            failed.append({"symbol": symbol, "error": str(exc)[:120]})
    if not series:
        raise HTTPException(status_code=503, detail="No price history available for this watchlist")
    df = pd.concat(series, axis=1).sort_index().ffill().dropna(how="all")
    returns = df.pct_change()
    equal_weight = returns.mean(axis=1, skipna=True)
    curve = (1 + equal_weight.fillna(0)).cumprod() * 100
    return {
        "symbols": used,
        "failed": failed,
        "dates": [str(d.date()) for d in curve.index],
        "values": [round(float(v), 4) for v in curve.tolist()],
        "cumulative_return_pct": round(float(curve.iloc[-1] - 100), 4),
        "observations": len(curve),
        "method": "Equal-weight daily rebalanced index of available watchlist symbols, starting at 100.",
        "warnings": [
            "Watchlist performance is not your portfolio return.",
            "Equal weighting ignores position sizes, costs, currency and survivorship.",
        ]
        + ([f"Excluded {len(failed)} symbols with no history."] if failed else []),
    }


@router.get("/{watchlist_id}/performance")
def watchlist_performance(
    watchlist_id: str,
    period: str = Query("1y", pattern=r"^(6mo|1y|2y|3y|5y)$"),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    wl = _get_owned(db, user, watchlist_id)
    if len(wl.items) < 1:
        raise HTTPException(status_code=422, detail="Watchlist is empty")
    return to_builtin(_performance(db, [i.symbol for i in wl.items][:20], period))


@router.get("/comparison")
def compare_watchlists(
    ids: str = Query(..., max_length=300),
    period: str = Query("1y", pattern=r"^(6mo|1y|2y|3y|5y)$"),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    wanted = [i for i in ids.split(",") if i]
    if len(wanted) < 2:
        raise HTTPException(status_code=422, detail="Select at least two watchlists")
    out = []
    for wid in wanted[:4]:
        wl = _get_owned(db, user, wid)
        if not wl.items:
            out.append({"id": wl.id, "name": wl.name, "error": "Empty watchlist"})
            continue
        perf = _performance(db, [i.symbol for i in wl.items][:20], period)
        out.append({"id": wl.id, "name": wl.name, **perf})
    return {"period": period, "watchlists": out, "generated_at": datetime.now(timezone.utc).isoformat()}
