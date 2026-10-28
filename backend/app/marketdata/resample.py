"""Session-aware OHLCV resampling.

Yahoo serves one-minute bars but has no native three-minute interval, so longer
intraday candles are aggregated here rather than passed through to the provider.

Buckets never span two sessions: the session date is part of the grouping key,
so a candle cannot merge one session's close into the next session's open, and
exchange breaks (for example the US lunch hour, or an NSE/BSE session split) do
not blend into a single bucket. Missing one-minute observations simply reduce
the number of constituents in that bucket instead of fabricating prices.
"""

from __future__ import annotations

import pandas as pd

_COLUMNS = ("open", "high", "low", "close", "adj_close", "volume")


def resample_ohlcv(frame: pd.DataFrame, minutes: int) -> pd.DataFrame:
    """Aggregate intraday OHLCV bars into ``minutes``-minute candles.

    open   = first constituent open
    high   = max constituent high
    low    = min constituent low
    close  = last constituent close
    volume = sum of constituent volume
    """
    if frame is None or frame.empty or minutes <= 1:
        return frame

    working = frame.copy()
    if "adj_close" not in working.columns:
        working["adj_close"] = working["close"]
    if "volume" not in working.columns:
        working["volume"] = 0.0

    # DatetimeIndex.normalize() gives the session date; floor() gives the bucket
    # start anchored on a fixed grid, so 09:30 stays 09:30 for a 3-minute bar.
    working["_session"] = working.index.normalize()
    working["_bucket"] = working.index.floor(f"{int(minutes)}min")

    grouped = working.groupby(["_session", "_bucket"], sort=True)
    out = grouped.agg(
        open=("open", "first"),
        high=("high", "max"),
        low=("low", "min"),
        close=("close", "last"),
        adj_close=("adj_close", "last"),
        volume=("volume", "sum"),
    )
    out.index = pd.DatetimeIndex(out.index.get_level_values("_bucket"), name=frame.index.name or "ts")
    out = out.sort_index()
    out = out[~out.index.duplicated(keep="last")]
    out["volume"] = out["volume"].fillna(0.0)
    return out[list(_COLUMNS)] if set(_COLUMNS) <= set(out.columns) else out
