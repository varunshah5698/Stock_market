from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session as DbSession

from ..marketdata.service import cached_frame, get_provider, refresh_universe
from ..models import Instrument
from .indicators import atr_pct, rsi, sma


def _metrics_for(frame: pd.DataFrame) -> dict:
    close = frame["adj_close"].astype(float)
    high = frame["high"].astype(float)
    low = frame["low"].astype(float)
    volume = frame["volume"].astype(float)
    ret = close.pct_change()

    def perf(days: int) -> float | None:
        if len(close) <= days:
            return None
        return float(close.iloc[-1] / close.iloc[-1 - days] - 1)

    last = float(close.iloc[-1])
    prev = float(close.iloc[-2]) if len(close) > 1 else last
    rsi_val = rsi(close, 14)
    sma50 = sma(close, 50)
    volume_avg = volume.rolling(20, min_periods=10).mean()
    atr_series = atr_pct(high, low, close, 14)
    return {
        "price": round(last, 4),
        "change_1d_pct": round((last / prev - 1) * 100, 4) if prev else None,
        "return_1m_pct": round(perf(21) * 100, 4) if perf(21) is not None else None,
        "return_3m_pct": round(perf(63) * 100, 4) if perf(63) is not None else None,
        "return_6m_pct": round(perf(126) * 100, 4) if perf(126) is not None else None,
        "volatility_20d_pct": round(float(ret.tail(20).std(ddof=0) * np.sqrt(252) * 100), 3),
        "rsi_14": round(float(rsi_val.iloc[-1]), 2) if pd.notna(rsi_val.iloc[-1]) else None,
        "sma_50_distance_pct": round((last / float(sma50.iloc[-1]) - 1) * 100, 3) if pd.notna(sma50.iloc[-1]) else None,
        "above_sma_50": bool(pd.notna(sma50.iloc[-1]) and last > float(sma50.iloc[-1])),
        "atr_14_pct": round(float(atr_series.iloc[-1] * 100), 3) if pd.notna(atr_series.iloc[-1]) else None,
        "volume_ratio_20d": round(float(volume.iloc[-1] / volume_avg.iloc[-1]), 3) if pd.notna(volume_avg.iloc[-1]) and volume_avg.iloc[-1] else None,
        "avg_volume_20d": int(volume.tail(20).mean()) if len(volume) >= 5 else None,
        "as_of": str(frame.index[-1].date()),
        "observations": len(frame),
    }


def screener_data(db: DbSession, market: str = "US", period: str = "1y") -> dict:
    refresh = refresh_universe(db, market, period)
    instruments = (
        db.query(Instrument)
        .filter(Instrument.market == market, Instrument.in_universe.is_(True), Instrument.instrument_type == "equity")
        .order_by(Instrument.symbol)
        .all()
    )
    rows = []
    for inst in instruments:
        frame = cached_frame(db, inst.symbol, period)
        if frame is None or len(frame) < 60:
            continue
        metrics = _metrics_for(frame)
        sector = inst.sector or "Unclassified"
        returns = frame["adj_close"].pct_change().dropna()
        rows.append(
            {
                "symbol": inst.symbol,
                "name": inst.name,
                "exchange": inst.exchange,
                "market": inst.market,
                "currency": inst.currency,
                "sector": sector,
                "industry": inst.industry,
                **metrics,
                "return_5d_pct": round(float(returns.tail(5).add(1).prod() - 1) * 100, 3) if len(returns) >= 5 else None,
            }
        )
    sectors: list[dict] = []
    if rows:
        grouped: dict[str, list[dict]] = {}
        for row in rows:
            if row["return_1m_pct"] is not None:
                grouped.setdefault(row["sector"], []).append(row)
        for sector, members in grouped.items():
            sectors.append(
                {
                    "sector": sector,
                    "avg_return_1m_pct": round(float(np.mean([m["return_1m_pct"] for m in members])), 3),
                    "positive": sum(1 for m in members if (m["return_1m_pct"] or 0) > 0),
                    "count": len(members),
                }
            )
        sectors.sort(key=lambda x: x["avg_return_1m_pct"], reverse=True)
    return {
        "rows": rows,
        "sectors": sectors,
        "meta": {
            "market": market,
            "provider": get_provider().name,
            "data_status": "simulated" if get_provider().name == "sample" else "end_of_day",
            "as_of": max((r["as_of"] for r in rows), default=None),
            "universe_size": len(rows),
            "fetched_at": refresh.get("fetched_at"),
            "failed_symbols": refresh.get("failed", []),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "note": "Metrics are computed from cached daily adjusted prices. Delayed/end-of-day data.",
        },
    }
