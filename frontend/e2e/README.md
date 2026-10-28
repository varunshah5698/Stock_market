# Manual browser verification

These scripts drive a real Chromium session against the running application and real (delayed) Yahoo data.
They are verification tools, not part of the CI workflow.

```bash
# terminal 1: API with a fresh database
cd backend
APP_ENV=development SECRET_KEY=dev-secret-key-that-is-long-enough-for-tests \
MARKET_DATA_PROVIDER=yahoo BACKGROUND_JOBS=false \
DATABASE_URL=sqlite:///./e2e.db ../.venv/bin/uvicorn app.main:app --port 8010

# terminal 2
cd frontend
npx playwright install chromium   # once
BASE=http://127.0.0.1:8010 SHOTS=/tmp node e2e/smoke.mjs
BASE=http://127.0.0.1:8010 SHOTS=/tmp node e2e/extended.mjs
```

`smoke.mjs` covers registration, overview, screener, research, real model training and forecasting,
strategies, portfolio creation, a paper buy, settings and reliability.

`extended.mjs` covers the login page, command palette, compare lab, watchlist add, an alert trigger, CSV
preview/import/statistics, news setup state, integrations and privacy, plus a 390 px mobile landing check.

These scripts write screenshots to `$SHOTS` (default `/tmp`). They use fresh random accounts and do not
delete them automatically.
