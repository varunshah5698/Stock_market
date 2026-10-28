from __future__ import annotations

import time
import warnings
from datetime import datetime, timezone

import pandas as pd

from .base import HistoryResult, MarketDataProvider, ProviderError, ProviderMeta, QuoteResult
from .resample import resample_ohlcv

warnings.filterwarnings("ignore", module="yfinance.*")
warnings.filterwarnings("ignore", message=".*inplace keyword.*")

_PERIOD = {"1y": "1y", "2y": "2y", "3y": "3y", "5y": "5y", "10y": "10y", "max": "max"}

_INTRADAY_INTERVALS = ("1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h")
# Yahoo has no native 3-minute interval ("interval=3m is not supported"), so it
# is aggregated from one-minute bars here instead of being sent to the provider.
_DERIVED_INTERVALS = {"3m": ("1m", 3)}
SUPPORTED_INTERVALS = ("1m", "3m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d")

_PERIOD_DAYS = {
    "1d": 1,
    "5d": 5,
    "7d": 7,
    "1mo": 30,
    "3mo": 92,
    "6mo": 183,
    "1y": 365,
    "2y": 730,
    "3y": 1095,
    "5y": 1825,
    "10y": 3650,
    "max": 20000,
}

# Provider lookback limits per intraday interval, measured against yfinance:
# one-minute history is capped at roughly 8 days, sub-hourly at 60 days.
_INTERVAL_MAX_DAYS = {"1m": 7, "2m": 60, "5m": 60, "15m": 60, "30m": 60, "60m": 730, "90m": 60, "1h": 730}


def _currency_for(symbol: str) -> tuple[str, str]:
    if symbol.endswith(".NS"):
        return "INR", "NSE"
    if symbol.endswith(".BO"):
        return "INR", "BSE"
    if symbol.startswith("^NSE") or symbol.startswith("^BSE"):
        return "INR", "INDEX"
    if symbol.startswith("^"):
        return "USD", "INDEX"
    return "USD", "US"


def _normalize_history(frame: pd.DataFrame, symbol: str) -> pd.DataFrame:
    if frame is None or frame.empty:
        raise ProviderError(f"No historical data returned for {symbol}.", retryable=False, symbol=symbol)
    frame = frame.copy()
    frame.columns = [str(c).strip().title().replace(" ", "") for c in frame.columns]
    renamed = {
        "Adjclose": "adj_close",
        "AdjClose": "adj_close",
        "Open": "open",
        "High": "high",
        "Low": "low",
        "Close": "close",
        "Volume": "volume",
    }
    frame = frame.rename(columns=renamed)
    if "close" not in frame.columns:
        raise ProviderError(f"Provider response for {symbol} had no close prices.", symbol=symbol)
    for col in ("open", "high", "low", "close"):
        if col not in frame.columns:
            frame[col] = frame["close"]
    if "adj_close" not in frame.columns:
        frame["adj_close"] = frame["close"]
    if "volume" not in frame.columns:
        frame["volume"] = 0.0
    frame = frame[["open", "high", "low", "close", "adj_close", "volume"]]
    for col in frame.columns:
        frame[col] = pd.to_numeric(frame[col], errors="coerce")
    frame = frame[~frame["close"].isna()]
    frame = frame[frame["close"] > 0]
    frame = frame[~frame.index.duplicated(keep="last")].sort_index()
    if frame.empty:
        raise ProviderError(f"No valid price rows for {symbol}.", retryable=False, symbol=symbol)
    idx = pd.DatetimeIndex(frame.index)
    if idx.tz is not None:
        idx = idx.tz_convert("UTC").tz_localize(None)
    frame.index = idx
    frame.index.name = "ts"
    return frame


class YahooProvider(MarketDataProvider):
    name = "yahoo"

    def _ticker(self, symbol: str):
        import yfinance as yf

        return yf.Ticker(symbol)

    def history(self, symbol: str, period: str = "5y", interval: str = "1d") -> HistoryResult:
        if interval not in SUPPORTED_INTERVALS:
            raise ProviderError(
                f"Interval '{interval}' is not supported. Use one of: {', '.join(SUPPORTED_INTERVALS)}.",
                retryable=False,
                symbol=symbol,
            )
        source_interval, bucket_minutes = _DERIVED_INTERVALS.get(interval, (interval, None))
        notes: list[str] = []
        if bucket_minutes:
            notes.append(
                f"{interval} candles are aggregated server-side from {source_interval} bars; "
                f"the provider has no native {interval} interval."
            )
        yf_period = _PERIOD.get(period, "5y")
        if interval != "1d":
            cap = _INTERVAL_MAX_DAYS[source_interval]
            requested_days = _PERIOD_DAYS.get(period, 365)
            days = min(requested_days, cap)
            if requested_days > cap:
                notes.append(
                    f"{interval} bars are limited to a ~{cap}-day lookback by the provider; "
                    f"showing the most recent {days} days instead of {period}."
                )
            yf_period = f"{days}d"

        last_error: Exception | None = None
        for attempt in range(2):
            try:
                raw = self._ticker(symbol).history(
                    period=yf_period, interval=source_interval, auto_adjust=False, actions=False
                )
                if raw is None or raw.empty:
                    # Yahoo returns an empty frame (not an exception) when an
                    # intraday range exceeds its retention window.
                    if interval != "1d":
                        raise ProviderError(
                            f"No {interval} bars are available for {symbol}. The provider keeps about "
                            f"{_INTERVAL_MAX_DAYS[source_interval]} days of {source_interval} history and "
                            "has no bars for closed sessions.",
                            retryable=False,
                            symbol=symbol,
                        )
                    raise ProviderError(f"No historical data returned for {symbol}.", retryable=False, symbol=symbol)
                normalized = _normalize_history(raw, symbol)
                if interval == "1d":
                    # Daily bars are keyed by calendar date at midnight UTC.
                    normalized.index = normalized.index.normalize()
                    normalized = normalized[~normalized.index.duplicated(keep="last")]
                elif bucket_minutes:
                    normalized = resample_ohlcv(normalized, bucket_minutes)
                curr, exch = _currency_for(symbol)
                last_ts = normalized.index[-1].to_pydatetime().replace(tzinfo=timezone.utc)
                meta = ProviderMeta(
                    provider=self.name,
                    data_status="end_of_day" if interval == "1d" else "delayed",
                    fetched_at=datetime.now(timezone.utc),
                    currency=curr,
                    exchange=exch,
                    observation_end=last_ts,
                    warnings=[
                        "Yahoo Finance data is not a licensed real-time feed; daily bars are end-of-day.",
                        *(
                            ["Intraday bars are delayed, and the newest candle may still be forming."]
                            if interval != "1d"
                            else []
                        ),
                        *notes,
                    ],
                )
                return HistoryResult(frame=normalized, meta=meta)
            except ProviderError:
                raise
            except Exception as exc:  # provider/network/parser failures
                last_error = exc
                if attempt == 0:
                    time.sleep(1.2)
        message = str(last_error) if last_error else "unknown error"
        if "429" in message or "Too Many Requests" in message or "rate limit" in message.lower():
            raise ProviderError(
                "Market data provider is rate limiting requests. Cached data may still be available; retry shortly.",
                symbol=symbol,
            )
        raise ProviderError(f"Market data provider failed for {symbol}: {message[:200]}", symbol=symbol)

    def quote(self, symbol: str) -> QuoteResult:
        curr, exch = _currency_for(symbol)
        try:
            info = self._ticker(symbol).fast_info
            price = float(info.last_price)
            previous = getattr(info, "previous_close", None)
            currency = getattr(info, "currency", None) or curr
            exchange = getattr(info, "exchange", None) or exch
            if price <= 0:
                raise ValueError("non-positive price")
            meta = ProviderMeta(
                provider=self.name,
                data_status="delayed",
                fetched_at=datetime.now(timezone.utc),
                currency=currency,
                exchange=exchange,
                observation_end=datetime.now(timezone.utc),
                warnings=["Delayed provider quote. Not an exchange real-time feed."],
            )
            return QuoteResult(
                symbol=symbol,
                price=price,
                previous_close=float(previous) if previous else None,
                currency=currency,
                exchange=exchange,
                observation_time=datetime.now(timezone.utc),
                meta=meta,
            )
        except Exception as exc:
            # Fall back to the latest end-of-day close, clearly labelled.
            hist = self.history(symbol, period="1mo")
            close = float(hist.frame["adj_close"].iloc[-1])
            prev = float(hist.frame["adj_close"].iloc[-2]) if len(hist.frame) > 1 else None
            hist.meta.warnings.append(f"Quote endpoint unavailable ({str(exc)[:120]}); using last end-of-day close.")
            hist.meta.data_status = "end_of_day"
            return QuoteResult(
                symbol=symbol,
                price=close,
                previous_close=prev,
                currency=hist.meta.currency,
                exchange=hist.meta.exchange,
                observation_time=hist.meta.observation_end,
                meta=hist.meta,
            )

    def batch_history(self, symbols: list[str], period: str = "1y") -> dict[str, HistoryResult]:
        import yfinance as yf

        if not symbols:
            return {}
        try:
            raw = yf.download(
                tickers=symbols,
                period=_PERIOD.get(period, "1y"),
                interval="1d",
                auto_adjust=False,
                actions=False,
                group_by="ticker",
                threads=True,
                progress=False,
            )
        except Exception as exc:
            raise ProviderError(f"Batch market-data request failed: {str(exc)[:200]}") from exc
        out: dict[str, HistoryResult] = {}
        for symbol in symbols:
            try:
                if isinstance(raw.columns, pd.MultiIndex):
                    if symbol not in raw.columns.get_level_values(0):
                        continue
                    sub = raw[symbol].dropna(how="all")
                else:
                    sub = raw.dropna(how="all")
                frame = _normalize_history(sub, symbol)
                frame.index = frame.index.normalize()
                frame = frame[~frame.index.duplicated(keep="last")]
                curr, exch = _currency_for(symbol)
                out[symbol] = HistoryResult(
                    frame=frame,
                    meta=ProviderMeta(
                        provider=self.name,
                        data_status="end_of_day",
                        fetched_at=datetime.now(timezone.utc),
                        currency=curr,
                        exchange=exch,
                        observation_end=frame.index[-1].to_pydatetime().replace(tzinfo=timezone.utc),
                        warnings=["Batch end-of-day data from Yahoo Finance."],
                    ),
                )
            except Exception:
                continue
        return out

    def search(self, query: str, limit: int = 10) -> list[dict]:
        from .universe import UNIVERSE

        q = query.strip().upper()
        if not q:
            return []
        matches = [
            i
            for i in UNIVERSE
            if q in i["symbol"].upper() or q in i["name"].upper()
        ][:limit]
        if matches:
            return [
                {
                    "symbol": m["symbol"],
                    "name": m["name"],
                    "exchange": m["exchange"],
                    "market": m["market"],
                    "currency": m["currency"],
                    "sector": m["sector"],
                    "type": m.get("type", "equity"),
                }
                for m in matches
            ]
        try:
            import yfinance as yf

            results = yf.Search(query, max_results=limit).quotes or []
            return [
                {
                    "symbol": r.get("symbol", ""),
                    "name": r.get("shortname") or r.get("longname") or "",
                    "exchange": r.get("exchDisp", ""),
                    "market": "US" if r.get("exchange") in {"NYQ", "NMS", "NGM", "NYS", "NASDAQ"} else "OTHER",
                    "currency": "USD",
                    "sector": "",
                    "type": r.get("quoteType", "equity").lower(),
                }
                for r in results
                if r.get("symbol")
            ][:limit]
        except Exception:
            return []
