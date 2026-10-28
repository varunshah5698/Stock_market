from __future__ import annotations

import time

import numpy as np
import pandas as pd
import pytest

from app.analytics.features import FEATURE_DEFINITIONS, build_features
from app.ml.validation import (
    chronological_split,
    classification_metrics,
    interval_coverage,
    interval_from_residuals,
    regression_metrics,
)


def make_frame(n=400, seed=7):
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range("2020-01-01", periods=n)
    ret = rng.normal(0.0003, 0.012, n)
    close = 100 * np.exp(np.cumsum(ret))
    open_ = close * (1 + rng.normal(0, 0.002, n))
    high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, 0.004, n)))
    low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, 0.004, n)))
    volume = rng.integers(1_000_000, 5_000_000, n).astype(float)
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "adj_close": close, "volume": volume},
        index=pd.DatetimeIndex(dates, name="ts"),
    )


def test_target_alignment_matches_forward_return():
    frame = make_frame(200)
    X, y, dates, prices = build_features(frame, horizon=5, target="return")
    assert len(X) == len(y) == len(dates) == len(prices)
    for pos in [0, 10, len(X) - 1]:
        date = dates[pos]
        future_pos = list(frame.index).index(date) + 5
        expected = frame["adj_close"].iloc[future_pos] / frame["adj_close"].iloc[list(frame.index).index(date)] - 1
        assert y.iloc[pos] == pytest.approx(expected, rel=1e-10)
    # Direction target is exactly the sign of the forward return.
    _, y_dir, _, _ = build_features(frame, horizon=5, target="direction")
    assert set(np.unique(y_dir)) <= {0.0, 1.0}
    assert (y_dir.to_numpy() == (y.to_numpy() > 0).astype(float)).all()


def test_features_do_not_change_when_future_is_appended():
    frame = make_frame(320)
    X_early, _, dates_early, _ = build_features(frame.iloc[:260], horizon=5, target="return", require_target=False)
    X_full, _, dates_full, _ = build_features(frame, horizon=5, target="return", require_target=False)
    cutoff = dates_early[-1]
    full_row = X_full.loc[dates_full == cutoff].iloc[0]
    early_row = X_early.iloc[-1]
    np.testing.assert_allclose(early_row.to_numpy(dtype=float), full_row.to_numpy(dtype=float), rtol=0, atol=1e-12)
    assert set(X_full.columns) == set(FEATURE_DEFINITIONS)


def test_chronological_split_protects_test_and_purges():
    split = chronological_split(1000, test_fraction=0.2, validation_fraction=0.2, purge=5)
    assert split.train.max() < split.validation.min()
    assert split.validation.max() < split.test.min()
    assert split.validation.min() - split.train.max() > 5
    assert split.test.min() - split.validation.max() > 5
    assert split.test[-1] == 999
    assert len(split.test) >= 190
    with pytest.raises(ValueError):
        chronological_split(100, purge=5)


def test_regression_metrics_known_values():
    metrics = regression_metrics(np.array([1.0, 2.0, 3.0]), np.array([1.1, 1.9, 3.2]))
    assert metrics["mae"] == pytest.approx(0.1333333333)
    assert metrics["rmse"] == pytest.approx(np.sqrt(0.06 / 3))
    assert metrics["r2"] == pytest.approx(0.97)
    assert metrics["n"] == 3


def test_classification_metrics_confusion():
    y_true = [1, 1, 0, 0]
    y_pred = [1, 0, 0, 1]
    metrics = classification_metrics(y_true, y_pred, [0.9, 0.4, 0.2, 0.7])
    assert metrics["confusion_matrix"] == [[1, 1], [1, 1]]
    assert metrics["accuracy"] == 0.5
    assert metrics["balanced_accuracy"] == 0.5
    assert metrics["brier"] == pytest.approx((0.01 + 0.36 + 0.04 + 0.49) / 4)
    assert metrics["roc_auc"] == pytest.approx(0.75)


def test_interval_coverage_math():
    residuals = np.linspace(-1, 1, 101)
    interval = interval_from_residuals(residuals, level=0.8)
    assert interval["low"] == pytest.approx(np.quantile(residuals, 0.1))
    y = np.array([0.0, 1.0, 10.0])
    pred = np.zeros(3)
    coverage = interval_coverage(y, pred, interval)
    assert coverage["n"] == 3
    assert 0 <= coverage["coverage"] <= 1


def _wait(client, path, timeout=90):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = client.get(path)
        if last.status_code == 200 and last.json().get("status") in ("succeeded", "failed", "cancelled"):
            return last.json()
        time.sleep(0.2)
    raise AssertionError(f"Timed out waiting for {path}: {last.text if last else ''}")


def test_experiment_end_to_end_and_selection_uses_validation(auth_client):
    client = auth_client
    r = client.post(
        "/api/v1/ml/experiments",
        json={
            "symbol": "AAPL",
            "horizon": 5,
            "target": "return",
            "models": ["linear", "ridge", "random_forest"],
            "period": "2y",
        },
    )
    assert r.status_code == 200, r.text
    exp_id = r.json()["experiment"]["id"]
    detail = _wait(client, f"/api/v1/ml/experiments/{exp_id}")
    assert detail["status"] == "succeeded", detail
    metrics = detail["metrics"]
    assert metrics["selected"]["validation"]["n"] > 40
    assert metrics["selected"]["test"]["n"] > 40
    assert "zero_return" in metrics["baselines"]
    assert metrics["walk_forward"] is not None
    assert metrics["walk_forward"]["folds"] >= 2
    assert metrics["walk_forward"]["used_for_selection"] is False
    assert metrics["walk_forward"]["metrics"]["n"] >= 30
    assert metrics["split"]["train"]["end"] < metrics["split"]["validation"]["start"]
    assert metrics["split"]["validation"]["end"] < metrics["split"]["test"]["start"]
    # Selected model must be the best on validation, independent of test.
    viable = [m for m in metrics["models"] if m.get("error") is None]
    best_val = min(viable, key=lambda m: m["validation"]["rmse"])
    assert metrics["selected"]["key"] == best_val["key"]
    assert len(metrics["series"]["dates"]) == metrics["split"]["test"]["n"]
    assert detail["model_version"]["features"] == list(FEATURE_DEFINITIONS)
    assert detail["artifact_available"] is True

    pred = client.post("/api/v1/ml/predictions", json={"experiment_id": exp_id})
    assert pred.status_code == 200, pred.text
    body = pred.json()["prediction"]
    assert body["as_of"]
    assert body["scenario"]["last_close"] > 0
    assert body["warnings"]

    approval = client.post(f"/api/v1/ml/models/{detail['model_version']['id']}/approve")
    assert approval.status_code == 200
    data = approval.json()
    assert isinstance(data["approved"], bool)
    if not data["approved"]:
        assert data["reasons"]


def test_direction_experiment(auth_client):
    client = auth_client
    r = client.post(
        "/api/v1/ml/experiments",
        json={"symbol": "MSFT", "horizon": 3, "target": "direction", "models": ["logistic"], "period": "2y"},
    )
    assert r.status_code == 200, r.text
    detail = _wait(client, f"/api/v1/ml/experiments/{r.json()['experiment']['id']}")
    assert detail["status"] == "succeeded", detail
    metrics = detail["metrics"]["selected"]
    assert 0 <= metrics["validation"]["brier"] <= 1
    assert 0 <= metrics["test"]["brier"] <= 1
    assert metrics["test"]["confusion_matrix"]
    assert metrics["test"]["calibration"]


def test_incompatible_model_rejected(auth_client):
    r = auth_client.post(
        "/api/v1/ml/experiments",
        json={"symbol": "AAPL", "target": "direction", "models": ["linear"], "period": "2y"},
    )
    assert r.status_code == 422


def test_experiment_user_isolation(auth_client, second_client):
    r = auth_client.post(
        "/api/v1/ml/experiments",
        json={"symbol": "AAPL", "horizon": 2, "target": "return", "models": ["linear"], "period": "1y"},
    )
    exp_id = r.json()["experiment"]["id"]
    assert second_client.get(f"/api/v1/ml/experiments/{exp_id}").status_code == 404
    assert second_client.get(f"/api/v1/ml/experiments/{exp_id}/metrics").status_code == 404


def test_feature_definitions_exposed(auth_client):
    r = auth_client.get("/api/v1/ml/models")
    assert r.status_code == 200
    body = r.json()
    assert "linear" in [m["key"] for m in body["available"]]
    assert body["feature_version"]
    assert body["features"]["rsi_14"]


def test_preprocessing_is_fitted_only_on_training_rows():
    import numpy as np
    from app.ml.models import MODEL_SPECS
    from app.ml.validation import chronological_split

    frame = make_frame(420)
    X, y, _, _ = build_features(frame, horizon=5, target="return")
    split = chronological_split(len(X), test_fraction=0.2, validation_fraction=0.2, purge=5)
    X_np = X.to_numpy(dtype=float)
    pipeline = MODEL_SPECS["ridge"].builder()
    pipeline.fit(X_np[split.train], y.to_numpy()[split.train])
    scaler = pipeline.named_steps["scale"]
    assert np.allclose(scaler.mean_, X_np[split.train].mean(axis=0), atol=1e-10)
    assert len(split.test) > 0
    assert split.test.min() > split.validation.max()
