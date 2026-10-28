from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.marketdata.base import ProviderMeta, QuoteResult


def fake_quote(db, symbol):
    return QuoteResult(
        symbol=symbol,
        price=100.0,
        previous_close=99.0,
        currency="USD",
        exchange="TEST",
        observation_time=datetime.now(timezone.utc),
        meta=ProviderMeta(
            provider="test",
            data_status="delayed",
            fetched_at=datetime.now(timezone.utc),
            currency="USD",
            exchange="TEST",
        ),
    )


def fake_snapshots(db, symbols):
    return {
        s: {
            "symbol": s,
            "price": 110.0,
            "previous_close": 108.0,
            "change_pct": 1.85,
            "as_of": "2026-01-02",
            "currency": "USD",
            "data_status": "end_of_day",
            "provider": "test",
        }
        for s in symbols
    }


def create_account(client):
    r = client.post("/api/v1/paper-trading/accounts", json={"name": "Test paper", "starting_cash": 100_000})
    assert r.status_code == 200, r.text
    return r.json()["account"]["id"]


def order(client, account_id, **overrides):
    suffix = overrides.pop("idempotency_key", "a1")
    payload = {
        "account_id": account_id,
        "symbol": "AAPL",
        "side": "buy",
        "quantity": 10,
        "order_type": "market",
        "idempotency_key": f"test-{suffix}-{account_id[:8]}",
    }
    payload.update(overrides)
    return client.post("/api/v1/paper-trading/orders", json=payload)


def test_buy_fill_cash_and_idempotency(auth_client, monkeypatch):
    from app.paper import engine

    monkeypatch.setattr(engine, "get_quote", fake_quote)
    monkeypatch.setattr(engine, "snapshots", fake_snapshots)
    client = auth_client
    account_id = create_account(client)
    first = order(client, account_id, idempotency_key="buy-1")
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["accepted"] is True
    assert body["order"]["status"] == "FILLED"
    assert body["order"]["mode"] == "PAPER"
    assert body["order"]["avg_fill_price"] == pytest.approx(100.05)
    detail = client.get(f"/api/v1/paper-trading/accounts/{account_id}").json()
    assert detail["summary"]["cash"] == pytest.approx(98_999.2999, abs=0.0001)
    assert detail["summary"]["positions"] == 1
    assert detail["positions"][0]["quantity"] == pytest.approx(10)
    assert detail["positions"][0]["avg_cost"] == pytest.approx(100.07001)
    assert detail["summary"]["market_value"] == pytest.approx(1100.0)

    duplicate = order(client, account_id, idempotency_key="buy-1")
    assert duplicate.status_code == 200
    assert duplicate.json()["duplicate"] is True
    assert duplicate.json()["order"]["id"] == body["order"]["id"]
    detail = client.get(f"/api/v1/paper-trading/accounts/{account_id}").json()
    assert detail["summary"]["cash"] == pytest.approx(98_999.2999, abs=0.0001)
    assert len(detail["orders"]) == 1


def test_sell_updates_position_and_rejects_short(auth_client, monkeypatch):
    from app.paper import engine

    monkeypatch.setattr(engine, "get_quote", fake_quote)
    monkeypatch.setattr(engine, "snapshots", fake_snapshots)
    client = auth_client
    account_id = create_account(client)
    order(client, account_id, idempotency_key="b")
    sell = order(client, account_id, side="sell", quantity=4, idempotency_key="s")
    assert sell.status_code == 200
    assert sell.json()["order"]["status"] == "FILLED"
    assert sell.json()["order"]["avg_fill_price"] == pytest.approx(99.95)
    detail = client.get(f"/api/v1/paper-trading/accounts/{account_id}").json()
    assert detail["positions"][0]["quantity"] == pytest.approx(6)
    assert detail["summary"]["realized_pnl"] != 0
    assert detail["summary"]["realized_pnl"] < 0
    oversell = order(client, account_id, side="sell", quantity=100, idempotency_key="s2")
    assert oversell.status_code == 200
    assert oversell.json()["accepted"] is False
    assert oversell.json()["order"]["status"] == "REJECTED"
    assert "Insufficient" in oversell.json()["order"]["rejection_reason"]
    close = order(client, account_id, side="sell", quantity=6, idempotency_key="s3")
    assert close.status_code == 200
    assert close.json()["order"]["status"] == "FILLED"
    detail = client.get(f"/api/v1/paper-trading/accounts/{account_id}").json()
    assert detail["positions"] == []
    assert detail["summary"]["realized_pnl"] != 0
    assert detail["summary"]["realized_pnl"] != 0


def test_insufficient_cash_rejected(auth_client, monkeypatch):
    from app.paper import engine

    monkeypatch.setattr(engine, "get_quote", fake_quote)
    client = auth_client
    account_id = create_account(client)
    r = order(client, account_id, quantity=100_000, idempotency_key="huge")
    assert r.status_code == 200
    assert r.json()["accepted"] is False
    assert r.json()["order"]["status"] == "REJECTED"


def test_limit_order_rests_and_can_be_cancelled(auth_client, monkeypatch):
    from app.paper import engine

    monkeypatch.setattr(engine, "get_quote", fake_quote)
    client = auth_client
    account_id = create_account(client)
    limit = order(client, account_id, order_type="limit", limit_price=50, idempotency_key="lim")
    assert limit.status_code == 200
    assert limit.json()["order"]["status"] == "OPEN"
    order_id = limit.json()["order"]["id"]
    cancelled = client.post(f"/api/v1/paper-trading/accounts/{account_id}/orders/{order_id}/cancel")
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["order"]["status"] == "CANCELLED"
    again = client.post(f"/api/v1/paper-trading/accounts/{account_id}/orders/{order_id}/cancel")
    assert again.status_code == 409


def test_paper_account_isolation(auth_client, second_client, monkeypatch):
    from app.paper import engine

    monkeypatch.setattr(engine, "get_quote", fake_quote)
    account_id = create_account(auth_client)
    assert second_client.get(f"/api/v1/paper-trading/accounts/{account_id}").status_code == 404
    r = second_client.post(
        "/api/v1/paper-trading/orders",
        json={
            "account_id": account_id,
            "symbol": "AAPL",
            "side": "buy",
            "quantity": 1,
            "order_type": "market",
            "idempotency_key": "cross-account-attempt",
        },
    )
    assert r.status_code == 404
