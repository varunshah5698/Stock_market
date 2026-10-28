from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session as DbSession

from ..analytics.features import FEATURE_DEFINITIONS, FEATURE_VERSION
from ..analytics.screener import screener_data
from ..analytics.indicators import atr_pct, bollinger, macd, rsi, sma
from ..db import get_db
from ..deps import current_user
from ..marketdata.base import ProviderError
from ..marketdata.service import (
    bar_count,
    cached_frame,
    get_history,
    get_provider,
    get_quote,
    market_status,
    provider_info,
    snapshots,
)
from ..marketdata.universe import BENCHMARKS
from ..models import (
    Alert,
    Backtest,
    Experiment,
    Instrument,
    Notification,
    Portfolio,
    Position,
    ResearchNote,
    ScreenerPreset,
    User,
    Watchlist,
    WatchlistItem,
)
from ..ml.validation import to_builtin
from ..ratelimit import SlidingWindowLimiter, client_ip

router = APIRouter(tags=["market"])
_pulse_limiter = SlidingWindowLimiter(60, 60)


@router.get("/api/v1/public/market-pulse", tags=["public"])
def public_market_pulse(request: Request, db: DbSession = Depends(get_db)):
    """Small, unauthenticated delayed-market strip for the landing page.

    No portfolio data is exposed. Fails honestly when the provider is
    unavailable instead of substituting fabricated prices.
    """
    _pulse_limiter.check(f"pulse:{client_ip(request)}")
    indices = ["^GSPC", "^IXIC", "^NSEI"]
    try:
        data = snapshots(db, indices)
    except Exception:
        raise HTTPException(status_code=503, detail="Market data provider is temporarily unavailable.")
    if not data:
        raise HTTPException(status_code=503, detail="Market data provider returned no observations.")
    return {
        "indices": [
            {
                **data[symbol],
                "name": {"^GSPC": "S&P 500", "^IXIC": "Nasdaq Composite", "^NSEI": "Nifty 50"}.get(symbol, symbol),
            }
            for symbol in indices
            if symbol in data
        ],
        "provider": provider_info(),
        "note": "Delayed/end-of-day data. Not a real-time exchange feed.",
    }


def _clean(value):
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if np.isfinite(f) else None


def _series(index: pd.DatetimeIndex, series: pd.Series) -> dict:
    return {
        "dates": [str(d.date()) for d in index],
        "values": [_clean(v) for v in series.tolist()],
    }


@router.get("/api/v1/markets/overview")
def overview(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    indices = ["^GSPC", "^IXIC", "^DJI", "^NSEI", "^BSESN"]
    watchlist = (
        db.query(Watchlist).filter(Watchlist.user_id == user.id).order_by(Watchlist.is_default.desc(), Watchlist.created_at).first()
    )
    watch_symbols = [i.symbol for i in watchlist.items] if watchlist else []
    portfolios = db.query(Portfolio).filter(Portfolio.user_id == user.id).all()
    position_symbols = [
        p.symbol for p in db.query(Position).join(Portfolio).filter(Portfolio.user_id == user.id).all()
    ]
    symbols = list(dict.fromkeys(indices + watch_symbols + position_symbols))
    try:
        prices = snapshots(db, symbols)
        price_error = None
    except ProviderError as exc:
        prices = {}
        price_error = exc.message
    except Exception as exc:
        prices = {}
        price_error = f"Market data unavailable: {str(exc)[:200]}"

    indices_payload = [
        {
            **prices[s],
            "name": next((i.name for i in db.query(Instrument).filter(Instrument.symbol == s).all()), s),
            "market": "IN" if s.startswith("^NSE") or s.startswith("^BSE") else "US",
        }
        for s in indices
        if s in prices
    ]

    watch_payload = [prices[s] for s in watch_symbols if s in prices]
    polled = ["AAPL", "MSFT", "NVDA", "TSLA", "RELIANCE.NS", "TCS.NS"]
    polled_payload = [prices[s] for s in polled if s in prices]

    sector_rows = []
    for inst in db.query(Instrument).filter(Instrument.market == "US", Instrument.instrument_type == "equity").all():
        frame = cached_frame(db, inst.symbol, "3mo")
        if frame is None or len(frame) < 25:
            continue
        ret = float(frame["adj_close"].iloc[-1] / frame["adj_close"].iloc[-22] - 1)
        sector_rows.append((inst.sector or "Unclassified", ret))
    sectors: dict[str, list[float]] = {}
    for sector, ret in sector_rows:
        sectors.setdefault(sector, []).append(ret)
    sector_payload = sorted(
        [
            {"sector": s, "avg_return_1m_pct": round(float(np.mean(v)) * 100, 3), "count": len(v)}
            for s, v in sectors.items()
        ],
        key=lambda x: x["avg_return_1m_pct"],
        reverse=True,
    )

    portfolio_payload = []
    for portfolio in portfolios:
        rows = []
        for pos in portfolio.positions:
            snap = prices.get(pos.symbol)
            if snap:
                rows.append((float(pos.quantity) * snap["price"], float(pos.quantity) * float(pos.avg_cost)))
        value = sum(r[0] for r in rows)
        cost = sum(r[1] for r in rows)
        portfolio_payload.append(
            {
                "id": portfolio.id,
                "name": portfolio.name,
                "market_value": round(value, 4),
                "unrealized_pnl": round(value - cost, 4),
                "positions": len(rows),
                "currency": portfolio.base_currency,
                "valuation": "delayed/end-of-day estimate",
            }
        )

    recent_experiments = (
        db.query(Experiment)
        .filter(Experiment.user_id == user.id)
        .order_by(Experiment.created_at.desc())
        .limit(5)
        .all()
    )
    recent_backtests = (
        db.query(Backtest)
        .filter(Backtest.user_id == user.id)
        .order_by(Backtest.created_at.desc())
        .limit(5)
        .all()
    )
    active_alerts = db.query(Alert).filter(Alert.user_id == user.id, Alert.is_active.is_(True)).count()
    unread = db.query(Notification).filter(Notification.user_id == user.id, Notification.read_at.is_(None)).count()
    instrument_count = db.query(Instrument).count()

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "provider": provider_info(),
        "market_status": market_status(BENCHMARKS["US"]),
        "indices": indices_payload,
        "watchlist": {"id": watchlist.id if watchlist else None, "name": watchlist.name if watchlist else None, "symbols": watch_payload},
        "market_movers": sorted([p for p in polled_payload if p.get("change_pct") is not None], key=lambda x: x["change_pct"], reverse=True),
        "sectors": sector_payload,
        "portfolios": portfolio_payload,
        "recent_experiments": [
            {
                "id": e.id,
                "symbol": e.symbol,
                "status": e.status,
                "target": (e.config or {}).get("target"),
                "horizon": (e.config or {}).get("horizon"),
                "created_at": e.created_at.isoformat(),
            }
            for e in recent_experiments
        ],
        "recent_backtests": [
            {
                "id": b.id,
                "symbol": b.symbol,
                "strategy_id": b.strategy_id,
                "status": b.status,
                "total_return": (b.metrics or {}).get("total_return"),
                "created_at": b.created_at.isoformat(),
            }
            for b in recent_backtests
        ],
        "alerts": {"active": active_alerts, "unread_notifications": unread},
        "coverage": {
            "instruments": instrument_count,
            "cached_bars": bar_count(db),
            "sector_metrics": "available" if sector_payload else "unavailable (universe not cached yet)",
        },
        "warnings": ([price_error] if price_error else [])
        + [
            "All prices in this overview are delayed or end-of-day, not a real-time feed.",
            "Watchlist percentage changes are not portfolio returns.",
        ],
    }


@router.get("/api/v1/markets/quotes")
def quotes(
    symbols: str = Query(..., max_length=400),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    wanted = [s.strip().upper() for s in symbols.split(",") if s.strip()][:20]
    if not wanted:
        raise HTTPException(status_code=422, detail="Provide at least one symbol")
    try:
        data = snapshots(db, wanted)
    except ProviderError as exc:
        raise HTTPException(status_code=503, detail=exc.message)
    return {
        "quotes": list(data.values()),
        "missing": [s for s in wanted if s not in data],
        "provider": provider_info(),
        "note": "End-of-day/delayed snapshots from cached daily bars.",
    }


@router.get("/api/v1/instruments/search")
def search(q: str = Query("", max_length=80), limit: int = Query(10, ge=1, le=25), db: DbSession = Depends(get_db)):
    local = db.query(Instrument).filter(Instrument.symbol.ilike(f"%{q.upper()}%") | Instrument.name.ilike(f"%{q}%")).limit(limit).all()
    results = [
        {
            "symbol": i.symbol,
            "name": i.name,
            "exchange": i.exchange,
            "market": i.market,
            "currency": i.currency,
            "sector": i.sector,
            "type": i.instrument_type,
        }
        for i in local
    ]
    if len(results) < limit and q:
        try:
            for r in get_provider().search(q, limit):
                if all(x["symbol"] != r["symbol"] for x in results):
                    results.append(r)
        except Exception:
            pass
    return {"results": results[:limit], "query": q}


@router.get("/api/v1/instruments/{symbol}/history")
def history(
    symbol: str,
    period: str = Query("1y", pattern=r"^(1mo|3mo|6mo|1y|2y|3y|5y|10y|max)$"),
    interval: str = Query("1d", pattern=r"^(1d)$"),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    try:
        result = get_history(db, symbol, period=period if period != "1mo" else "1y", interval=interval)
    except ProviderError as exc:
        raise HTTPException(status_code=503, detail=exc.message)
    frame = result.frame
    if period == "1mo":
        frame = frame.tail(22)
    elif period == "3mo":
        frame = frame.tail(64)
    elif period == "6mo":
        frame = frame.tail(126)
    inst = db.query(Instrument).filter(Instrument.symbol == symbol.upper()).first()
    return {
        "symbol": symbol.upper(),
        "instrument": {
            "name": inst.name if inst else symbol.upper(),
            "exchange": inst.exchange if inst else result.meta.exchange,
            "currency": result.meta.currency,
            "sector": inst.sector if inst else "",
            "type": inst.instrument_type if inst else "equity",
        },
        "meta": result.meta.as_dict(),
        "market_status": market_status(symbol),
        "bars": [
            {
                "date": str(idx.date()),
                "open": round(float(row["open"]), 6),
                "high": round(float(row["high"]), 6),
                "low": round(float(row["low"]), 6),
                "close": round(float(row["close"]), 6),
                "adj_close": round(float(row["adj_close"]), 6),
                "volume": round(float(row["volume"]), 2),
            }
            for idx, row in frame.iterrows()
        ],
    }


@router.get("/api/v1/instruments/{symbol}/profile")
def profile(symbol: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    symbol = symbol.upper()
    inst = db.query(Instrument).filter(Instrument.symbol == symbol).first()
    try:
        quote = get_quote(db, symbol)
    except ProviderError as exc:
        raise HTTPException(status_code=503, detail=exc.message)
    return {
        "symbol": symbol,
        "name": inst.name if inst else symbol,
        "exchange": inst.exchange if inst else quote.exchange,
        "market": inst.market if inst else "OTHER",
        "instrument_type": inst.instrument_type if inst else "equity",
        "currency": inst.currency if inst else quote.currency,
        "sector": inst.sector if inst else "",
        "industry": inst.industry if inst else "",
        "quote": {
            "price": round(quote.price, 4),
            "previous_close": round(quote.previous_close, 4) if quote.previous_close else None,
            "change_pct": round((quote.price / quote.previous_close - 1) * 100, 4) if quote.previous_close else None,
            "observation_time": quote.observation_time.isoformat() if quote.observation_time else None,
            "meta": quote.meta.as_dict(),
        },
        "market_status": market_status(symbol),
        "fundamentals": {
            "available": False,
            "reason": "No point-in-time fundamentals provider is configured. The platform does not fabricate valuation or earnings data.",
        },
    }


@router.get("/api/v1/instruments/{symbol}/indicators")
def indicators(
    symbol: str,
    period: str = Query("2y", pattern=r"^(1y|2y|3y|5y)$"),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    result = get_history(db, symbol, period=period, interval="1d")
    frame = result.frame
    close = frame["adj_close"].astype(float)
    high, low = frame["high"].astype(float), frame["low"].astype(float)
    macd_df = macd(close)
    bands = bollinger(close, 20)
    ind = {
        "sma_20": _series(frame.index, sma(close, 20)),
        "sma_50": _series(frame.index, sma(close, 50)),
        "sma_200": _series(frame.index, sma(close, 200)),
        "ema_21": _series(frame.index, close.ewm(span=21, adjust=False).mean()),
        "rsi_14": _series(frame.index, rsi(close, 14)),
        "macd_hist": _series(frame.index, macd_df["hist"]),
        "bb_upper": _series(frame.index, bands["upper"]),
        "bb_lower": _series(frame.index, bands["lower"]),
        "atr_pct": _series(frame.index, atr_pct(high, low, close, 14)),
        "volume_sma_20": _series(frame.index, frame["volume"].rolling(20).mean()),
    }
    ret = close.pct_change()
    drawdown = close / close.cummax() - 1
    latest = {
        "close": round(float(close.iloc[-1]), 4),
        "rsi_14": _clean(rsi(close, 14).iloc[-1]),
        "atr_14_pct": round(float(atr_pct(high, low, close, 14).iloc[-1] * 100), 4),
        "volatility_20d_pct": round(float(ret.tail(20).std(ddof=0) * np.sqrt(252) * 100), 3),
        "volatility_60d_pct": round(float(ret.tail(60).std(ddof=0) * np.sqrt(252) * 100), 3),
        "drawdown_from_peak_pct": round(float(drawdown.iloc[-1]) * 100, 3),
        "max_drawdown_pct": round(float(drawdown.min()) * 100, 3),
        "return_1w_pct": round(float(close.iloc[-1] / close.iloc[-6] - 1) * 100, 3) if len(close) > 6 else None,
        "return_1m_pct": round(float(close.iloc[-1] / close.iloc[-22] - 1) * 100, 3) if len(close) > 22 else None,
        "return_3m_pct": round(float(close.iloc[-1] / close.iloc[-64] - 1) * 100, 3) if len(close) > 64 else None,
        "return_1y_pct": round(float(close.iloc[-1] / close.iloc[-253] - 1) * 100, 3) if len(close) > 253 else None,
        "high_52w": round(float(close.tail(252).max()), 4),
        "low_52w": round(float(close.tail(252).min()), 4),
        "as_of": str(frame.index[-1].date()),
    }
    return {
        "symbol": symbol.upper(),
        "meta": result.meta.as_dict(),
        "self": {"dates": [str(d.date()) for d in frame.index], "close": [_clean(v) for v in close.tolist()]},
        "series": to_builtin(ind),
        "latest": latest,
    }


@router.get("/api/v1/instruments/{symbol}/notes")
def get_note(symbol: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    note = db.query(ResearchNote).filter(ResearchNote.user_id == user.id, ResearchNote.symbol == symbol.upper()).first()
    return {"symbol": symbol.upper(), "body": note.body if note else "", "updated_at": note.updated_at.isoformat() if note else None}


@router.put("/api/v1/instruments/{symbol}/notes")
def put_note(symbol: str, payload: dict, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    body = str(payload.get("body", ""))[:20_000]
    note = db.query(ResearchNote).filter(ResearchNote.user_id == user.id, ResearchNote.symbol == symbol.upper()).first()
    if note:
        note.body = body
    else:
        note = ResearchNote(user_id=user.id, symbol=symbol.upper(), body=body)
        db.add(note)
    db.commit()
    return {"symbol": symbol.upper(), "body": note.body, "updated_at": note.updated_at.isoformat()}


@router.get("/api/v1/screener")
def screener(
    market: str = Query("US", pattern=r"^(US|IN)$"),
    q: str = "",
    sector: str = "",
    min_price: float | None = None,
    max_price: float | None = None,
    min_return_1m: float | None = None,
    max_volatility: float | None = None,
    min_volatility: float | None = None,
    rsi_min: float | None = None,
    rsi_max: float | None = None,
    above_sma50: bool | None = None,
    min_volume_ratio: float | None = None,
    sort: str = Query("symbol", pattern=r"^(symbol|price|return_1m_pct|return_3m_pct|volatility_20d_pct|rsi_14|volume_ratio_20d)$"),
    order: str = Query("asc", pattern=r"^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=5, le=100),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    try:
        payload = screener_data(db, market)
    except ProviderError as exc:
        raise HTTPException(status_code=503, detail=exc.message)
    rows = payload["rows"]
    ql = q.strip().lower()
    filtered = []
    for row in rows:
        if ql and ql not in row["symbol"].lower() and ql not in row["name"].lower():
            continue
        if sector and row["sector"] != sector:
            continue
        if min_price is not None and (row["price"] or 0) < min_price:
            continue
        if max_price is not None and (row["price"] or 0) > max_price:
            continue
        if min_return_1m is not None and (row["return_1m_pct"] is None or row["return_1m_pct"] < min_return_1m):
            continue
        if max_volatility is not None and (row["volatility_20d_pct"] is None or row["volatility_20d_pct"] > max_volatility):
            continue
        if min_volatility is not None and (row["volatility_20d_pct"] is None or row["volatility_20d_pct"] < min_volatility):
            continue
        if rsi_min is not None and (row["rsi_14"] is None or row["rsi_14"] < rsi_min):
            continue
        if rsi_max is not None and (row["rsi_14"] is None or row["rsi_14"] > rsi_max):
            continue
        if above_sma50 is not None and row["above_sma_50"] != above_sma50:
            continue
        if min_volume_ratio is not None and (row["volume_ratio_20d"] is None or row["volume_ratio_20d"] < min_volume_ratio):
            continue
        filtered.append(row)
    reverse = order == "desc"
    populated = [r for r in filtered if r.get(sort) is not None]
    missing = [r for r in filtered if r.get(sort) is None]
    populated.sort(key=lambda r: r.get(sort), reverse=reverse)
    filtered = populated + missing
    total = len(filtered)
    start = (page - 1) * page_size
    page_rows = filtered[start : start + page_size]
    return {
        "rows": page_rows,
        "sectors": payload["sectors"],
        "meta": payload["meta"],
        "pagination": {"page": page, "page_size": page_size, "total": total, "pages": max(1, (total + page_size - 1) // page_size)},
        "filters": {"applied": total, "universe": len(rows)},
        "warnings": [] if rows else ["No cached screening data. The provider may be unavailable; try again."],
    }


@router.get("/api/v1/screener/presets")
def list_presets(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    rows = db.query(ScreenerPreset).filter(ScreenerPreset.user_id == user.id).order_by(ScreenerPreset.created_at.desc()).all()
    return {"presets": [{"id": r.id, "name": r.name, "filters": r.filters, "created_at": r.created_at.isoformat()} for r in rows]}


@router.post("/api/v1/screener/presets")
def create_preset(payload: dict, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    name = str(payload.get("name", "")).strip()[:80]
    filters = payload.get("filters") or {}
    if not name:
        raise HTTPException(status_code=422, detail="Preset name is required")
    if not isinstance(filters, dict):
        raise HTTPException(status_code=422, detail="Filters must be an object")
    preset = ScreenerPreset(user_id=user.id, name=name, filters=filters)
    db.add(preset)
    db.commit()
    return {"id": preset.id, "name": preset.name, "filters": preset.filters}


@router.delete("/api/v1/screener/presets/{preset_id}")
def delete_preset(preset_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    preset = db.query(ScreenerPreset).filter(ScreenerPreset.id == preset_id, ScreenerPreset.user_id == user.id).first()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    db.delete(preset)
    db.commit()
    return {"deleted": True}


@router.get("/api/v1/compare")
def compare(
    symbols: str = Query(..., max_length=200),
    period: str = Query("1y", pattern=r"^(6mo|1y|2y|3y|5y)$"),
    benchmark: str = Query("", max_length=32),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    wanted = [s.strip().upper() for s in symbols.split(",") if s.strip()][:6]
    if len(wanted) < 2:
        raise HTTPException(status_code=422, detail="Select at least two instruments")
    closes: dict[str, pd.Series] = {}
    meta = {}
    failed = []
    for symbol in wanted:
        try:
            result = get_history(db, symbol, period=period, interval="1d")
            closes[symbol] = result.frame["adj_close"].astype(float)
            meta[symbol] = result.meta.as_dict()
        except ProviderError as exc:
            failed.append({"symbol": symbol, "error": exc.message})
    if len(closes) < 2:
        raise HTTPException(status_code=503, detail="Could not load at least two instruments")
    bench_series = None
    if benchmark:
        try:
            bench_series = get_history(db, benchmark.upper(), period=period, interval="1d").frame["adj_close"].astype(float)
        except ProviderError:
            failed.append({"symbol": benchmark.upper(), "error": "Benchmark unavailable"})
    df = pd.DataFrame(closes).sort_index().ffill().dropna()
    if len(df) < 30:
        raise HTTPException(status_code=422, detail="Insufficient aligned observations for comparison")
    norm = df / df.iloc[0] * 100
    rets = df.pct_change().dropna()
    vol = rets.std(ddof=0) * np.sqrt(252)
    cumulative = df.iloc[-1] / df.iloc[0] - 1
    drawdowns = (df / df.cummax() - 1).min()
    corr = rets.corr()
    payload = {
        "symbols": list(df.columns),
        "period": period,
        "observations": len(df),
        "window": {"start": str(df.index[0].date()), "end": str(df.index[-1].date())},
        "normalized": {
            "dates": [str(d.date()) for d in norm.index],
            "series": {s: [_clean(v) for v in norm[s].tolist()] for s in norm.columns},
        },
        "summary": [
            {
                "symbol": s,
                "cumulative_return_pct": round(float(cumulative[s]) * 100, 3),
                "annualized_volatility_pct": round(float(vol[s]) * 100, 3),
                "max_drawdown_pct": round(float(drawdowns[s]) * 100, 3),
                "data_status": meta.get(s, {}).get("data_status"),
            }
            for s in df.columns
        ],
        "correlation": {"symbols": list(corr.columns), "matrix": [[round(float(v), 4) for v in row] for row in corr.to_numpy()]},
        "rolling_correlation": None,
        "failed": failed,
        "meta": meta,
        "warnings": [
            "Correlation is historical and unstable; it does not establish causation.",
            "Aligned observations only. Different exchange calendars can reduce the sample.",
        ],
    }
    if len(df.columns) >= 2:
        a, b = df.columns[0], df.columns[1]
        rolling = rets[a].rolling(30).corr(rets[b]).dropna()
        payload["rolling_correlation"] = {
            "pair": [a, b],
            "window": 30,
            "dates": [str(d.date()) for d in rolling.index],
            "values": [_clean(v) for v in rolling.tolist()],
        }
    if bench_series is not None:
        bench_ret = bench_series.reindex(df.index).ffill().pct_change().dropna()
        common = rets.index.intersection(bench_ret.index)
        if len(common) > 30:
            payload["benchmark"] = {
                "symbol": benchmark.upper(),
                "cumulative_return_pct": round(float(bench_series.reindex(df.index).ffill().iloc[-1] / bench_series.reindex(df.index).ffill().iloc[0] - 1) * 100, 3),
                "beta": {
                    s: round(float(np.cov(rets[s].reindex(common), bench_ret.reindex(common))[0, 1] / np.var(bench_ret.reindex(common), ddof=0)), 4)
                    for s in df.columns
                },
            }
    return to_builtin(payload)


@router.get("/api/v1/markets/status")
def status(symbol: str = Query("SPY", max_length=32)):
    return {"symbol": symbol.upper(), **market_status(symbol)}


@router.get("/api/v1/ml/feature-definitions")
def feature_definitions(user: User = Depends(current_user)):
    return {"version": FEATURE_VERSION, "features": FEATURE_DEFINITIONS}
