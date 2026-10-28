from __future__ import annotations

import io
import logging
import threading
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sqlalchemy.orm import Session as DbSession

from ..analytics.features import FEATURE_DEFINITIONS, FEATURE_VERSION, build_features
from ..config import settings, storage_root
from ..db import SessionLocal
from ..marketdata.base import ProviderError
from ..marketdata.service import get_history
from ..models import Experiment, ModelVersion, Prediction, uid
from .models import MODEL_SPECS, feature_importance, resolve_models
from .validation import (
    chronological_split,
    classification_metrics,
    interval_coverage,
    interval_from_residuals,
    regression_metrics,
    to_builtin,
)

logger = logging.getLogger("stockpulse.ml")
STORAGE_ROOT = storage_root()
ARTIFACT_DIR = STORAGE_ROOT / "storage" / "models"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
_semaphore = threading.Semaphore(2)

BASELINE_LABELS = {"return": ["zero_return", "historical_mean"], "direction": ["momentum_sign", "majority_class"]}


def _fit(spec, X_train, y_train):
    pipeline = spec.builder()
    pipeline.fit(X_train, y_train)
    return pipeline


def _predict(pipeline, X, task: str) -> tuple[np.ndarray, np.ndarray | None]:
    pred = pipeline.predict(X)
    if task == "direction":
        if hasattr(pipeline, "predict_proba"):
            prob = pipeline.predict_proba(X)[:, 1]
        else:
            prob = pred.astype(float)
        return np.asarray(pred, dtype=float), np.asarray(prob, dtype=float)
    return np.asarray(pred, dtype=float), None



def _walk_forward_stability(spec, X, y, validation_idx, horizon: int, target: str, metric_fn, step: int | None = None) -> dict | None:
    """Expanding-window stability check over the validation block only.

    This is a post-selection diagnostic, not part of model selection and never
    touches the final test block. One prediction is produced per validation row
    by a model trained only on observations available before that row, with a
    purge of overlapping labels.
    """
    if len(validation_idx) < 60:
        return None
    step = step or max(21, len(validation_idx) // 5)
    min_train = 200
    predictions: list[float] = []
    probabilities: list[float] = []
    actual: list[float] = []
    prediction_dates: list[int] = []
    folds = 0
    for origin in range(int(validation_idx[0]), int(validation_idx[-1]) + 1, step):
        fit_end = origin - horizon
        if fit_end < min_train:
            continue
        chunk = np.arange(origin, min(origin + step, int(validation_idx[-1]) + 1))
        if len(chunk) == 0:
            continue
        try:
            pipeline = _fit(spec, X[:fit_end], y[:fit_end])
            pred, prob = _predict(pipeline, X[chunk], target)
        except Exception:
            continue
        folds += 1
        predictions.extend(float(v) for v in pred)
        actual.extend(float(v) for v in y[chunk])
        prediction_dates.extend(int(v) for v in chunk)
        if prob is not None:
            probabilities.extend(float(v) for v in prob)
    if folds < 2 or len(predictions) < 30:
        return None
    metrics = metric_fn(np.asarray(actual), np.asarray(predictions), np.asarray(probabilities) if probabilities else None) if target == "direction" else metric_fn(np.asarray(actual), np.asarray(predictions))
    return {
        "folds": folds,
        "step_sessions": step,
        "purge_sessions": horizon,
        "predictions": len(predictions),
        "metrics": metrics,
        "scope": "validation block only; expanding refits",
        "used_for_selection": False,
        "warning": "Post-selection stability diagnostic. Overlapping h-session labels mean observations are not independent.",
    }


def _series(dates: pd.DatetimeIndex) -> list[str]:
    return [str(d.date()) for d in dates]


def execute_experiment(db: DbSession, exp: Experiment) -> None:
    cfg = exp.config or {}
    symbol = exp.symbol
    horizon = int(cfg.get("horizon", 5))
    target = cfg.get("target", "return")
    period = cfg.get("period", "5y")
    models_requested = cfg.get("models") or []

    history = get_history(db, symbol, period=period, interval="1d")
    X, y, dates, prices = build_features(history.frame, horizon=horizon, target=target, require_target=True)
    y_arr = np.asarray(y, dtype=float)
    split = chronological_split(
        len(X),
        test_fraction=float(cfg.get("test_fraction", 0.2)),
        validation_fraction=float(cfg.get("validation_fraction", 0.2)),
        purge=horizon,
    )
    if len(split.test) < 20:
        raise RuntimeError("Test window too small for a meaningful evaluation")

    X_np = X.to_numpy(dtype=float)
    train_idx, val_idx, test_idx = split.train, split.validation, split.test
    X_train, y_train = X_np[train_idx], y_arr[train_idx]
    X_val, y_val = X_np[val_idx], y_arr[val_idx]
    X_test, y_test = X_np[test_idx], y_arr[test_idx]
    specs = resolve_models(target, list(models_requested))

    metric_fn = regression_metrics if target == "return" else classification_metrics

    def score(y_true, pred, prob=None):
        return metric_fn(y_true, pred, prob) if target == "direction" else metric_fn(y_true, pred)

    # Baselines are computed only from training-period information.
    baselines: dict[str, dict] = {}
    if target == "return":
        mean_return = float(np.mean(y_train))
        zero_val = np.zeros(len(val_idx))
        mean_val = np.full(len(val_idx), mean_return)
        baselines["zero_return"] = {
            "validation": score(y_val, zero_val),
            "test": score(y_test, np.zeros(len(test_idx))),
            "description": "Predicts a zero forward return (random-walk in returns).",
        }
        baselines["historical_mean"] = {
            "validation": score(y_val, mean_val),
            "test": score(y_test, np.full(len(test_idx), mean_return)),
            "description": f"Predicts the training-period mean forward return ({mean_return:.6f}).",
        }
    else:
        momentum_val = (X_val[:, 0] > 0).astype(int)  # ret_1 is the first feature
        momentum_test = (X_test[:, 0] > 0).astype(int)
        majority = int(round(float(np.mean(y_train))))
        baselines["momentum_sign"] = {
            "validation": score(y_val, momentum_val, momentum_val.astype(float)),
            "test": score(y_test, momentum_test, momentum_test.astype(float)),
            "description": "Predicts that the next horizon follows the sign of the last 1-session return.",
        }
        baselines["majority_class"] = {
            "validation": score(y_val, np.full(len(val_idx), majority), np.full(len(val_idx), float(majority))),
            "test": score(y_test, np.full(len(test_idx), majority), np.full(len(test_idx), float(majority))),
            "description": f"Predicts the training-period majority class (class {majority}).",
        }

    model_results: list[dict] = []
    fitted: dict[str, object] = {}
    for spec in specs:
        started = time.perf_counter()
        try:
            pipeline = _fit(spec, X_train, y_train)
            val_pred, val_prob = _predict(pipeline, X_val, target)
            metrics = score(y_val, val_pred, val_prob)
            elapsed = time.perf_counter() - started
            model_results.append(
                {
                    "key": spec.key,
                    "name": spec.name,
                    "complexity": spec.complexity,
                    "notes": spec.notes,
                    "validation": metrics,
                    "seconds": round(elapsed, 3),
                    "error": None,
                }
            )
            fitted[spec.key] = (pipeline, val_pred, val_prob)
        except Exception as exc:  # isolate model failures
            logger.warning("Model %s failed for %s: %s", spec.key, symbol, exc)
            model_results.append(
                {
                    "key": spec.key,
                    "name": spec.name,
                    "validation": None,
                    "error": f"{type(exc).__name__}: {str(exc)[:300]}",
                    "seconds": None,
                }
            )
    if not fitted:
        raise RuntimeError("Every candidate model failed to train. See per-model errors.")

    def selection_score(result: dict) -> float:
        m = result["validation"] or {}
        if target == "return":
            return float(m.get("rmse", np.inf))
        return -float(m.get("roc_auc") if m.get("roc_auc") is not None else m.get("balanced_accuracy", -np.inf))

    viable = [r for r in model_results if r["key"] in fitted]
    selected = min(viable, key=selection_score)
    selected_spec = MODEL_SPECS[selected["key"]]
    selected_pipeline, val_pred, val_prob = fitted[selected["key"]]

    # Final fit: training + validation only. The test block remains untouched
    # for model selection and is scored exactly once here.
    trainval_idx = np.concatenate([train_idx, val_idx])
    final_pipeline = _fit(selected_spec, X_np[trainval_idx], y_arr[trainval_idx])
    test_pred, test_prob = _predict(final_pipeline, X_test, target)
    test_metrics = score(y_test, test_pred, test_prob)
    val_metrics = selected["validation"]

    interval = None
    coverage = None
    if target == "return":
        validation_residuals = y_val - val_pred
        interval = interval_from_residuals(validation_residuals, level=0.9)
        coverage = interval_coverage(y_test, test_pred, interval)

    walk_forward = _walk_forward_stability(
        selected_spec,
        X_np,
        y_arr,
        split.validation,
        horizon,
        target,
        metric_fn,
    )

    importance = feature_importance(final_pipeline, list(FEATURE_DEFINITIONS.keys()))
    for item in importance:
        item["definition"] = FEATURE_DEFINITIONS.get(item["feature"], "")

    baseline_val = baselines["zero_return"]["validation"] if target == "return" else baselines["momentum_sign"]["validation"]
    baseline_test = baselines["zero_return"]["test"] if target == "return" else baselines["momentum_sign"]["test"]
    warnings: list[str] = []
    if target == "return":
        if val_metrics.get("rmse") is not None and baseline_val.get("rmse") is not None and val_metrics["rmse"] >= baseline_val["rmse"]:
            warnings.append("The selected model did not beat the zero-return baseline on validation RMSE.")
        if test_metrics.get("rmse") is not None and baseline_test.get("rmse") is not None and test_metrics["rmse"] >= baseline_test["rmse"]:
            warnings.append("On the untouched test window, the model did not beat the zero-return baseline.")
    else:
        if (val_metrics.get("balanced_accuracy") or 0) <= 0.52:
            warnings.append("Validation balanced accuracy is close to chance (<= 0.52).")
        if (test_metrics.get("roc_auc") is not None and test_metrics["roc_auc"] < 0.5):
            warnings.append("Test ROC-AUC is below 0.5, indicating no directional edge in this window.")
    if history.meta.data_status == "simulated":
        warnings.append("SIMULATED data provider is active; these results are not evidence about real markets.")
    else:
        warnings.append("Yahoo Finance data is delayed/end-of-day and not a licensed point-in-time research feed.")
    warnings.append("A single chronological test window is weak evidence; treat this as a research candidate, not a validated edge.")
    warnings.append("Low price-prediction error does not imply profitable trading after costs.")

    report = {
        "symbol": symbol,
        "target": target,
        "horizon": horizon,
        "feature_version": FEATURE_VERSION,
        "feature_count": len(FEATURE_DEFINITIONS),
        "models": model_results,
        "baselines": baselines,
        "selected": {
            "key": selected["key"],
            "name": selected["name"],
            "validation": val_metrics,
            "test": test_metrics,
            "selection_metric": "validation RMSE" if target == "return" else "validation ROC-AUC / balanced accuracy",
        },
        "interval": interval,
        "interval_coverage": coverage,
        "walk_forward": walk_forward,
        "series": {
            "dates": _series(dates[test_idx]),
            "actual": [float(v) for v in y_test],
            "predicted": [float(v) for v in test_pred],
            "probability": [float(v) for v in test_prob] if test_prob is not None else None,
            "residual": [float(a - p) for a, p in zip(y_test, test_pred)] if target == "return" else None,
        },
        "feature_importance": importance,
        "warnings": warnings,
        "data": {
            "provider": history.meta.provider,
            "data_status": history.meta.data_status,
            "fetched_at": history.meta.fetched_at.isoformat(),
            "currency": history.meta.currency,
            "observations": int(len(X)),
            "data_start": str(dates[0].date()),
            "data_end": str(dates[-1].date()),
            "price_last": float(prices.iloc[-1]),
        },
        "split": split.as_dict(dates),
        "sklearn_version": sklearn.__version__,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    version = ModelVersion(
        experiment_id=exp.id,
        user_id=exp.user_id,
        name=selected_spec.name,
        version=1,
        target=target,
        horizon=horizon,
        features=list(FEATURE_DEFINITIONS.keys()),
        val_metrics=to_builtin(val_metrics),
        test_metrics=to_builtin(test_metrics),
        artifact_path="",
        approved=False,
    )
    db.add(version)
    db.flush()

    artifact_path = ARTIFACT_DIR / f"{exp.id}.joblib"
    buffer = io.BytesIO()
    joblib.dump(
        {
            "pipeline": final_pipeline,
            "features": list(FEATURE_DEFINITIONS.keys()),
            "feature_version": FEATURE_VERSION,
            "symbol": symbol,
            "target": target,
            "horizon": horizon,
            "interval": interval,
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "data_end": str(dates[-1].date()),
            "sklearn_version": sklearn.__version__,
            "model_key": selected_spec.key,
            "model_version_id": version.id,
        },
        buffer,
    )
    version.artifact = buffer.getvalue()
    try:
        artifact_path.write_bytes(version.artifact)
        version.artifact_path = str(artifact_path.relative_to(STORAGE_ROOT))
    except OSError:
        # Serverless: no writable disk. The stored bytes above are authoritative.
        version.artifact_path = ""
    exp.artifact_path = version.artifact_path
    exp.status = "succeeded"
    exp.finished_at = datetime.now(timezone.utc)
    exp.data_start = dates[0].date()
    exp.data_end = dates[-1].date()
    exp.test_start = dates[test_idx[0]].date()
    exp.test_end = dates[test_idx[-1]].date()
    exp.metrics = to_builtin(report)
    db.commit()


def run_experiment_job(experiment_id: str) -> None:
    with _semaphore:
        db = SessionLocal()
        try:
            exp = db.get(Experiment, experiment_id)
            if not exp or exp.status == "cancelled":
                return
            exp.status = "running"
            exp.started_at = datetime.now(timezone.utc)
            db.commit()
            execute_experiment(db, exp)
        except ProviderError as exc:
            db.rollback()
            exp = db.get(Experiment, experiment_id)
            if exp:
                exp.status = "failed"
                exp.error = exc.message[:1000]
                exp.finished_at = datetime.now(timezone.utc)
                db.commit()
        except Exception as exc:
            db.rollback()
            logger.error("Experiment %s failed: %s\n%s", experiment_id, exc, traceback.format_exc())
            exp = db.get(Experiment, experiment_id)
            if exp:
                exp.status = "failed"
                exp.error = f"{type(exc).__name__}: {str(exc)[:800]}"
                exp.finished_at = datetime.now(timezone.utc)
                db.commit()
        finally:
            db.close()


def launch_experiment(experiment_id: str) -> None:
    if settings.inline_jobs:
        # Serverless: run in-request, because a daemon thread dies with the
        # instance. Measured ~3s for two models over five years of daily bars.
        run_experiment_job(experiment_id)
        return
    thread = threading.Thread(target=run_experiment_job, args=(experiment_id,), daemon=True, name=f"exp-{experiment_id[:8]}")
    thread.start()


def _news_context(symbol: str) -> dict | None:
    """Live news snapshot stored with a prediction.

    Best-effort by design: a news outage must never fail a forecast, and the
    payload states explicitly that the headlines did not feed the model.
    """
    try:
        from ..news import prediction_context

        return prediction_context(symbol, limit=5)
    except Exception as exc:  # pragma: no cover - defensive
        return {"available": False, "error": f"{type(exc).__name__}: {str(exc)[:120]}"}


def make_prediction(db: DbSession, exp: Experiment, symbol: str | None = None) -> dict:
    if exp.status != "succeeded":
        raise ValueError("Experiment has not completed successfully")
    version = (
        db.query(ModelVersion)
        .filter(ModelVersion.experiment_id == exp.id)
        .order_by(ModelVersion.created_at.desc())
        .first()
    )
    if not version:
        raise ValueError("No model version stored for this experiment")
    if version.artifact:
        artifact = joblib.load(io.BytesIO(version.artifact))
    else:
        path = STORAGE_ROOT / version.artifact_path
        if not path.exists():
            raise ValueError("Model artifact is missing; rerun the experiment")
        artifact = joblib.load(path)
    if artifact.get("feature_version") != FEATURE_VERSION or artifact.get("features") != version.features:
        raise ValueError("Model artifact is incompatible with the current feature version; retrain the experiment")
    config = exp.config or {}
    history = get_history(db, artifact["symbol"], period=config.get("period", "5y"), interval="1d")
    X, _, dates, prices = build_features(
        history.frame, horizon=artifact["horizon"], target=artifact["target"], require_target=False
    )
    last_row = X.iloc[[-1]].to_numpy(dtype=float)
    pipeline = artifact["pipeline"]
    task = artifact["target"]
    point_pred, prob = _predict(pipeline, last_row, task)
    point = float(point_pred[0])
    as_of = dates[-1].date()
    last_close = float(prices.iloc[-1])
    age_days = (datetime.now(timezone.utc).date() - as_of).days
    interval = artifact.get("interval") or {}
    test_rmse = version.test_metrics.get("rmse")
    warnings = [
        "Model estimate, not a guaranteed future price.",
        (
            f"Out-of-sample test RMSE: {float(test_rmse) * 100:.3f}% in return units."
            if isinstance(test_rmse, (int, float))
            else "Test metrics are available in the experiment report."
        ),
    ]
    if not version.approved:
        warnings.append("This model has not passed the promotion policy; it is a research candidate.")
    if age_days > 7:
        warnings.append(f"Latest market observation is {age_days} days old.")
    if history.meta.data_status == "simulated":
        warnings.append("SIMULATED data provider active; this forecast is not about real markets.")

    low = high = None
    scenario = None
    if task == "return":
        low_q, high_q = interval.get("low"), interval.get("high")
        if low_q is not None and high_q is not None:
            low = point + float(low_q)
            high = point + float(high_q)
        scenario = {
            "last_close": round(last_close, 4),
            "expected_price": round(last_close * (1 + point), 4),
            "low_price": round(last_close * (1 + low), 4) if low is not None else None,
            "high_price": round(last_close * (1 + high), 4) if high is not None else None,
            "assumption": "Price scenario applies the predicted return to the last close; it ignores dividends, gaps and costs.",
        }
    prediction = Prediction(
        user_id=exp.user_id,
        experiment_id=exp.id,
        model_version_id=version.id,
        symbol=artifact["symbol"],
        horizon=artifact["horizon"],
        target=task,
        point=point,
        low=low,
        high=high,
        probability=float(prob[0]) if prob is not None else None,
        baseline=0.0 if task == "return" else None,
        as_of=as_of,
        data_timestamp=history.meta.observation_end,
        warnings=warnings,
    )
    db.add(prediction)
    db.commit()
    return {
        "id": prediction.id,
        "symbol": artifact["symbol"],
        "horizon": artifact["horizon"],
        "target": task,
        "point": point,
        "low": low,
        "high": high,
        "probability": prediction.probability,
        "as_of": str(as_of),
        "data_timestamp": history.meta.observation_end.isoformat() if history.meta.observation_end else None,
        "model_version_id": version.id,
        "model_name": version.name,
        "approved": version.approved,
        "interval": interval,
        "scenario": scenario,
        "test_metrics": version.test_metrics,
        "val_metrics": version.val_metrics,
        "warnings": warnings,
        "news_context": _news_context(symbol),
        "data": {
            "provider": history.meta.provider,
            "data_status": history.meta.data_status,
            "currency": history.meta.currency,
            "last_close": last_close,
        },
    }


def approve_model(db: DbSession, version: ModelVersion, exp: Experiment) -> tuple[bool, list[str]]:
    """Configurable promotion policy evaluated on validation evidence only."""
    reasons: list[str] = []
    metrics = exp.metrics or {}
    task = version.target
    if task == "return":
        val = version.val_metrics or {}
        baseline = ((metrics.get("baselines") or {}).get("zero_return") or {}).get("validation") or {}
        if (val.get("n") or 0) < 100:
            reasons.append("Validation sample is smaller than 100 observations.")
        if not val.get("rmse") or not baseline.get("rmse"):
            reasons.append("Validation RMSE or baseline RMSE is unavailable.")
        elif val["rmse"] >= baseline["rmse"] * 0.95:
            reasons.append("Validation RMSE is not at least 5% better than the zero-return baseline.")
        if (val.get("directional_accuracy") or 0) < 0.5:
            reasons.append("Validation directional accuracy is below 50%.")
    else:
        val = version.val_metrics or {}
        if (val.get("n") or 0) < 100:
            reasons.append("Validation sample is smaller than 100 observations.")
        if (val.get("balanced_accuracy") or 0) <= 0.52:
            reasons.append("Validation balanced accuracy does not exceed 0.52.")
        if val.get("roc_auc") is not None and val["roc_auc"] <= 0.52:
            reasons.append("Validation ROC-AUC does not exceed 0.52.")
        if val.get("brier") is None:
            reasons.append("Brier score is unavailable; probability calibration cannot be assessed.")
    if reasons:
        return False, reasons
    previous = (
        db.query(ModelVersion)
        .filter(ModelVersion.user_id == version.user_id, ModelVersion.approved.is_(True))
        .all()
    )
    for prev in previous:
        prev.approved = False
    version.approved = True
    version.approved_at = datetime.now(timezone.utc)
    db.commit()
    return True, []
