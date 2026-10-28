from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session as DbSession

from ..analytics.features import FEATURE_DEFINITIONS, FEATURE_VERSION
from ..config import settings
from ..db import get_db
from ..deps import audit, current_user
from ..marketdata.base import ProviderError
from ..marketdata.service import get_provider
from ..models import Experiment, ModelVersion, Prediction, User, uid
from ..ml.models import DEFAULT_DIRECTION_MODELS, DEFAULT_RETURN_MODELS, MODEL_SPECS, resolve_models
from ..ml.runner import approve_model, launch_experiment, make_prediction
from ..ratelimit import job_limiter
from ..schemas import ExperimentIn, PredictionIn, SweepIn

router = APIRouter(prefix="/api/v1/ml", tags=["machine-learning"])


def _owned(db: DbSession, user: User, experiment_id: str) -> Experiment:
    exp = db.query(Experiment).filter(Experiment.id == experiment_id, Experiment.user_id == user.id).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return exp


def _experiment_summary(exp: Experiment) -> dict:
    metrics = exp.metrics or {}
    selected = metrics.get("selected") or {}
    return {
        "id": exp.id,
        "symbol": exp.symbol,
        "status": exp.status,
        "config": exp.config,
        "created_at": exp.created_at.isoformat(),
        "started_at": exp.started_at.isoformat() if exp.started_at else None,
        "finished_at": exp.finished_at.isoformat() if exp.finished_at else None,
        "error": exp.error or None,
        "sweep_id": exp.sweep_id,
        "selected_model": selected.get("name"),
        "validation": selected.get("validation"),
        "test": selected.get("test"),
        "data": metrics.get("data"),
        "warnings": metrics.get("warnings") or [],
    }


@router.get("/models")
def models(user: User = Depends(current_user)):
    return {
        "available": [
            {
                "key": s.key,
                "name": s.name,
                "task": s.task,
                "complexity": s.complexity,
                "notes": s.notes,
            }
            for s in MODEL_SPECS.values()
        ],
        "defaults": {"return": DEFAULT_RETURN_MODELS, "direction": DEFAULT_DIRECTION_MODELS},
        "feature_version": FEATURE_VERSION,
        "features": FEATURE_DEFINITIONS,
        "data_provider": get_provider().name,
        "notes": [
            "Models are selected on the validation window only; the test window is scored once.",
            "XGBoost appears only when the optional dependency is installed.",
            "Sequence/deep-learning models are not implemented in this build.",
        ],
    }


@router.post("/experiments")
def create_experiment(payload: ExperimentIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    job_limiter.check(f"experiment:{user.id}")
    try:
        resolve_models(payload.target, payload.models)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if payload.test_fraction + payload.validation_fraction > 0.6:
        raise HTTPException(status_code=422, detail="Validation + test fractions leave too little training data")
    exp = Experiment(
        user_id=user.id,
        symbol=payload.symbol,
        status="queued",
        config={
            "horizon": payload.horizon,
            "target": payload.target,
            "models": payload.models,
            "test_fraction": payload.test_fraction,
            "validation_fraction": payload.validation_fraction,
            "period": payload.period,
            "feature_version": FEATURE_VERSION,
            "provider": get_provider().name,
        },
    )
    db.add(exp)
    audit(db, user.id, "experiment.create", target=f"{payload.symbol}:{payload.target}:{payload.horizon}")
    db.commit()
    launch_experiment(exp.id)
    return {"experiment": _experiment_summary(exp), "message": "Experiment queued. Training runs in a background worker thread."}


@router.get("/experiments")
def list_experiments(
    symbol: str = "",
    status: str = Query("", pattern=r"^(queued|running|succeeded|failed|cancelled|)$"),
    sweep_id: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=5, le=100),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    query = db.query(Experiment).filter(Experiment.user_id == user.id)
    if symbol:
        query = query.filter(Experiment.symbol == symbol.upper())
    if status:
        query = query.filter(Experiment.status == status)
    if sweep_id:
        query = query.filter(Experiment.sweep_id == sweep_id)
    total = query.count()
    rows = query.order_by(Experiment.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "experiments": [_experiment_summary(e) for e in rows],
        "pagination": {"page": page, "page_size": page_size, "total": total, "pages": max(1, (total + page_size - 1) // page_size)},
        "note": "Ranking for research decisions uses validation metrics. Test metrics are an audit and must not drive selection.",
    }


@router.get("/experiments/{experiment_id}")
def get_experiment(experiment_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    exp = _owned(db, user, experiment_id)
    version = (
        db.query(ModelVersion)
        .filter(ModelVersion.experiment_id == exp.id)
        .order_by(ModelVersion.created_at.desc())
        .first()
    )
    return {
        **_experiment_summary(exp),
        "metrics": exp.metrics,
        "model_version": {
            "id": version.id,
            "name": version.name,
            "version": version.version,
            "features": version.features,
            "feature_version": (exp.metrics or {}).get("feature_version"),
            "approved": version.approved,
            "approved_at": version.approved_at.isoformat() if version.approved_at else None,
            "test_metrics": version.test_metrics,
            "validation_metrics": version.val_metrics,
        }
        if version
        else None,
        "artifact_available": bool(version and version.artifact_path),
        "data_window": {
            "data_start": exp.data_start.isoformat() if exp.data_start else None,
            "data_end": exp.data_end.isoformat() if exp.data_end else None,
            "test_start": exp.test_start.isoformat() if exp.test_start else None,
            "test_end": exp.test_end.isoformat() if exp.test_end else None,
        },
    }


@router.post("/experiments/{experiment_id}/cancel")
def cancel_experiment(experiment_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    exp = _owned(db, user, experiment_id)
    if exp.status == "queued":
        exp.status = "cancelled"
        exp.finished_at = datetime.now(timezone.utc)
        db.commit()
        return {"status": "cancelled"}
    if exp.status == "running":
        raise HTTPException(
            status_code=409,
            detail="A running training job cannot be safely interrupted in this build; wait for completion.",
        )
    raise HTTPException(status_code=409, detail=f"Experiment is already {exp.status}")


@router.get("/experiments/{experiment_id}/metrics")
def metrics(experiment_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    exp = _owned(db, user, experiment_id)
    if exp.status != "succeeded":
        raise HTTPException(status_code=409, detail=f"Experiment is {exp.status}; metrics are unavailable")
    return {"experiment_id": exp.id, "metrics": exp.metrics, "generated_at": exp.finished_at.isoformat() if exp.finished_at else None}


@router.post("/predictions")
def create_prediction(payload: PredictionIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    exp = _owned(db, user, payload.experiment_id)
    try:
        result = make_prediction(db, exp, payload.symbol)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ProviderError as exc:
        raise HTTPException(status_code=503, detail=exc.message)
    audit(db, user.id, "prediction.create", target=f"{exp.symbol}:{exp.id}")
    db.commit()
    return {"prediction": result}


@router.get("/predictions")
def list_predictions(
    symbol: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=5, le=100),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    query = db.query(Prediction).filter(Prediction.user_id == user.id)
    if symbol:
        query = query.filter(Prediction.symbol == symbol.upper())
    total = query.count()
    rows = query.order_by(Prediction.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "predictions": [
            {
                "id": p.id,
                "symbol": p.symbol,
                "target": p.target,
                "horizon": p.horizon,
                "point": float(p.point),
                "low": float(p.low) if p.low is not None else None,
                "high": float(p.high) if p.high is not None else None,
                "probability": float(p.probability) if p.probability is not None else None,
                "as_of": p.as_of.isoformat(),
                "experiment_id": p.experiment_id,
                "created_at": p.created_at.isoformat(),
                "warnings": p.warnings,
            }
            for p in rows
        ],
        "pagination": {"page": page, "page_size": page_size, "total": total},
    }


@router.post("/models/{version_id}/approve")
def approve(version_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    version = db.query(ModelVersion).filter(ModelVersion.id == version_id, ModelVersion.user_id == user.id).first()
    if not version:
        raise HTTPException(status_code=404, detail="Model version not found")
    exp = db.get(Experiment, version.experiment_id)
    if not exp or exp.user_id != user.id:
        raise HTTPException(status_code=404, detail="Experiment not found")
    ok, reasons = approve_model(db, version, exp)
    audit(db, user.id, "model.approve", target=version_id, approved=ok)
    db.commit()
    if not ok:
        return {"approved": False, "reasons": reasons, "message": "Model did not pass the promotion policy."}
    return {"approved": True, "reasons": [], "message": "Model approved as a research candidate. This is not a profitability guarantee."}


@router.post("/sweeps")
def create_sweep(payload: SweepIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    job_limiter.check(f"sweep:{user.id}")
    specs = [s for s in MODEL_SPECS.values() if s.task == payload.target]
    if not specs:
        raise HTTPException(status_code=422, detail="No models available for this target")
    sweep_id = uid()
    created = []
    horizons = [payload.horizon]
    if payload.budget > len(specs):
        for h in (1, 5, 20):
            if h not in horizons:
                horizons.append(h)
    for i in range(payload.budget):
        spec = specs[i % len(specs)]
        horizon = horizons[(i // len(specs)) % len(horizons)]
        exp = Experiment(
            user_id=user.id,
            symbol=payload.symbol,
            status="queued",
            sweep_id=sweep_id,
            config={
                "horizon": horizon,
                "target": payload.target,
                "models": [spec.key],
                "test_fraction": payload.test_fraction,
                "validation_fraction": 0.2,
                "period": payload.period,
                "feature_version": FEATURE_VERSION,
                "provider": get_provider().name,
                "sweep": True,
                "budget": payload.budget,
            },
        )
        db.add(exp)
        created.append((exp, spec.name, horizon))
    db.commit()
    for exp, _, _ in created:
        launch_experiment(exp.id)
    audit(db, user.id, "sweep.create", target=f"{payload.symbol}:{payload.budget}")
    db.commit()
    return {
        "sweep_id": sweep_id,
        "experiments": [
            {"id": exp.id, "model": name, "horizon": horizon, "status": exp.status}
            for exp, name, horizon in created
        ],
        "note": "Sweeps increase selection risk. Ranking must use validation metrics; test results remain an audit. This API caps a sweep at 50 configurations; larger research batches should run through the offline runner.",
    }


@router.get("/sweeps/{sweep_id}")
def sweep_detail(sweep_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    rows = (
        db.query(Experiment)
        .filter(Experiment.user_id == user.id, Experiment.sweep_id == sweep_id)
        .order_by(Experiment.created_at)
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Sweep not found")
    done = [r for r in rows if r.status == "succeeded"]

    def val_key(r: Experiment):
        m = ((r.metrics or {}).get("selected") or {}).get("validation") or {}
        if (r.config or {}).get("target") == "return":
            return m.get("rmse", float("inf"))
        return -(m.get("roc_auc") or m.get("balanced_accuracy") or 0)

    ranked = sorted(done, key=val_key)
    return {
        "sweep_id": sweep_id,
        "counts": {
            "total": len(rows),
            "succeeded": len([r for r in rows if r.status == "succeeded"]),
            "failed": len([r for r in rows if r.status == "failed"]),
            "running": len([r for r in rows if r.status in ("queued", "running")]),
        },
        "experiments": [_experiment_summary(r) for r in rows],
        "ranked_by_validation": [r.id for r in ranked],
        "warnings": [
            "Selecting the best of many configurations inflates apparent performance. Validation ranking is not a guarantee; the shared test window is contaminated for selection and reported only as an audit.",
        ],
    }
