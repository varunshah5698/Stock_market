"""Intraday candle correctness: aggregation, session boundaries, interval mapping.

The aggregation numbers here are small enough to check by hand. They are
synthetic fixtures, not market data.
"""

import pandas as pd
import pytest

from app.marketdata.resample import resample_ohlcv


def _frame(rows):
    """rows: (timestamp, open, high, low, close, volume)"""
    index = pd.DatetimeIndex([row[0] for row in rows], name="ts")
    return pd.DataFrame(
        {
            "open": [row[1] for row in rows],
            "high": [row[2] for row in rows],
            "low": [row[3] for row in rows],
            "close": [row[4] for row in rows],
            "adj_close": [row[4] for row in rows],
            "volume": [row[5] for row in rows],
        },
        index=index,
    )


def test_three_minute_candle_from_three_one_minute_bars():
    frame = _frame(
        [
            ("2026-10-27 13:30", 100.0, 101.0, 99.5, 100.5, 10),
            ("2026-10-27 13:31", 100.5, 102.0, 100.0, 101.5, 20),
            ("2026-10-27 13:32", 101.5, 101.8, 98.0, 99.0, 30),
        ]
    )
    out = resample_ohlcv(frame, 3)
    assert len(out) == 1
    candle = out.iloc[0]
    assert candle["open"] == 100.0  # first open
    assert candle["high"] == 102.0  # max high
    assert candle["low"] == 98.0  # min low
    assert candle["close"] == 99.0  # last close
    assert candle["volume"] == 60  # 10 + 20 + 30


def test_buckets_align_to_a_fixed_grid():
    frame = _frame(
        [
            ("2026-10-27 13:30", 1, 1, 1, 1, 1),
            ("2026-10-27 13:32", 1, 1, 1, 1, 1),
            ("2026-10-27 13:33", 2, 2, 2, 2, 2),
            ("2026-10-27 13:35", 3, 3, 3, 3, 3),
        ]
    )
    out = resample_ohlcv(frame, 3)
    # 13:30 and 13:32 share a bucket; 13:33 and 13:35 share the next one.
    assert list(out.index) == [
        pd.Timestamp("2026-10-27 13:30"),
        pd.Timestamp("2026-10-27 13:33"),
    ]
    assert out["open"].tolist() == [1, 2]
    assert out["close"].tolist() == [1, 3]


def test_candles_never_merge_across_sessions():
    # 23:59 and the next session's 00:00 are adjacent minutes but different days.
    frame = _frame(
        [
            ("2026-10-27 23:59", 10.0, 11.0, 9.0, 10.5, 5),
            ("2026-10-28 00:00", 20.0, 21.0, 19.0, 20.5, 7),
        ]
    )
    out = resample_ohlcv(frame, 3)
    assert len(out) == 2, "one candle must not span two session dates"
    assert out.iloc[0]["open"] == 10.0 and out.iloc[0]["close"] == 10.5
    assert out.iloc[1]["open"] == 20.0 and out.iloc[1]["close"] == 20.5


def test_missing_minute_reduces_constituents_without_inventing_prices():
    frame = _frame(
        [
            ("2026-10-27 13:30", 100.0, 100.0, 100.0, 100.0, 1),
            # 13:31 is missing from the feed
            ("2026-10-27 13:32", 102.0, 103.0, 101.0, 102.5, 2),
        ]
    )
    out = resample_ohlcv(frame, 3)
    candle = out.iloc[0]
    assert candle["open"] == 100.0 and candle["close"] == 102.5
    assert candle["high"] == 103.0 and candle["low"] == 100.0
    assert candle["volume"] == 3


def test_single_minute_is_returned_unchanged():
    frame = _frame([("2026-10-27 13:30", 1, 2, 0.5, 1.5, 9)])
    assert resample_ohlcv(frame, 1).equals(frame)


def test_supported_intervals_cover_the_three_requested_timeframes():
    from app.marketdata.yahoo import SUPPORTED_INTERVALS, _DERIVED_INTERVALS

    for interval in ("1m", "3m", "1d"):
        assert interval in SUPPORTED_INTERVALS
    # The provider has no native 3m interval, so it must be derived.
    assert _DERIVED_INTERVALS["3m"] == ("1m", 3)


def test_unsupported_interval_is_rejected_before_any_provider_call():
    from app.marketdata.base import ProviderError
    from app.marketdata.yahoo import YahooProvider

    with pytest.raises(ProviderError) as excinfo:
        YahooProvider().history("AAPL", period="1y", interval="7m")
    assert "not supported" in str(excinfo.value)
