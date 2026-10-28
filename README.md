# StockPulse AI

An end-to-end quantitative research and paper-trading application: real market-data ingestion,
point-in-time feature engineering, chronological model evaluation, cost-aware backtests, portfolio risk,
watchlists/alerts, CSV data validation, and a simulated trading ledger.

The product is deliberately honest about its boundaries. Market data is delayed/end-of-day. Forecasts are
research estimates, not guarantees. Paper trading is simulated. **Live brokerage execution is not implemented
and is hard-disabled.**

## What is actually implemented

| Area | Working functionality |
|---|---|
| Landing page | Lazy-loaded React Three Fiber market globe, reduced-motion/WebGL fallback, real delayed index context, full product narrative |
| Authentication | Argon2id passwords, opaque server-side sessions (SHA-256 hashed), HttpOnly cookies, CSRF origin checks, login/reset rate limits, session revocation, password reset and change |
| Market data | Yahoo Finance adapter (`yfinance`) with provenance, validation, SQLite caching, stale-cache warnings, provider failure states, batch universe refresh, NSE + US coverage |
| Screener | Real computed metrics from cached OHLCV: price, 1M/3M/6M returns, realized volatility, RSI, SMA distance, volume ratio, ATR; filters, sorting, pagination, CSV export, saved presets |
| Research terminal | Candlesticks + volume via Lightweight Charts, SMA/Bollinger overlays, RSI/MACD, drawdown/volatility/range stats, notes, watchlist, alerts, CSV export |
| Prediction lab | Linear, Ridge, Lasso, Random Forest, Hist Gradient Boosting, Logistic, Extra Trees, Elastic Net, KNN, SVR; persistence/mean baselines; chronological 60/20/20 split with purged labels; validation-only selection; one-time test scoring; post-selection walk-forward stability check on validation; persisted experiments, artifacts and predictions |
| Strategy lab | Rule builder over indicators, entry/exit logic, stops, take-profit, max holding, position size; signal preview; persisted versioned strategies |
| Backtesting | Next-open execution, integer shares, commission/slippage/spread, transaction log, equity/drawdown, CAGR/Sharpe/Sortino/win-rate/profit-factor/turnover/exposure, benchmark comparison, CSV export |
| Portfolio lab | Manual positions, cost basis, allocation, concentration, volatility/drawdown, correlation, variance risk contribution, benchmark beta, hypothetical scenarios |
| Watchlists & alerts | Multiple lists, reordering, notes, equal-weight performance, comparison, periodic threshold alerts with cooldowns and in-app notifications |
| Compare lab | Normalized performance, cumulative returns, volatility, drawdowns, correlation matrix, rolling correlation, betas, risk/return scatter, CSV summary |
| Data Studio | CSV preview, server-side mapping/validation/cleaning, duplicates/OHLC checks, missingness, summary statistics, correlations, return histogram, export, deletion |
| Paper trading | Simulated accounts, Decimal cash/position ledger, market/limit orders, idempotency keys, fees/slippage, fills, rejections, cancellations, open-order processing, reset |
| Reliability | Promotion state, validation/test audit, matured forecast outcomes, explicit "not implemented" drift monitoring |
| Settings | Preferences, sessions, change password, audit trail, integration truth, account export, account deletion |
| Operations | Alembic baseline migration, health/readiness endpoints, Dockerfile, Compose + PostgreSQL, CI workflow, structured logs, in-process scheduler |

Unconfigured integrations—news, fundamentals, streaming market data, email delivery, MFA, brokerage—are
shown as setup states. The application does not fabricate a connection, a headline, or a fill.

## Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, Zustand,
  Framer Motion, React Three Fiber/Three.js, Lightweight Charts, Recharts, Vitest.
- **Backend:** Python 3.13, FastAPI, Pydantic, SQLAlchemy 2, Alembic, Argon2id, pandas, NumPy,
  scikit-learn, yfinance, joblib.
- **Database:** SQLite for local development; PostgreSQL for production via `psycopg`.
- **Workers:** in-process daemon threads for experiments/backtests and a periodic scheduler. This is
  explicit and durable queues are identified as remaining work.

## Quick start (local)

Requirements: Python 3.13+, Node 22+, npm.

```bash
# 1. Environment (placeholders only in .env.example; never commit .env)
cp .env.example .env

# 2. Backend
python3 -m venv .venv
./.venv/bin/pip install -r backend/requirements.txt
cd backend
../.venv/bin/uvicorn app.main:app --reload --port 8000

# 3. Frontend (second terminal)
cd frontend
npm ci
npm run dev
```

Open <http://localhost:5173>. The Vite dev server proxies `/api` to `localhost:8000`.

The app boots in `development` with `AUTO_CREATE_SCHEMA=true` and SQLite. Sample data appears per request;
the first screener/search call may take a few seconds while market history is fetched from Yahoo.

For an offline demo without network access:

```bash
MARKET_DATA_PROVIDER=sample BACKGROUND_JOBS=false ../.venv/bin/uvicorn app.main:app --reload
```

The UI then shows a persistent **SIMULATED DATA** banner. Simulated results are never presented as real markets.

## Environment variables

Copy `[.env.example](.env.example)`. Key settings:

| Variable | Purpose |
|---|---|
| `APP_ENV` | `development` or `production`; production enforces strong secrets, secure cookies and non-SQLite DB |
| `APP_URL`, `ALLOWED_ORIGINS` | SPA links and CORS/CSRF allow-list |
| `SECRET_KEY` | Required strong value in production |
| `DATABASE_URL` | SQLite dev default; `postgresql+psycopg://...` in production |
| `AUTO_CREATE_SCHEMA` | Dev convenience; set `false` in production and run Alembic |
| `COOKIE_SECURE` | Must be `true` in production |
| `SESSION_DAYS` | Session lifetime (default 7) |
| `MARKET_DATA_PROVIDER` | `yahoo` (real delayed data) or `sample` (clearly labelled synthetic) |
| `DATA_CACHE_MINUTES` | History cache freshness window |
| `MAX_UPLOAD_MB` | CSV upload limit |
| `BACKGROUND_JOBS` | Enables periodic alert and resting-limit evaluation |
| `NEWS_API_KEY`, `BROKER_*` | Placeholders only; see below |

**Where credentials come from:** this build needs **no API key for Yahoo/yfinance**; usage remains subject
to Yahoo's terms, rate limits and delayed-data limitations. News and brokerage variables are placeholders
because there is no implemented provider adapter; setting a key alone does not enable those features.
Do not treat `NEWS_API_KEY` as a working integration.

## Database migrations

Local development can auto-create tables, but migrations are the production path:

```bash
cd backend
DATABASE_URL=sqlite:///./local.db ../.venv/bin/alembic upgrade head
DATABASE_URL=sqlite:///./local.db ../.venv/bin/alembic downgrade base
```

The baseline migration is `backend/migrations/versions/…_initial_schema.py`. Run migrations as a single
release step before starting replicas; do not run them concurrently from every replica.

## Tests and verification

```bash
# Backend (45 tests)
cd backend && ../.venv/bin/python -m pytest -q

# Frontend unit tests (8 tests)
cd frontend && npm test

# Production build / typecheck
cd frontend && npm run build

# Lint (warnings, no errors)
cd frontend && npm run lint
```

Verified locally on 2026-10-27:

- Backend: **45 passed**.
- Frontend: **8 passed**.
- Frontend production build: **succeeded**.
- Alembic initial migration: **upgrade + downgrade succeeded** on SQLite.
- Headless browser journeys: registration → screener → research → real model training → forecast →
  strategies → portfolio → paper order; plus command palette, compare, watchlists/alerts, CSV import,
  integrations, privacy, mobile landing. **No console errors or page errors** in the extended journey.
- Dependency scans: `npm audit --omit=dev` found **0** vulnerabilities; `pip-audit -r backend/requirements.txt`
  found **no known vulnerabilities**. This is not a full supply-chain review.

Playwright smoke scripts are provided under `frontend/e2e/`. They require a running API on port 8010 and
real network access for Yahoo data; they are manual verification tools, not part of the CI workflow.

## Real-data research result (honest example)

A real Yahoo Finance run (AAPL, 5-year request, forward 5-session return) trained 5 models plus 2 baselines:

| Item | Result |
|---|---|
| Chronological split | Train 2022-01-27 → 2024-11-18 (707); validation 2024-11-26 → 2025-10-31 (233); test 2025-11-10 → 2026-10-20 (237) |
| Selected model | Random Forest (highest validation performance) |
| Validation RMSE | **4.780%** (zero-return baseline 4.883%, historical mean 4.869%) |
| Untouched test RMSE | **3.656%** (zero-return baseline **3.540%**, historical mean **3.505%**) |
| Test directional accuracy | **50.21%** |
| 90% residual interval coverage | **93.2%** on test |
| Post-selection walk-forward check | 6 expanding folds, 233 validation predictions, RMSE 4.803%, directional accuracy 51.07% — validation only, not used for selection |
| Conclusion | The model **did not beat the baseline on the untouched test window**. Promotion was refused. |

This demonstrates the intended behavior: validation-only selection, a one-time test audit, and an explicit
negative result. See [docs/MODEL_METHODOLOGY.md](docs/MODEL_METHODOLOGY.md) and [docs/STATUS.md](docs/STATUS.md).

## Deployment

### Docker Compose (PostgreSQL)

```bash
cp .env.example .env
# set SECRET_KEY, POSTGRES_PASSWORD; for real production set APP_ENV=production, COOKIE_SECURE=true
docker compose up --build
```

The `migrate` service runs `alembic upgrade head` once; `api` starts afterwards and serves both the API and
the built SPA on port 8000. Put a TLS-terminating reverse proxy in front, set `APP_URL` and
`ALLOWED_ORIGINS` to the public HTTPS origin, and keep `COOKIE_SECURE=true`.

**Docker was not available in this build environment**, so the image/Compose stack is provided but was not
executed here. The equivalent local build, migration and runtime paths were executed.

### Without Docker

1. Build the SPA: `cd frontend && npm ci && npm run build`.
2. Run migrations: `cd backend && alembic upgrade head` with the production `DATABASE_URL` and
   `AUTO_CREATE_SCHEMA=false`.
3. Start the API: `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1` from `backend/`.
   FastAPI serves `frontend/dist` when present.
4. Keep one background-capable process (or move jobs to a real queue) because experiment/backtest jobs and
   the alert scheduler run in-process. Running multiple API replicas duplicates the scheduler.

Health: `GET /health`. Readiness: `GET /ready`. OpenAPI: `/api/docs`. Operations, backup/restore, release and rollback: [docs/OPERATIONS.md](docs/OPERATIONS.md).

## API documentation

FastAPI generates the OpenAPI schema at `/api/openapi.json` and Swagger UI at `/api/docs`. Resource
ownership is enforced server-side for every user-owned record; tests cover cross-user access attempts.

## Repository layout

```
backend/app/
  routers/        auth, market, watchlists, alerts, ml, strategies, portfolios, datasets, paper, system
  marketdata/     provider contract, Yahoo adapter, labelled sample adapter, cache/provenance service
  analytics/      indicators, features, screener, portfolio risk
  ml/             model registry, chronological validation, metrics, experiment runner, predictions
  backtest/       next-open simulation engine
  paper/          Decimal paper ledger
  models.py       SQLAlchemy schema
  main.py         app factory, middleware, scheduler, SPA serving
backend/migrations/  Alembic baseline
backend/tests/       45 backend tests
frontend/src/        design system, app shell, 15 route-level pages, 3D hero, auth
frontend/e2e/       manual Playwright smoke journeys
docs/               methodology, sources, security, status matrix
samples/            clearly labelled synthetic OHLCV sample
```

## Limitations and safety

Read [docs/STATUS.md](docs/STATUS.md) for the complete, evidenced matrix. Highlights:

- No live brokerage integration, no streaming feed, no one-second autonomous trading, no news/fundamentals
  provider, no email verification/reset delivery, no MFA, no durable job queue.
- A single chronological test window governs selection. The walk-forward check is **post-selection and
  validation-only**; nested CV, Deflated Sharpe and PBO are **not** implemented. Model promotion is therefore
  a research gate, not production approval.
- Manual portfolio realized P/L, FX conversion and tax lots are not implemented.
- Backtests use adjusted prices and simplified costs; live fills are not guaranteed.
- Do not enable live trading based on this build. There is no live path to enable.

## Troubleshooting

- **Yahoo 429 / provider unavailable**: the API surfaces a 503 or uses fresh-enough cache with a warning.
  Wait, retry, or switch to `MARKET_DATA_PROVIDER=sample` for an explicitly labelled offline demo.
- **Login cookie not sticking**: use same-site origins (`localhost:5173` → `localhost:8000`) or set
  `COOKIE_SECURE=true` and serve both over HTTPS. Cross-site deployments need a reviewed cookie/CSRF design.
- **Alembic cannot import `app`**: run from `backend/`; `prepend_sys_path = .` is configured.
- **Screener is slow on first load**: it batch-fetches the curated universe. Later loads use the cache.
- **5xx after upgrade**: check `AUTO_CREATE_SCHEMA` vs migration state and the structured API log.

## Licensing / disclosure

No open-source license has been selected for this repository; add one before redistribution. Yahoo Finance
data is accessed through yfinance and remains subject to Yahoo's terms and any applicable exchange licensing.
No market-data redistribution right is claimed. This software is not investment advice and carries no
regulatory approval.
