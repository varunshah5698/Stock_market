from __future__ import annotations

from dataclasses import dataclass

import numpy as np


def _finite(a) -> np.ndarray:
    return np.asarray(a, dtype=float)


@dataclass
class Split:
    train: np.ndarray
    validation: np.ndarray
    test: np.ndarray
    purge: int

    def as_dict(self, dates) -> dict:
        def span(idx: np.ndarray) -> dict:
            if len(idx) == 0:
                return {"start": None, "end": None, "n": 0}
            return {"start": str(dates[idx[0]].date()), "end": str(dates[idx[-1]].date()), "n": int(len(idx))}

        return {
            "train": span(self.train),
            "validation": span(self.validation),
            "test": span(self.test),
            "purge_sessions": self.purge,
        }


def chronological_split(
    n: int,
    test_fraction: float = 0.2,
    validation_fraction: float = 0.2,
    purge: int = 5,
    min_train: int = 120,
    min_val: int = 40,
    min_test: int = 40,
) -> Split:
    """Chronological split with an embargo between segments for overlapping labels.

    The final test block is never used for model or hyperparameter selection.
    """
    if n < min_train + min_val + min_test + 2 * purge:
        raise ValueError(
            f"Insufficient observations ({n}). Need at least {min_train + min_val + min_test + 2 * purge} after feature construction."
        )
    test_start = int(round(n * (1 - test_fraction)))
    val_start = int(round(n * (1 - test_fraction - validation_fraction)))
    test_start = max(test_start, val_start + min_test)
    train_end = max(0, val_start - purge)
    val_end = max(val_start, test_start - purge)
    train = np.arange(0, train_end)
    validation = np.arange(val_start, val_end)
    test = np.arange(test_start, n)
    if len(train) < min_train or len(validation) < min_val or len(test) < min_test:
        raise ValueError("Chronological split produced a segment that is too small")
    return Split(train=train, validation=validation, test=test, purge=purge)


def regression_metrics(y_true, y_pred) -> dict:
    yt, yp = _finite(y_true), _finite(y_pred)
    mask = np.isfinite(yt) & np.isfinite(yp)
    yt, yp = yt[mask], yp[mask]
    if len(yt) == 0:
        return {"n": 0}
    err = yp - yt
    ss_res = float(np.sum(err**2))
    ss_tot = float(np.sum((yt - yt.mean()) ** 2))
    directional = np.sign(yt) == np.sign(yp)
    nonzero = (yt != 0) & (yp != 0)
    return {
        "n": int(len(yt)),
        "mae": float(np.mean(np.abs(err))),
        "medae": float(np.median(np.abs(err))),
        "rmse": float(np.sqrt(np.mean(err**2))),
        "r2": float(1 - ss_res / ss_tot) if ss_tot > 0 else None,
        "directional_accuracy": float(np.mean(directional)) if len(directional) else None,
        "directional_accuracy_nonzero": float(np.mean(directional[nonzero])) if nonzero.any() else None,
        "mean_error": float(np.mean(err)),
        "target_std": float(np.std(yt, ddof=0)),
        "prediction_std": float(np.std(yp, ddof=0)),
    }


def classification_metrics(y_true, y_pred, y_prob=None) -> dict:
    yt = _finite(y_true).astype(int)
    yp = _finite(y_pred).astype(int)
    if len(yt) == 0:
        return {"n": 0}
    tp = int(np.sum((yp == 1) & (yt == 1)))
    tn = int(np.sum((yp == 0) & (yt == 0)))
    fp = int(np.sum((yp == 1) & (yt == 0)))
    fn = int(np.sum((yp == 0) & (yt == 1)))
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    specificity = tn / (tn + fp) if tn + fp else 0.0
    out = {
        "n": int(len(yt)),
        "accuracy": float(np.mean(yt == yp)),
        "balanced_accuracy": float((recall + specificity) / 2),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "confusion_matrix": [[int(tn), int(fp)], [int(fn), int(tp)]],
        "positive_rate": float(np.mean(yt)),
    }
    if y_prob is not None:
        prob = _finite(y_prob)
        mask = np.isfinite(prob)
        if mask.any():
            prob = prob[mask]
            target = yt[mask]
            out["brier"] = float(np.mean((prob - target) ** 2))
            try:
                from sklearn.metrics import roc_auc_score

                out["roc_auc"] = float(roc_auc_score(target, prob)) if len(np.unique(target)) > 1 else None
            except Exception:
                out["roc_auc"] = None
            bins = []
            for lo in (0.0, 0.2, 0.4, 0.6, 0.8):
                hi = lo + 0.2
                sel = (prob >= lo) & (prob < hi if hi < 1 else prob <= hi)
                if sel.any():
                    bins.append(
                        {
                            "bucket": f"{lo:.1f}-{hi:.1f}",
                            "n": int(sel.sum()),
                            "mean_probability": float(prob[sel].mean()),
                            "observed_rate": float(target[sel].mean()),
                        }
                    )
            out["calibration"] = bins
    return out


def interval_from_residuals(residuals, level: float = 0.9) -> dict:
    """Empirical residual quantiles. Coverage must be verified on unseen data."""
    res = _finite(residuals)
    res = res[np.isfinite(res)]
    if len(res) < 20:
        return {"level": level, "low": None, "high": None, "n": int(len(res))}
    alpha = (1 - level) / 2
    return {
        "level": level,
        "low": float(np.quantile(res, alpha)),
        "high": float(np.quantile(res, 1 - alpha)),
        "n": int(len(res)),
        "method": "empirical residual quantiles from the validation window",
    }


def interval_coverage(y_true, y_pred, intervals: dict) -> dict | None:
    if intervals.get("low") is None or intervals.get("high") is None:
        return None
    yt, yp = _finite(y_true), _finite(y_pred)
    low = yp + intervals["low"]
    high = yp + intervals["high"]
    inside = (yt >= low) & (yt <= high)
    return {
        "level": intervals["level"],
        "coverage": float(np.mean(inside)),
        "mean_width": float(np.mean(high - low)),
        "n": int(len(yt)),
    }


def equity_metrics(equity: np.ndarray, benchmark: np.ndarray | None = None, periods_per_year: int = 252) -> dict:
    eq = _finite(equity)
    if len(eq) < 2:
        return {}
    returns = np.diff(eq) / eq[:-1]
    returns = returns[np.isfinite(returns)]
    total_return = float(eq[-1] / eq[0] - 1)
    years = len(eq) / periods_per_year
    cagr = float((eq[-1] / eq[0]) ** (1 / years) - 1) if years > 0 and eq[0] > 0 and eq[-1] > 0 else None
    vol = float(np.std(returns, ddof=0) * np.sqrt(periods_per_year)) if len(returns) > 1 else 0.0
    downside = returns[returns < 0]
    downside_vol = float(np.std(downside, ddof=0) * np.sqrt(periods_per_year)) if len(downside) > 1 else 0.0
    peak = np.maximum.accumulate(eq)
    dd = eq / peak - 1
    max_dd = float(dd.min()) if len(dd) else 0.0
    out = {
        "total_return": total_return,
        "cagr": cagr,
        "annualized_volatility": vol,
        "sharpe_rf_zero": float(np.mean(returns) / np.std(returns, ddof=0) * np.sqrt(periods_per_year)) if len(returns) > 1 and np.std(returns, ddof=0) > 0 else None,
        "sortino_rf_zero": float(np.mean(returns) / np.std(downside, ddof=0) * np.sqrt(periods_per_year)) if len(downside) > 1 and np.std(downside, ddof=0) > 0 else None,
        "max_drawdown": max_dd,
        "observations": int(len(eq)),
        "note": "Risk-adjusted ratios assume a zero risk-free rate and daily returns; they are not annualized forecasts.",
    }
    if benchmark is not None and len(benchmark) == len(eq):
        bench = _finite(benchmark)
        out["benchmark_total_return"] = float(bench[-1] / bench[0] - 1)
        out["excess_return"] = total_return - out["benchmark_total_return"]
    return out


def to_builtin(obj):
    """Recursively convert numpy/pandas scalars so JSON columns are portable."""
    if isinstance(obj, dict):
        return {str(k): to_builtin(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_builtin(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        value = float(obj)
        return value if np.isfinite(value) else None
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, float) and not np.isfinite(obj):
        return None
    return obj
