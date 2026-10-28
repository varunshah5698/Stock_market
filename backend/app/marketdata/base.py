from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

import pandas as pd


class ProviderError(Exception):
    """Provider failure translated into a safe, user-facing message."""

    def __init__(self, message: str, *, retryable: bool = True, symbol: str = "") -> None:
        super().__init__(message)
        self.message = message
        self.retryable = retryable
        self.symbol = symbol


@dataclass
class ProviderMeta:
    provider: str
    data_status: str  # delayed | end_of_day | simulated
    fetched_at: datetime
    currency: str = "USD"
    exchange: str = ""
    warnings: list[str] = field(default_factory=list)
    observation_end: datetime | None = None

    def as_dict(self) -> dict:
        return {
            "provider": self.provider,
            "data_status": self.data_status,
            "fetched_at": self.fetched_at.isoformat(),
            "currency": self.currency,
            "exchange": self.exchange,
            "warnings": self.warnings,
            "observation_end": self.observation_end.isoformat() if self.observation_end else None,
        }


@dataclass
class HistoryResult:
    frame: pd.DataFrame  # columns: open high low close adj_close volume; DatetimeIndex (UTC-naive dates for 1d)
    meta: ProviderMeta


@dataclass
class QuoteResult:
    symbol: str
    price: float
    previous_close: float | None
    currency: str
    exchange: str
    observation_time: datetime | None
    meta: ProviderMeta


class MarketDataProvider:
    name = "base"

    def history(self, symbol: str, period: str = "5y", interval: str = "1d") -> HistoryResult:
        raise NotImplementedError

    def quote(self, symbol: str) -> QuoteResult:
        raise NotImplementedError

    def batch_history(self, symbols: list[str], period: str = "1y") -> dict[str, HistoryResult]:
        raise NotImplementedError

    def search(self, query: str, limit: int = 10) -> list[dict]:
        raise NotImplementedError
