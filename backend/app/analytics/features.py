"""Point-in-time feature engineering.

Every feature at row t uses observations up to and including t only. Targets
use future observations and are separated explicitly. The pipeline is versioned
so stored experiments can be traced to the exact definitions used.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .indicators import atr_pct, bollinger, ema, macd, rsi, sma

FEATURE_VERSION = "2026-10-v1"

FEATURE_DEFINITIONS: dict[str, str] = {
    "ret_1": "1-session simple return",
    "ret_5": "5-session simple return",
    "ret_10": "10-session simple return",
    "ret_21": "21-session simple return",
    "ret_lag_1": "Return lagged 1 session",
    "ret_lag_2": "Return lagged 2 sessions",
    "ret_lag_3": "Return lagged 3 sessions",
    "ret_lag_4": "Return lagged 4 sessions",
    "ret_lag_5": "Return lagged 5 sessions",
    "price_to_sma_10": "Close / 10-session SMA - 1",
    "price_to_sma_50": "Close / 50-session SMA - 1",
    "ema_12_26_spread": "EMA(12) / EMA(26) - 1",
    "rsi_14": "(RSI(14) - 50) / 50",
    "macd_hist_norm": "MACD histogram / close",
    "bb_pctb": "Position within 20-session Bollinger Bands",
    "bb_width": "Bollinger Band width / middle band",
    "atr_14_pct": "ATR(14) / close",
    "vol_20": "20-session annualized realized volatility",
    "vol_60": "60-session annualized realized volatility",
    "vol_ratio": "20-session volatility / 60-session volatility",
    "volume_ratio": "Volume / 20-session average volume - 1",
    "volume_change": "1-session percentage volume change (clipped)",
    "gap": "Open / previous close - 1",
    "hl_range": "(High - Low) / close",
    "dist_high_20": "Close / 20-session high - 1",
    "drawdown_63": "Close / 63-session high - 1",
    "downside_vol_20": "20-session annualized downside volatility",
    "momentum_63": "63-session price momentum",
}


def build_features(frame: pd.DataFrame, horizon: int = 5, target: str = "return", require_target: bool = True):
    """Return (X, y, dates, last_prices).

    y is a forward return for target="return" and a 0/1 direction for
    target="direction". Rows with incomplete features are dropped.
    """
    if frame is None or frame.empty:
        raise ValueError("No price data available")
    df = frame.copy().sort_index()
    df = df[~df.index.duplicated(keep="last")]
    close = df["adj_close"].astype(float)
    open_ = df["open"].astype(float)
    high = df["high"].astype(float)
    low = df["low"].astype(float)
    volume = df["volume"].astype(float).replace(0, np.nan)
    ret = close.pct_change()

    f = pd.DataFrame(index=df.index)
    f["ret_1"] = ret
    f["ret_5"] = close.pct_change(5)
    f["ret_10"] = close.pct_change(10)
    f["ret_21"] = close.pct_change(21)
    for lag in range(1, 6):
        f[f"ret_lag_{lag}"] = ret.shift(lag)
    f["price_to_sma_10"] = close / sma(close, 10) - 1
    f["price_to_sma_50"] = close / sma(close, 50) - 1
    f["ema_12_26_spread"] = ema(close, 12) / ema(close, 26) - 1
    f["rsi_14"] = (rsi(close, 14) - 50) / 50
    f["macd_hist_norm"] = macd(close)["hist"] / close
    bands = bollinger(close, 20, 2.0)
    f["bb_pctb"] = bands["pctb"]
    f["bb_width"] = bands["width"]
    f["atr_14_pct"] = atr_pct(high, low, close, 14)
    f["vol_20"] = ret.rolling(20, min_periods=20).std(ddof=0) * np.sqrt(252)
    f["vol_60"] = ret.rolling(60, min_periods=60).std(ddof=0) * np.sqrt(252)
    f["vol_ratio"] = f["vol_20"] / f["vol_60"].replace(0, np.nan)
    vol_avg = volume.rolling(20, min_periods=10).mean()
    f["volume_ratio"] = volume / vol_avg - 1
    f["volume_change"] = volume.pct_change().clip(-1, 3)
    f["gap"] = open_ / close.shift(1) - 1
    f["hl_range"] = (high - low) / close
    f["dist_high_20"] = close / close.rolling(20, min_periods=20).max() - 1
    f["drawdown_63"] = close / close.rolling(63, min_periods=63).max() - 1
    f["downside_vol_20"] = (
        ret.where(ret < 0, 0).rolling(20, min_periods=20).std(ddof=0) * np.sqrt(252)
    )
    f["momentum_63"] = close.pct_change(63)
    f = f.replace([np.inf, -np.inf], np.nan)

    forward_return = close.shift(-horizon) / close - 1
    if target == "direction":
        y = pd.Series(np.where(forward_return > 0, 1.0, 0.0), index=df.index)
        y[forward_return.isna()] = np.nan
    elif target == "return":
        y = forward_return
    else:
        raise ValueError(f"Unsupported target: {target}")

    combined = f.copy()
    combined["__target__"] = y
    combined["__close__"] = close
    if require_target:
        combined = combined.dropna(subset=list(FEATURE_DEFINITIONS.keys()) + ["__target__"])
    else:
        combined = combined.dropna(subset=list(FEATURE_DEFINITIONS.keys()))
    if combined.empty:
        raise ValueError("Not enough complete observations to build the feature set")
    X = combined[list(FEATURE_DEFINITIONS.keys())]
    y_out = combined["__target__"] if require_target else None
    dates = pd.DatetimeIndex(combined.index)
    prices = combined["__close__"]
    return X, y_out, dates, prices
