from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np
from sklearn.ensemble import (
    ExtraTreesRegressor,
    HistGradientBoostingClassifier,
    HistGradientBoostingRegressor,
    RandomForestRegressor,
)
from sklearn.linear_model import ElasticNet, Lasso, LinearRegression, LogisticRegression, Ridge
from sklearn.neighbors import KNeighborsRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVR

try:  # optional dependency, registered only when genuinely installed
    from xgboost import XGBRegressor  # type: ignore

    _HAS_XGB = True
except Exception:  # pragma: no cover - optional
    _HAS_XGB = False


@dataclass(frozen=True)
class ModelSpec:
    key: str
    name: str
    task: str
    builder: Callable[[], Pipeline]
    complexity: str = "standard"
    notes: str = ""


def _pipeline(estimator, scale: bool = True) -> Pipeline:
    steps = []
    if scale:
        steps.append(("scale", StandardScaler()))
    steps.append(("model", estimator))
    return Pipeline(steps)


def _specs() -> dict[str, ModelSpec]:
    specs = {
        "linear": ModelSpec(
            "linear", "Linear Regression", "return", lambda: _pipeline(LinearRegression()), "low",
            "Ordinary least squares; educational baseline for a linear signal.",
        ),
        "ridge": ModelSpec(
            "ridge", "Ridge Regression", "return", lambda: _pipeline(Ridge(alpha=10.0)), "low",
            "L2-regularized linear regression.",
        ),
        "lasso": ModelSpec(
            "lasso", "Lasso Regression", "return",
            lambda: _pipeline(Lasso(alpha=0.0002, max_iter=50_000, random_state=42)), "low",
            "L1-regularized regression with feature selection.",
        ),
        "elastic_net": ModelSpec(
            "elastic_net", "Elastic Net", "return",
            lambda: _pipeline(ElasticNet(alpha=0.0003, l1_ratio=0.5, max_iter=50_000, random_state=42)), "low",
            "Combined L1/L2 regularization.",
        ),
        "random_forest": ModelSpec(
            "random_forest", "Random Forest", "return",
            lambda: _pipeline(
                RandomForestRegressor(
                    n_estimators=250, max_depth=6, min_samples_leaf=20, max_features=0.5,
                    random_state=42, n_jobs=-1,
                ),
                scale=False,
            ),
            "medium", "Nonlinear tree ensemble; regularized for a small financial sample.",
        ),
        "extra_trees": ModelSpec(
            "extra_trees", "Extra Trees", "return",
            lambda: _pipeline(
                ExtraTreesRegressor(
                    n_estimators=250, max_depth=8, min_samples_leaf=15, max_features=0.5,
                    random_state=42, n_jobs=-1,
                ),
                scale=False,
            ),
            "medium", "Randomized tree ensemble.",
        ),
        "hist_gradient_boosting": ModelSpec(
            "hist_gradient_boosting", "Hist Gradient Boosting", "return",
            lambda: _pipeline(
                HistGradientBoostingRegressor(
                    max_iter=250, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=30,
                    l2_regularization=1.0, random_state=42, early_stopping=False,
                ),
                scale=False,
            ),
            "medium", "Boosted trees with histogram binning.",
        ),
        "knn": ModelSpec(
            "knn", "K-Nearest Neighbours", "return",
            lambda: _pipeline(KNeighborsRegressor(n_neighbors=25, weights="distance")), "medium",
            "Distance-based regressor; sensitive to scaling.",
        ),
        "svr": ModelSpec(
            "svr", "Support Vector Regression", "return",
            lambda: _pipeline(SVR(C=0.5, epsilon=0.005, kernel="rbf")), "high",
            "Kernel regression; slower and sensitive to hyperparameters.",
        ),
        "logistic": ModelSpec(
            "logistic", "Logistic Regression", "direction",
            lambda: _pipeline(LogisticRegression(C=0.5, max_iter=2000, class_weight="balanced", random_state=42)),
            "low", "Linear probability of a positive forward return.",
        ),
        "hist_gradient_boosting_clf": ModelSpec(
            "hist_gradient_boosting_clf", "Hist Gradient Boosting Classifier", "direction",
            lambda: _pipeline(
                HistGradientBoostingClassifier(
                    max_iter=250, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=30,
                    l2_regularization=1.0, random_state=42, early_stopping=False,
                ),
                scale=False,
            ),
            "medium", "Boosted trees for direction probability.",
        ),
    }
    from sklearn.ensemble import RandomForestClassifier

    specs["random_forest_clf"] = ModelSpec(
        "random_forest_clf", "Random Forest Classifier", "direction",
        lambda: _pipeline(
            RandomForestClassifier(
                n_estimators=250, max_depth=6, min_samples_leaf=20, max_features=0.5,
                random_state=42, n_jobs=-1, class_weight="balanced",
            ),
            scale=False,
        ),
        "medium", "Nonlinear tree ensemble for direction probability.",
    )
    if _HAS_XGB:
        specs["xgboost"] = ModelSpec(
            "xgboost", "XGBoost", "return",
            lambda: _pipeline(
                XGBRegressor(
                    n_estimators=300, max_depth=3, learning_rate=0.05, subsample=0.8,
                    colsample_bytree=0.8, reg_lambda=1.0, random_state=42, n_jobs=-1,
                ),
                scale=False,
            ),
            "medium", "Gradient-boosted trees (optional installed dependency).",
        )
    return specs


MODEL_SPECS = _specs()

DEFAULT_RETURN_MODELS = ["linear", "ridge", "lasso", "random_forest", "hist_gradient_boosting"]
DEFAULT_DIRECTION_MODELS = ["logistic", "hist_gradient_boosting_clf"]


def specs_for_task(task: str) -> list[ModelSpec]:
    return [s for s in MODEL_SPECS.values() if s.task == task]


def resolve_models(task: str, requested: list[str]) -> list[ModelSpec]:
    available = {s.key: s for s in specs_for_task(task)}
    if not requested:
        keys = DEFAULT_RETURN_MODELS if task == "return" else DEFAULT_DIRECTION_MODELS
        return [available[k] for k in keys if k in available]
    unknown = [k for k in requested if k not in MODEL_SPECS]
    wrong_task = [k for k in requested if k in MODEL_SPECS and MODEL_SPECS[k].task != task]
    if unknown:
        raise ValueError(f"Unknown model(s): {', '.join(unknown)}")
    if wrong_task:
        raise ValueError(f"Model(s) incompatible with target '{task}': {', '.join(wrong_task)}")
    return [available[k] for k in requested if k in available]


def feature_importance(pipeline: Pipeline, features: list[str], top: int = 15) -> list[dict]:
    estimator = pipeline.steps[-1][1]
    values = None
    if hasattr(estimator, "coef_"):
        values = np.abs(np.asarray(estimator.coef_).ravel())
    elif hasattr(estimator, "feature_importances_"):
        values = np.abs(np.asarray(estimator.feature_importances_).ravel())
    if values is None or len(values) != len(features):
        return []
    total = float(values.sum())
    if total <= 0:
        return []
    order = np.argsort(values)[::-1][:top]
    return [
        {"feature": features[i], "importance": float(values[i] / total), "definition": ""}
        for i in order
    ]
