"""Deterministic simulated provider for offline demos and tests.

This provider exists so the application can boot without network access. Every
response is labelled `simulated` in the API and in the UI. It must never be
selected silently in place of a failed real provider.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from .base import HistoryResult, MarketDataProvider, ProviderError, ProviderMeta, QuoteResult
from .universe import UNIVERSE

_PERIOD_DAYS = {"1y": 252, "2y": 504, "3y": 756, "5y": 1260, "10y": 2520, "max": 2520}


class SampleProvider(MarketDataProvider):
    name = "sample"

    def _meta(self, symbol: str) -> ProviderMeta:
        item = next((i for i in UNIVERSE if i["symbol"] == symbol), None)
        return ProviderMeta(
            provider=self.name,
            data_status="simulated",
            fetched_at=datetime.now(timezone.utc),
            currency=(item or {}).get("currency", "USD"),
            exchange=(item or {}).get("exchange", "SIM"),
            observation_end=datetime.now(timezone.utc),
            warnings=["SIMULATED DATA. Not real market data; provided for offline demos and tests only."],
        )

    def _frame(self, symbol: str, period: str) -> pd.DataFrame:
        days = _PERIOD_DAYS.get(period, 1260)
        seed = int(hashlib.sha256(symbol.encode()).hexdigest()[:8], 16)
        rng = np.random.default_rng(seed)
        dates = pd.bdate_range(end=pd.Timestamp.utcnow().normalize().tz_localize(None), periods=days)
        base = 20 + (seed % 380)
        vol = 0.012 + (seed % 17) / 1000
        drift = 0.0002 + ((seed % 11) - 5) / 100_000
        shocks = rng.normal(drift, vol, days)
        # Add a slow regime cycle so regime/robustness views have structure.
        cycle = 0.0006 * np.sin(np.linspace(0, 12 * np.pi, days) + (seed % 10))
        close = base * np.exp(np.cumsum(shocks + cycle))
        overnight = rng.normal(0, vol / 3, days)
        open_ = np.empty(days)
        open_[0] = close[0]
        open_[1:] = close[:-1] * np.exp(overnight[1:])
        spread = np.abs(rng.normal(0, vol / 2, days)) + 0.001
        high = np.maximum(open_, close) * (1 + spread)
        low = np.minimum(open_, close) * (1 - spread)
        volume = rng.integers(2_000_000, 40_000_000, days).astype(float)
        return pd.DataFrame(
            {"open": open_, "high": high, "low": low, "close": close, "adj_close": close, "volume": volume},
            index=pd.DatetimeIndex(dates, name="ts"),
        )

    def history(self, symbol: str, period: str = "5y", interval: str = "1d") -> HistoryResult:
        if interval != "1d":
            raise ProviderError("Sample provider only supports daily bars.", retryable=False, symbol=symbol)
        return HistoryResult(frame=self._frame(symbol, period), meta=self._meta(symbol))

    def quote(self, symbol: str) -> QuoteResult:
        frame = self._frame(symbol, "1mo")
        price = float(frame["close"].iloc[-1])
        prev = float(frame["close"].iloc[-2])
        meta = self._meta(symbol)
        return QuoteResult(
            symbol=symbol,
            price=price,
            previous_close=prev,
            currency=meta.currency,
            exchange=meta.exchange,
            observation_time=datetime.now(timezone.utc),
            meta=meta,
        )

    def batch_history(self, symbols: list[str], period: str = "1y") -> dict[str, HistoryResult]:
        return {s: self.history(s, period) for s in symbols}

    def search(self, query: str, limit: int = 10) -> list[dict]:
        q = query.strip().upper()
        return [
            {
                "symbol": i["symbol"],
                "name": i["name"],
                "exchange": i["exchange"],
                "market": i["market"],
                "currency": i["currency"],
                "sector": i["sector"],
                "type": i.get("type", "equity"),
            }
            for i in UNIVERSE
            if q in i["symbol"] or q in i["name"].upper()
        ][:limit]
