from __future__ import annotations

import time
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from app.backtest.engine import run_backtest
from app.marketdata.base import HistoryResult, ProviderMeta


def frame_from_prices(prices, opens=None):
    n = len(prices)
    dates = pd.bdate_range("2022-01-03", periods=n)
    opens = opens if opens is not None else prices
    return pd.DataFrame(
        {
            "open": opens,
            "high": np.maximum(opens, prices) * 1.001,
            "low": np.minimum(opens, prices) * 0.999,
            "close": prices,
            "adj_close": prices,
            "volume": 1_000_000.0,
        },
        index=pd.DatetimeIndex(dates, name="ts"),
    )


def make_bt(strategy_rules, capital=100_000, commission=2, slippage=5, benchmark=""):
    strategy = SimpleNamespace(id="s1", name="Test", version=1, rules=strategy_rules)
    bt = SimpleNamespace(
        id="b1",
        user_id="u1",
        strategy_id="s1",
        symbol="TEST",
        benchmark=benchmark,
        config={
            "period": "2y",
            "initial_capital": capital,
            "commission_bps": commission,
            "slippage_bps": slippage,
            "spread_bps": 0,
        },
    )
    return bt, strategy


def always_long_rules(stop=None):
    return {
        "entry": [{"indicator": "price", "op": ">", "value": 1, "params": {}}],
        "exit": [],
        "entry_logic": "all",
        "exit_logic": "any",
        "stop_loss_pct": stop,
        "position_size_pct": 100,
    }


def test_execution_is_next_open_and_costs_are_charged(monkeypatch):
    prices = np.full(120, 100.0)
    frame = frame_from_prices(prices)
    monkeypatch.setattr(
        "app.backtest.engine.get_history",
        lambda db, symbol, period="5y", interval="1d": HistoryResult(
            frame=frame,
            meta=ProviderMeta(provider="test", data_status="end_of_day", fetched_at=pd.Timestamp.utcnow().to_pydatetime(), currency="USD"),
        ),
    )
    bt, strategy = make_bt(always_long_rules())
    result = run_backtest(None, bt, strategy)
    assert len(result["trades"]) == 1
    trade = result["trades"][0]
    # Signal is available on the first bar's close; entry is the second bar's open.
    assert trade["entry_date"] == frame.index[1].date()
    assert trade["entry_price"] == pytest.approx(100 * 1.0005)
    assert trade["exit_reason"] == "open_at_end"
    assert result["metrics"]["open_position"] is True
    # Final equity = starting capital - entry fees - slippage on the open position.
    expected_final = 100_000 - trade["fees"] - (trade["entry_price"] - 100.0) * trade["quantity"]
    assert result["metrics"]["final_equity"] == pytest.approx(expected_final, rel=1e-8)
    assert result["metrics"]["total_fees"] > 0
    assert result["metrics"]["exposure_pct"] > 90


def test_costs_reduce_equity(monkeypatch):
    prices = np.linspace(100, 110, 140)
    frame = frame_from_prices(prices)

    def fake_history(db, symbol, period="5y", interval="1d"):
        return HistoryResult(
            frame=frame,
            meta=ProviderMeta(provider="test", data_status="end_of_day", fetched_at=pd.Timestamp.utcnow().to_pydatetime(), currency="USD"),
        )

    monkeypatch.setattr("app.backtest.engine.get_history", fake_history)
    cheap, strategy = make_bt(always_long_rules(), commission=0, slippage=0)
    costly, _ = make_bt(always_long_rules(), commission=50, slippage=50)
    cheap_result = run_backtest(None, cheap, strategy)
    costly_result = run_backtest(None, costly, strategy)
    assert cheap_result["metrics"]["final_equity"] > costly_result["metrics"]["final_equity"]
    assert costly_result["metrics"]["total_fees"] > cheap_result["metrics"]["total_fees"]


def test_stop_loss_exits_on_next_open(monkeypatch):
    prices = np.concatenate([np.linspace(100, 120, 60), np.linspace(120, 90, 20), np.full(40, 90.0)])
    frame = frame_from_prices(prices)
    monkeypatch.setattr(
        "app.backtest.engine.get_history",
        lambda db, symbol, period="5y", interval="1d": HistoryResult(
            frame=frame,
            meta=ProviderMeta(provider="test", data_status="end_of_day", fetched_at=pd.Timestamp.utcnow().to_pydatetime(), currency="USD"),
        ),
    )
    bt, strategy = make_bt(always_long_rules(stop=5))
    result = run_backtest(None, bt, strategy)
    exits = [t for t in result["trades"] if t["exit_reason"] == "stop_loss"]
    assert exits, result["trades"]
    assert result["metrics"]["max_drawdown"] < 0


def test_no_trade_when_signal_never_fires(monkeypatch):
    frame = frame_from_prices(np.linspace(100, 120, 120))
    monkeypatch.setattr(
        "app.backtest.engine.get_history",
        lambda db, symbol, period="5y", interval="1d": HistoryResult(
            frame=frame,
            meta=ProviderMeta(provider="test", data_status="end_of_day", fetched_at=pd.Timestamp.utcnow().to_pydatetime(), currency="USD"),
        ),
    )
    rules = always_long_rules()
    rules["entry"] = [{"indicator": "price", "op": ">", "value": 10_000, "params": {}}]
    bt, strategy = make_bt(rules)
    result = run_backtest(None, bt, strategy)
    assert result["trades"] == []
    assert result["metrics"]["final_equity"] == pytest.approx(100_000)


def test_backtest_api_and_export(auth_client):
    client = auth_client
    strategy_payload = {
        "name": "Always invested",
        "description": "test",
        "rules": always_long_rules(),
    }
    strategy = client.post("/api/v1/strategies", json=strategy_payload)
    assert strategy.status_code == 200, strategy.text
    sid = strategy.json()["id"]
    backtest = client.post(
        "/api/v1/backtests",
        json={
            "strategy_id": sid,
            "symbol": "AAPL",
            "benchmark": "SPY",
            "period": "2y",
            "initial_capital": 100_000,
            "commission_bps": 2,
            "slippage_bps": 5,
            "spread_bps": 1,
        },
    )
    assert backtest.status_code == 200, backtest.text
    bid = backtest.json()["backtest"]["id"]
    deadline = time.time() + 60
    detail = None
    while time.time() < deadline:
        detail = client.get(f"/api/v1/backtests/{bid}").json()
        if detail["status"] in ("succeeded", "failed"):
            break
        time.sleep(0.2)
    assert detail["status"] == "succeeded", detail
    assert detail["metrics"]["total_fees"] >= 0
    assert detail["disclaimer"]
    assert detail["equity"]["dates"]
    assert detail["strategy"]["version"] == 1

    trades = client.get(f"/api/v1/backtests/{bid}/trades")
    assert trades.status_code == 200
    export = client.get(f"/api/v1/backtests/{bid}/export.csv")
    assert export.status_code == 200
    assert export.text.startswith("date,strategy_equity")


def test_backtest_user_isolation(auth_client, second_client):
    strategy = auth_client.post(
        "/api/v1/strategies",
        json={"name": "Private", "description": "", "rules": always_long_rules()},
    ).json()
    bt = auth_client.post(
        "/api/v1/backtests",
        json={"strategy_id": strategy["id"], "symbol": "AAPL", "period": "1y"},
    ).json()["backtest"]
    assert second_client.get(f"/api/v1/backtests/{bt['id']}").status_code == 404
    assert second_client.post("/api/v1/backtests", json={"strategy_id": strategy["id"], "symbol": "AAPL"}).status_code == 404
