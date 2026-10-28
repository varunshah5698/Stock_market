from __future__ import annotations

import json

import pytest

CSV = """Date,Open,High,Low,Close,Volume,Symbol
2024-01-02,100,105,99,104,1000,ABC
2024-01-03,104,106,101,102,1200,ABC
2024-01-04,102,103,100,101,900,ABC
2024-01-04,102,103,100,101,900,ABC
2024-01-05,101,102,100,,800,ABC
2024-01-08,101,90,105,101,700,ABC
2024-01-09,101,108,100,107,1500,ABC
2024-01-10,107,109,106,108,1100,ABC
2024-01-11,108,110,106,107,1300,ABC
2024-01-12,107,111,106,110,1600,ABC
2024-01-16,110,112,109,111,1400,ABC
2024-01-17,111,113,109,110,1250,ABC
2024-01-18,110,114,109,113,1800,ABC
2024-01-19,113,115,112,114,1700,ABC
2024-01-22,114,116,112,115,1500,ABC
"""

MAPPING = {
    "timestamp": "Date",
    "open": "Open",
    "high": "High",
    "low": "Low",
    "close": "Close",
    "volume": "Volume",
    "symbol": "Symbol",
}


def upload(client, name="Test dataset"):
    return client.post(
        "/api/v1/datasets",
        files={"file": ("prices.csv", CSV, "text/csv")},
        data={
            "mapping": json.dumps(MAPPING),
            "name": name,
            "date_format": "%Y-%m-%d",
            "drop_ohlc_violations": "false",
        },
    )


def test_preview_infers_columns(auth_client):
    r = auth_client.post("/api/v1/datasets/preview", files={"file": ("prices.csv", CSV, "text/csv")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["rows"] == 15
    assert body["inferred_mapping"]["timestamp"] == "Date"
    assert body["inferred_mapping"]["close"] == "Close"
    assert "Close" in body["numeric_candidates"]


def test_upload_validation_and_stats(auth_client):
    client = auth_client
    r = upload(client)
    assert r.status_code == 200, r.text
    body = r.json()
    dataset_id = body["dataset"]["id"]
    validation = body["validation"]
    assert validation["rows_in"] == 15
    assert validation["duplicate_rows"] >= 1
    assert validation["ohlc_violations"] >= 1
    assert validation["dropped"]["invalid_timestamp_or_close"] >= 1
    assert validation["rows_out"] == 13
    assert body["dataset"]["rows"] == 13
    assert body["dataset"]["version"] == 1

    stats = client.get(f"/api/v1/datasets/{dataset_id}/stats")
    assert stats.status_code == 200, stats.text
    stats_body = stats.json()
    assert "close" in stats_body["describe"]
    assert stats_body["correlation"] is not None
    assert stats_body["close_return_histogram"]["unit"] == "simple return"

    preview_check = client.get(f"/api/v1/datasets/{dataset_id}")
    assert preview_check.status_code == 200

    export = client.get(f"/api/v1/datasets/{dataset_id}/export.csv")
    assert export.status_code == 200
    assert export.text.splitlines()[0] == "timestamp,close,open,high,low,volume,symbol,adj_close"
    assert "attachment" in export.headers["content-disposition"]

    deleted = client.delete(f"/api/v1/datasets/{dataset_id}")
    assert deleted.status_code == 200
    assert client.get(f"/api/v1/datasets/{dataset_id}").status_code == 404
    assert client.get(f"/api/v1/datasets/{dataset_id}/stats").status_code == 404


def test_invalid_upload_handling(auth_client):
    bad_ext = auth_client.post("/api/v1/datasets/preview", files={"file": ("data.txt", b"hello", "text/plain")})
    assert bad_ext.status_code == 422
    no_close = auth_client.post(
        "/api/v1/datasets",
        files={"file": ("prices.csv", CSV, "text/csv")},
        data={"mapping": json.dumps({"timestamp": "Date"})},
    )
    assert no_close.status_code == 422
    unknown_col = auth_client.post(
        "/api/v1/datasets",
        files={"file": ("prices.csv", CSV, "text/csv")},
        data={"mapping": json.dumps({"timestamp": "Date", "close": "Nope"})},
    )
    assert unknown_col.status_code == 422


def test_dataset_user_isolation(auth_client, second_client):
    created = upload(auth_client)
    dataset_id = created.json()["dataset"]["id"]
    assert second_client.get(f"/api/v1/datasets/{dataset_id}").status_code == 404
    assert second_client.get(f"/api/v1/datasets/{dataset_id}/stats").status_code == 404
    assert second_client.delete(f"/api/v1/datasets/{dataset_id}").status_code == 404
    auth_client.delete(f"/api/v1/datasets/{dataset_id}")


def test_path_traversal_filename_is_sanitised(auth_client):
    r = auth_client.post(
        "/api/v1/datasets",
        files={"file": ("../../evil.csv", CSV, "text/csv")},
        data={"mapping": json.dumps(MAPPING), "name": "Safe name", "date_format": "%Y-%m-%d"},
    )
    assert r.status_code == 200
    body = r.json()["dataset"]
    assert ".." not in body["original_filename"]
    from pathlib import Path

    from app.routers.datasets import DATASET_DIR

    files = list(DATASET_DIR.glob("*.csv"))
    assert all(f.name.startswith(body["id"]) for f in files if f.name.startswith(body["id"]))
    auth_client.delete(f"/api/v1/datasets/{body['id']}")
