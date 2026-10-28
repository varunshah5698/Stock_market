from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone

import pandas as pd
from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession

from ..config import settings
from ..models import Bar, DataCacheMeta, Instrument
from .base import HistoryResult, MarketDataProvider, ProviderError, ProviderMeta, QuoteResult
from .sample import SampleProvider
from .yahoo import YahooProvider

_provider_lock = threading.Lock()
_provider: MarketDataProvider | None = None
_quote_cache: dict[str, tuple[datetime, QuoteResult]] = {}
_quote_lock = threading.Lock()

_PERIOD_DAYS = {"1d": 1, "5d": 5, "7d": 7, "1mo": 30, "3mo": 92, "6mo": 183, "1y": 365, "2y": 730, "3y": 1095, "5y": 1825, "10y": 3650, "max": 20000}


def get_provider() -> MarketDataProvider:
    global _provider
    with _provider_lock:
        if _provider is None:
            _provider = SampleProvider() if settings.market_data_provider == "sample" else YahooProvider()
        return _provider


def provider_info() -> dict:
    p = get_provider()
    return {
        "name": p.name,
        "configured": True,
        "data_status": "simulated" if p.name == "sample" else "delayed",
        "notes": (
            "SIMULATED sample provider is active. All prices are synthetic."
            if p.name == "sample"
            else "Yahoo Finance via yfinance. Quotes and daily bars are delayed, not an exchange real-time feed."
        ),
    }


def init_instruments(db: DbSession) -> None:
    from .universe import UNIVERSE

    existing = {row[0] for row in db.query(Instrument.symbol).all()}
    for item in UNIVERSE:
        if item["symbol"] in existing:
            continue
        db.add(
            Instrument(
                symbol=item["symbol"],
                name=item["name"],
                exchange=item["exchange"],
                market=item["market"],
                currency=item["currency"],
                instrument_type=item.get("type", "equity"),
                sector=item["sector"],
                industry=item["industry"],
                timezone="Asia/Kolkata" if item["market"] == "IN" else "America/New_York",
            )
        )
    db.commit()


def normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper()


def _upsert_bars(db: DbSession, symbol: str, frame: pd.DataFrame, interval: str, provider_name: str) -> int:
    if frame.empty:
        return 0
    start = frame.index[0].to_pydatetime()
    existing = {
        row[0].replace(tzinfo=None) if getattr(row[0], "tzinfo", None) else row[0]
        for row in db.query(Bar.ts).filter(Bar.symbol == symbol, Bar.interval == interval, Bar.ts >= start).all()
    }
    now = datetime.now(timezone.utc)
    rows = []
    for ts, row in frame.iterrows():
        ts_dt = ts.to_pydatetime()
        if ts_dt.tzinfo is not None:
            ts_dt = ts_dt.astimezone(timezone.utc).replace(tzinfo=None)
        if ts_dt in existing:
            continue
        rows.append(
            Bar(
                symbol=symbol,
                interval=interval,
                ts=ts_dt,
                open=float(row["open"]),
                high=float(row["high"]),
                low=float(row["low"]),
                close=float(row["close"]),
                adj_close=float(row["adj_close"]),
                volume=float(row.get("volume", 0) or 0),
                provider=provider_name,
                fetched_at=now,
            )
        )
    if rows:
        db.bulk_save_objects(rows)
    return len(rows)


def _frame_from_db(db: DbSession, symbol: str, interval: str, period: str) -> pd.DataFrame | None:
    rows = (
        db.query(Bar)
        .filter(Bar.symbol == symbol, Bar.interval == interval)
        .order_by(Bar.ts.asc())
        .all()
    )
    if not rows:
        return None
    cutoff = datetime.now(timezone.utc) - timedelta(days=_PERIOD_DAYS.get(period, 1825))
    records = [
        {
            "ts": r.ts.replace(tzinfo=None) if getattr(r.ts, "tzinfo", None) else r.ts,
            "open": float(r.open),
            "high": float(r.high),
            "low": float(r.low),
            "close": float(r.close),
            "adj_close": float(r.adj_close),
            "volume": float(r.volume),
            "provider": r.provider,
        }
        for r in rows
        if (r.ts.replace(tzinfo=timezone.utc) if r.ts.tzinfo is None else r.ts) >= cutoff
    ]
    if not records:
        return None
    frame = pd.DataFrame(records).set_index("ts").sort_index()
    frame.index = pd.to_datetime(frame.index)
    return frame


def _cache_meta(db: DbSession, key: str) -> DataCacheMeta | None:
    return db.get(DataCacheMeta, key)


def _fresh(meta: DataCacheMeta | None) -> bool:
    if not meta:
        return False
    fetched = meta.fetched_at
    if fetched.tzinfo is None:
        fetched = fetched.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - fetched < timedelta(minutes=settings.data_cache_minutes)


def get_history(db: DbSession, symbol: str, period: str = "5y", interval: str = "1d") -> HistoryResult:
    symbol = normalize_symbol(symbol)
    provider = get_provider()
    key = f"hist:{provider.name}:{symbol}:{period}:{interval}"

    if provider.name == "sample":
        return provider.history(symbol, period, interval)

    meta = _cache_meta(db, key)
    cached = _frame_from_db(db, symbol, interval, period) if _fresh(meta) else None
    if cached is not None and len(cached) >= 30:
        meta = _cache_meta(db, key)
        payload = (meta.payload if meta else {}) or {}
        last_ts = cached.index[-1].to_pydatetime().replace(tzinfo=timezone.utc)
        return HistoryResult(
            frame=cached.drop(columns=["provider"], errors="ignore"),
            meta=ProviderMeta(
                provider=provider.name,
                data_status="end_of_day" if interval == "1d" else "delayed",
                fetched_at=(meta.fetched_at.replace(tzinfo=timezone.utc) if meta and meta.fetched_at.tzinfo is None else (meta.fetched_at if meta else datetime.now(timezone.utc))),
                currency=payload.get("currency", "USD"),
                exchange=payload.get("exchange", ""),
                observation_end=last_ts,
                warnings=["Served from cache within the configured freshness window."],
            ),
        )

    try:
        result = provider.history(symbol, period, interval)
    except ProviderError as exc:
        cached = _frame_from_db(db, symbol, interval, period)
        if cached is not None and len(cached) >= 30:
            last_ts = cached.index[-1].to_pydatetime().replace(tzinfo=timezone.utc)
            age_days = (datetime.now(timezone.utc) - last_ts).days
            return HistoryResult(
                frame=cached.drop(columns=["provider"], errors="ignore"),
                meta=ProviderMeta(
                    provider=provider.name,
                    data_status="end_of_day",
                    fetched_at=datetime.now(timezone.utc),
                    currency="USD",
                    exchange="",
                    observation_end=last_ts,
                    warnings=[
                        f"Live provider request failed ({exc.message[:160]}). Showing cached data; last observation is {age_days} days old."
                    ],
                ),
            )
        raise

    inserted = _upsert_bars(db, symbol, result.frame, interval, provider.name)
    db.merge(
        DataCacheMeta(
            key=key,
            provider=provider.name,
            fetched_at=datetime.now(timezone.utc),
            payload={
                "currency": result.meta.currency,
                "exchange": result.meta.exchange,
                "rows": len(result.frame),
                "inserted": inserted,
            },
        )
    )
    db.commit()
    frame = result.frame
    cutoff = datetime.now(timezone.utc) - timedelta(days=_PERIOD_DAYS.get(period, 1825))
    frame = frame[frame.index >= pd.Timestamp(cutoff.replace(tzinfo=None))]
    if len(frame) < 30:
        raise ProviderError(
            f"Only {len(frame)} historical observations are available for {symbol}; at least 30 are required.",
            retryable=False,
            symbol=symbol,
        )
    last_ts = frame.index[-1].to_pydatetime().replace(tzinfo=timezone.utc)
    age_days = (datetime.now(timezone.utc) - last_ts).days
    warnings = list(result.meta.warnings)
    if age_days > 7:
        warnings.append(f"Latest observation is {age_days} days old; the instrument may be delisted or the provider stale.")
    result.meta.warnings = warnings
    result.meta.observation_end = last_ts
    return result


def get_quote(db: DbSession, symbol: str) -> QuoteResult:
    symbol = normalize_symbol(symbol)
    now = datetime.now(timezone.utc)
    with _quote_lock:
        hit = _quote_cache.get(symbol)
        if hit and now - hit[0] < timedelta(seconds=60):
            return hit[1]
    provider = get_provider()
    try:
        quote = provider.quote(symbol)
    except ProviderError:
        result = get_history(db, symbol, "1mo")
        last = result.frame.iloc[-1]
        prev = result.frame.iloc[-2] if len(result.frame) > 1 else last
        result.meta.warnings.append("Quote unavailable; using last daily close.")
        result.meta.data_status = "end_of_day"
        quote = QuoteResult(
            symbol=symbol,
            price=float(last["adj_close"]),
            previous_close=float(prev["adj_close"]),
            currency=result.meta.currency,
            exchange=result.meta.exchange,
            observation_time=result.meta.observation_end,
            meta=result.meta,
        )
    with _quote_lock:
        _quote_cache[symbol] = (now, quote)
    return quote


def snapshots(db: DbSession, symbols: list[str]) -> dict[str, dict]:
    """Fast overview snapshots from daily bars, with missing data batch-filled."""
    symbols = [normalize_symbol(s) for s in symbols]
    frames: dict[str, pd.DataFrame] = {}
    missing: list[str] = []
    for symbol in symbols:
        frame = _frame_from_db(db, symbol, "1d", "3mo")
        if frame is None or len(frame) < 2:
            missing.append(symbol)
        else:
            frames[symbol] = frame
    if missing:
        provider = get_provider()
        try:
            results = provider.batch_history(missing, "3mo")
            for symbol, result in results.items():
                _upsert_bars(db, symbol, result.frame, "1d", provider.name)
                frames[symbol] = result.frame
            db.commit()
        except ProviderError:
            pass
    out: dict[str, dict] = {}
    for symbol in symbols:
        frame = frames.get(symbol)
        if frame is None or frame.empty:
            continue
        last = frame.iloc[-1]
        prev = frame.iloc[-2] if len(frame) > 1 else last
        price = float(last["adj_close"])
        prev_close = float(prev["adj_close"])
        change = (price / prev_close - 1) if prev_close else None
        out[symbol] = {
            "symbol": symbol,
            "price": round(price, 4),
            "previous_close": round(prev_close, 4),
            "change_pct": round(change * 100, 4) if change is not None else None,
            "as_of": str(frame.index[-1].date()),
            "currency": "INR" if symbol.endswith(".NS") else "USD",
            "data_status": "end_of_day",
            "provider": get_provider().name,
        }
    return out


def refresh_universe(db: DbSession, market: str = "US", period: str = "1y") -> dict:
    provider = get_provider()
    symbols = [
        row[0]
        for row in db.query(Instrument.symbol)
        .filter(Instrument.market == market, Instrument.in_universe.is_(True), Instrument.instrument_type == "equity")
        .all()
    ]
    key = f"universe:{provider.name}:{market}:{period}"
    meta = _cache_meta(db, key)
    if _fresh(meta):
        return {"symbols": symbols, "fetched_at": meta.fetched_at.isoformat() if meta else None, "cached": True, "failed": []}
    try:
        results = provider.batch_history(symbols, period)
    except ProviderError:
        raise
    failed = [s for s in symbols if s not in results]
    for symbol, result in results.items():
        _upsert_bars(db, symbol, result.frame, "1d", provider.name)
    db.merge(
        DataCacheMeta(
            key=key,
            provider=provider.name,
            fetched_at=datetime.now(timezone.utc),
            payload={"ok": len(results), "failed": failed},
        )
    )
    db.commit()
    return {
        "symbols": symbols,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
        "failed": failed,
        "provider": provider.name,
    }


def cached_frame(db: DbSession, symbol: str, period: str = "1y") -> pd.DataFrame | None:
    """Read-only view of locally cached bars. None when no cache exists."""
    return _frame_from_db(db, normalize_symbol(symbol), "1d", period)


def bar_count(db: DbSession) -> int:
    return int(db.query(func.count(Bar.id)).scalar() or 0)


def market_status(symbol: str) -> dict:
    """Clock-based session estimate. Exchange holidays and halts are not known here."""
    from zoneinfo import ZoneInfo

    symbol = normalize_symbol(symbol)
    tz_name = "Asia/Kolkata" if (symbol.endswith(".NS") or symbol.endswith(".BO") or symbol.startswith("^NSE") or symbol.startswith("^BSE")) else "America/New_York"
    now = datetime.now(ZoneInfo(tz_name))
    weekday = now.weekday() < 5
    minutes = now.hour * 60 + now.minute
    if tz_name == "Asia/Kolkata":
        open_m, close_m = 9 * 60 + 15, 15 * 60 + 30
    else:
        open_m, close_m = 9 * 60 + 30, 16 * 60
    if not weekday:
        status = "CLOSED"
    elif minutes < open_m:
        status = "PRE-MARKET" if minutes >= open_m - 120 else "CLOSED"
    elif minutes <= close_m:
        status = "OPEN"
    elif minutes <= close_m + 240:
        status = "POST-MARKET"
    else:
        status = "CLOSED"
    return {
        "status": status,
        "source": "clock_estimate",
        "exchange_time": now.isoformat(),
        "timezone": tz_name,
        "note": "Estimated from exchange hours. Holidays, halts and early closes are not checked.",
    }
