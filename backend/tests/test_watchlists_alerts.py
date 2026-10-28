from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.marketdata.base import ProviderMeta, QuoteResult


def test_watchlist_crud_reorder_and_performance(auth_client):
    client = auth_client
    lists = client.get("/api/v1/watchlists").json()["watchlists"]
    assert lists and lists[0]["is_default"] is True
    created = client.post("/api/v1/watchlists", json={"name": "Momentum", "is_default": False})
    assert created.status_code == 200
    wid = created.json()["id"]
    for symbol in ["AAPL", "MSFT", "NVDA"]:
        r = client.post(f"/api/v1/watchlists/{wid}/items", json={"symbol": symbol, "note": "test"})
        assert r.status_code == 200, r.text
    duplicate = client.post(f"/api/v1/watchlists/{wid}/items", json={"symbol": "AAPL"})
    assert duplicate.status_code == 200
    assert duplicate.json()["duplicate"] is True
    reordered = client.put(f"/api/v1/watchlists/{wid}/reorder", json={"symbols": ["NVDA", "AAPL", "MSFT"]})
    assert reordered.status_code == 200
    assert [i["symbol"] for i in reordered.json()["items"]] == ["NVDA", "AAPL", "MSFT"]
    removed = client.delete(f"/api/v1/watchlists/{wid}/items/MSFT")
    assert removed.status_code == 200
    perf = client.get(f"/api/v1/watchlists/{wid}/performance?period=1y")
    assert perf.status_code == 200, perf.text
    assert perf.json()["observations"] > 100
    assert "not your portfolio return" in " ".join(perf.json()["warnings"])

    other = client.post("/api/v1/watchlists", json={"name": "Other", "is_default": False}).json()
    client.post(f"/api/v1/watchlists/{other['id']}/items", json={"symbol": "AAPL"})
    compare = client.get(f"/api/v1/watchlists/comparison?ids={wid},{other['id']}&period=1y")
    assert compare.status_code == 200, compare.text
    assert len(compare.json()["watchlists"]) == 2

    assert client.delete(f"/api/v1/watchlists/{wid}").status_code == 200
    assert client.get(f"/api/v1/watchlists/{wid}/performance").status_code == 404


def test_watchlist_isolation(auth_client, second_client):
    created = auth_client.post("/api/v1/watchlists", json={"name": "Private list"}).json()
    assert second_client.post(f"/api/v1/watchlists/{created['id']}/items", json={"symbol": "AAPL"}).status_code == 404
    assert second_client.delete(f"/api/v1/watchlists/{created['id']}").status_code == 404
    auth_client.delete(f"/api/v1/watchlists/{created['id']}")


def test_alert_fires_once_within_cooldown(auth_client, monkeypatch):
    from app import alerts_engine

    def fake_quote(db, symbol):
        return QuoteResult(
            symbol=symbol,
            price=200.0,
            previous_close=190.0,
            currency="USD",
            exchange="TEST",
            observation_time=datetime.now(timezone.utc),
            meta=ProviderMeta(provider="test", data_status="delayed", fetched_at=datetime.now(timezone.utc)),
        )

    monkeypatch.setattr(alerts_engine, "get_quote", fake_quote)
    client = auth_client
    created = client.post(
        "/api/v1/alerts",
        json={"symbol": "AAPL", "kind": "price_above", "threshold": 150, "cooldown_minutes": 60},
    )
    assert created.status_code == 200, created.text
    alert_id = created.json()["id"]
    first = client.post("/api/v1/alerts/check")
    assert first.status_code == 200, first.text
    assert any(a["alert_id"] == alert_id for a in first.json()["triggered"])
    second = client.post("/api/v1/alerts/check")
    assert second.status_code == 200
    assert not any(a["alert_id"] == alert_id for a in second.json()["triggered"])
    listing = client.get("/api/v1/alerts").json()
    assert any(e["alert_id"] == alert_id for e in listing["events"])
    notifications = client.get("/api/v1/notifications").json()
    assert notifications["unread"] >= 1
    assert "periodic" in listing["monitoring"]["note"]
    assert client.post("/api/v1/notifications/read-all").status_code == 200
    assert client.delete(f"/api/v1/alerts/{alert_id}").status_code == 200


def test_alert_isolation(auth_client, second_client):
    alert = auth_client.post(
        "/api/v1/alerts",
        json={"symbol": "AAPL", "kind": "price_below", "threshold": 1, "cooldown_minutes": 10},
    ).json()
    assert second_client.delete(f"/api/v1/alerts/{alert['id']}").status_code == 404
    assert second_client.patch(f"/api/v1/alerts/{alert['id']}", json={"is_active": False}).status_code == 404
    auth_client.delete(f"/api/v1/alerts/{alert['id']}")


def test_portfolio_valuation_and_scenario(auth_client):
    client = auth_client
    portfolio = client.post("/api/v1/portfolios", json={"name": "Core", "base_currency": "USD"})
    assert portfolio.status_code == 200
    pid = portfolio.json()["id"]
    for symbol, qty, cost in [("AAPL", 10, 300), ("MSFT", 5, 400)]:
        r = client.post(f"/api/v1/portfolios/{pid}/positions", json={"symbol": symbol, "quantity": qty, "avg_cost": cost})
        assert r.status_code == 200, r.text
    detail = client.get(f"/api/v1/portfolios/{pid}")
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["summary"]["positions"] == 2
    assert body["summary"]["market_value"] > 0
    assert abs(sum(p["weight_pct"] for p in body["positions"]) - 100) < 0.01
    assert "not a broker-confirmed" in body["summary"]["valuation_source"].lower()
    assert body["risk"]["available"] is True
    assert body["risk"]["risk_contribution"]

    scenario = client.post(f"/api/v1/portfolios/{pid}/scenario", json={"weights": {"AAPL": 70, "MSFT": 30}})
    assert scenario.status_code == 200, scenario.text
    assert scenario.json()["scenario_weights"]["AAPL"] == pytest.approx(0.7)
    assert "not a forecast" in scenario.json()["disclaimer"].lower()


def test_portfolio_isolation(auth_client, second_client):
    p = auth_client.post("/api/v1/portfolios", json={"name": "Private"}).json()
    assert second_client.get(f"/api/v1/portfolios/{p['id']}").status_code == 404
    assert second_client.delete(f"/api/v1/portfolios/{p['id']}").status_code == 404
    assert second_client.post(f"/api/v1/portfolios/{p['id']}/positions", json={"symbol": "AAPL", "quantity": 1, "avg_cost": 1}).status_code == 404
    auth_client.delete(f"/api/v1/portfolios/{p['id']}")


def test_empty_portfolio_has_stable_summary_shape(auth_client):
    created = auth_client.post("/api/v1/portfolios", json={"name": "Empty shape", "base_currency": "USD"})
    pid = created.json()["id"]
    detail = auth_client.get(f"/api/v1/portfolios/{pid}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["positions"] == []
    assert body["allocation"] == []
    assert body["summary"]["currencies"] == []
    assert body["summary"]["positions"] == 0
    assert body["summary"]["valuation_source"]
    assert body["risk"]["available"] is False
    auth_client.delete(f"/api/v1/portfolios/{pid}")
