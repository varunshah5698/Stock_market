# Model methodology

## Objective

Determine whether point-in-time market data contains a reproducible predictive signal, compare candidates
against meaningful baselines, and expose the uncertainty and failure modes. The system does **not** claim
that a low training error, a high historical score, or a profitable backtest will persist.

## Target definitions

The prediction lab supports:

- **Forward return**: `close[t+h] / close[t] - 1`, where `t` is the last session whose features are complete.
- **Direction**: `1` when the forward h-session return is positive, otherwise `0`.

`h` is a configurable number of **trading sessions**, 1–60. A predicted return is converted to a price
scenario only by applying it to the last close, with the assumption stated in the API/UI. A probability is
not a price forecast and is not described as a calibrated probability unless calibration was measured.

## Data

- Provider: Yahoo Finance via yfinance in the default deployment; delayed/end-of-day.
- Price basis for research: provider adjusted close for labels and features; adjusted OHLC for charts.
- The same provider-normalized frame feeds model training, inference, and strategy evaluation.
- If the provider fails, the API errors or serves labelled cache. It never invents bars.
- Simulations use the `sample` provider only when explicitly configured; those results are marked simulated.

## Feature pipeline (version `2026-10-v1`)

28 causal features:

- **Price action:** 1/5/10/21-session returns; return lags 1–5; gap; high–low range.
- **Trend:** close/SMA(10), close/SMA(50), EMA(12)/EMA(26) spread, momentum(63), distance from 20-session high, 63-session drawdown.
- **Momentum oscillators:** RSI(14) normalized, MACD histogram / close, Bollinger %B and width (20, 2σ).
- **Risk:** ATR(14)/close, 20- and 60-session realized volatility, volatility ratio, downside volatility.
- **Volume:** volume / 20-session average - 1, 1-session volume change, clipped to reduce extreme distortion.

Every feature at row `t` uses observations up to and including `t` only. A test appends future rows and
asserts that historical feature vectors are byte-for-byte unchanged. Rolling windows use `min_periods` so
incomplete warm-up values are dropped rather than back-filled.

**Not included:** retained fundamental factors, macro series, cross-asset features, order-book features,
intraday bars, sector-relative factors. Their absence is intentional rather than hidden.

## Chronological protocol

Default:

```
|---------------- train 60% ----------------|  purge h  |-- validation 20% --|  purge h  |-- test 20% --|
```

- Rows are never shuffled.
- The last `h` rows of each earlier segment are removed to prevent overlap between a training label's
  future window and the next segment's features (an embargo/purge).
- Training fits preprocessing (StandardScaler where applicable) only on its own rows.
- Model selection uses **validation** only.
- The selected pipeline is refit on train + validation and scored **once** on the untouched test block.
- The test block is never used for feature choice, hyperparameter choice, interval calibration, or approval.

Minimum sizes: 120 training, 40 validation, 40 test after feature construction. Insufficient data fails
with an explicit error.

## Models

| Key | Family | Typical role |
|---|---|---|
| `linear` | OLS | transparent baseline |
| `ridge` | L2 linear | regularized baseline |
| `lasso` | L1 linear | sparse baseline |
| `elastic_net` | L1/L2 | sparse/regularized alternative |
| `random_forest` | tree ensemble | nonlinear tabular candidate |
| `extra_trees` | randomized trees | nonlinear alternative |
| `hist_gradient_boosting` | boosted trees | strong tabular candidate |
| `knn` | distance-based | nonparametric comparison |
| `svr` | kernel regression | optional expensive candidate |
| `logistic` | linear classifier | direction probability |
| `hist_gradient_boosting_clf` | boosted classifier | direction probability |
| `random_forest_clf` | tree classifier | direction probability |
| `xgboost` (optional) | boosted trees | only registered if the dependency is installed |

Baselines:

- **Return:** zero-return persistence; historical training-mean return.
- **Direction:** sign of the last 1-session return; training-period majority class.

XGBoost is absent from the default environment; the registry exposes it only if importable. Deep-learning,
sequence, cross-sectional ranking and stacked ensembles are **not implemented**.

## Metrics

Regression: MAE, median absolute error, RMSE, R², directional accuracy, mean error, target/prediction
standard deviation, sample size. R² can be negative; it is shown rather than hidden.

Classification: accuracy, balanced accuracy, precision, recall, F1, confusion matrix, ROC-AUC when both
classes exist, Brier score and probability buckets.

Uncertainty: 90% intervals are empirical residual quantiles from the **validation** window, applied to test
predictions. Coverage is measured on the test window and reported with the mean width. This is a simple
conformal-style procedure, not a guarantee under distribution shift; overlapping h-session labels mean
observations are not independent.

All model comparisons show the validation result. Only the selected candidate receives a test result; scoring
every candidate on test would multiply selection bias.

## Selection and promotion

Selection: lowest validation RMSE for return targets; highest validation ROC-AUC (fallback balanced accuracy)
for direction targets.

Promotion policy (validation-only, versioned in code):

- At least 100 validation observations.
- Return: validation RMSE at least **5%** better than the zero-return baseline and directional accuracy ≥ 50%.
- Direction: balanced accuracy > 0.52, ROC-AUC > 0.52 when available, and a Brier score present.
- Passing marks a research candidate; it does not imply live-trading approval. Only one model version can be
  approved at a time; approval does not touch the test block.
- A single model can also be rejected explicitly when evidence is weak.

## Real-data example (executed)

AAPL · 5-year request · target h=5 forward return · 5 candidates + 2 baselines · Yahoo data.

| Model | Validation RMSE | Validation directional accuracy |
|---|---:|---:|
| Linear | 5.822% | 46.78% |
| Ridge | 5.406% | 44.64% |
| Lasso | 5.270% | 46.35% |
| Random Forest (selected) | **4.780%** | 59.66% |
| Hist Gradient Boosting | 5.000% | 54.51% |
| Zero-return baseline | 4.883% | — |
| Historical mean baseline | 4.869% | — |

Untouched test (2025-11-10 → 2026-10-20, n=237):

- Random Forest RMSE: **3.656%**
- Zero-return baseline RMSE: **3.540%**
- Historical mean RMSE: **3.505%**
- Directional accuracy: **50.21%**
- 90% interval coverage: **93.2%** (mean width ~13.4%)
- **Promotion: refused.** The model did not beat the baseline on the test window.

Post-selection walk-forward diagnostic (validation only): 6 expanding-window refits, 233 predictions,
RMSE 4.803%, directional accuracy 51.07%. This check is not used for model selection and does not touch the
test block. It is a stability signal, not independent confirmation.

This is the expected output of an honest research process: a candidate can look reasonable on validation and
fail out of sample. No substitute "better" result was selected, and no profit claim is made.

## Reproducibility

Each experiment stores: symbol, target, horizon, feature version and names, provider, requested period,
train/validation/test fractions, models requested, per-model validation metrics/errors/runtime, selected
model, test metrics, interval/coverage, warnings, split dates/counts, sklearn version, timestamps, and an
artifact reference. Seeds are fixed for tree/regularized models where supported. Artifacts are server-generated
joblib files; they are never user-uploaded and are loaded only through an owned model-version record.

Reproducing a run depends on the provider's historical data still being available and unchanged. The database
caches bars, but the provider may revise adjustments. This is a known reproducibility limitation.

## Known methodological gaps

- Single chronological holdout for selection; the **walk-forward check is post-selection and validation-only**,
  not nested cross-validation.
- **No formal correction** for selecting among many configurations (no Deflated Sharpe, PBO, or White's
  Reality Check). Sweeps warn about this but do not solve it.
- No regime-conditioned validation, drift monitoring, or automatic retraining.
- No purged cross-validation for every h; only boundary purges for the three segments.
- Walk-forward folds are not used for model/hyperparameter selection.
- Interval coverage is checked on one test window, not across rolling windows.
- No economic significance test beyond the separate, simplified backtest engine.

These gaps are why model approval is not production approval.
