# Operations, deployment and recovery

## Processes

| Process | Requirement |
|---|---|
| API | `uvicorn app.main:app --host 0.0.0.0 --port 8000` from `backend/` |
| SPA | Built into `frontend/dist`; served by FastAPI in production |
| Database | PostgreSQL recommended; SQLite only for a single-user local development instance |
| Migrations | One release job: `alembic upgrade head` before the new API starts |
| Scheduler/jobs | Runs inside the API process in this build; keep exactly one API worker, or move jobs to a durable queue |

The current job runner is a daemon thread. It does **not** survive restarts: at startup, queued/running
experiments and backtests are marked failed with an interruption message. This is intentional honesty, not a
durable queue. Do not run multiple replicas with `BACKGROUND_JOBS=true`; they would duplicate alert work and
compete for local SQLite.

## Configuration checks

- `APP_ENV=production` requires a strong `SECRET_KEY`, `COOKIE_SECURE=true`, a non-SQLite `DATABASE_URL`,
  and `AUTO_CREATE_SCHEMA=false` (the app refuses to boot otherwise).
- Run one `alembic upgrade head` and ensure it exits 0 before API rollout.
- Verify `GET /health` and `GET /ready` after deploy.
- `/api/docs` exposes the OpenAPI specification.
- Put TLS in front; set `APP_URL` and `ALLOWED_ORIGINS` to the public HTTPS origin.
- Set `MARKET_DATA_PROVIDER=yahoo` for real delayed data. Never enable `sample` in a user-facing production
  instance unless the product intentionally demonstrates simulated data with its banner.

## Backups and restore

This procedure is documented but **was not executed** in the build environment (no PostgreSQL server).

```bash
# Backup (run from a trusted host with credentials in a protected environment)
pg_dump --format=custom --file=stockpulse-$(date +%F).dump "$DATABASE_URL"

# Restore into a new database
createdb stockpulse_restore
pg_restore --dbname=postgresql://.../stockpulse_restore stockpulse-YYYY-MM-DD.dump
DATABASE_URL=postgresql+psycopg://.../stockpulse_restore alembic upgrade head
```

Then start a non-production API against the restored database, run `/health`, register a test account, open a
read-only page, and verify user-owned rows before any production cutover. Test the restore regularly; an
untested backup is not a recovery plan.

Dataset CSV files and joblib model artifacts live in `backend/storage/`; they are not inside the database
backup. Back up that directory with the same retention policy, or accept that artifacts/uploaded files must
be recreated. Account deletion removes owned files, but backup copies may persist until the backup-retention
window expires.

## Release and rollback

1. Build the SPA (`npm ci && npm run build`).
2. Run migrations once; record the Alembic revision.
3. Deploy the new API/SPA.
4. Verify health, login, a market read, and a paper order in a staging account.
5. If rollback is required, prefer restoring the previous application image and, if the migration is not
   backward-compatible, the pre-migration database backup. `alembic downgrade` may lose columns/tables and
   should be rehearsed on a copy first.
6. A new release must not automatically enable live trading. There is no live trading path.

## Monitoring hooks

Implemented or observable:

- Structured application logs (`stockpulse`, `stockpulse.alerts`, `stockpulse.ml`) for job/provider failures.
- `/health` and `/ready`.
- Job status/counts in `/api/v1/system/status`.
- Recent failures list in the same endpoint.
- Source/provider status in `/api/v1/settings/integrations` and `/api/v1/system/status`.
- Prediction outcome maturation in `/api/v1/model-health`.

Not implemented: metrics endpoint, tracing, error tracking service, log aggregation, alerting on job/provider
failures, and drift monitoring. Add these for a real deployment.

## Provider incidents

- Yahoo 429/outage: the API returns an explicit 503 or a labelled cached response. Do not make the UI claim
  live prices. Retry with backoff, reduce universe refresh frequency, or switch to an authorized provider.
- Cache corruption: clear `bars` and `data_cache_meta` rows for the affected symbol, then refresh.
- Database unavailable: `/ready` returns 503; stop the API and restore database connectivity before retrying
  writes. Do not blindly retry financial mutations; paper order idempotency keys prevent duplicate fills.

## Kill switches

There is no live order path. To stop all background financial evaluation:

1. Set `BACKGROUND_JOBS=false` and restart the API, or stop the process.
2. Alerts and resting paper limit evaluation stop immediately on process stop.
3. Paper market orders are already complete; outstanding paper limit orders remain local and can be
   cancelled from the paper workspace after restart.

A future live-trading design would require a separate, independently reachable kill switch, broker order
cancellation, position reconciliation, and restart checks. None of that exists here.

## Security operations

See [SECURITY.md](SECURITY.md). Rotate the session secret and database credentials if compromised, revoke
sessions, preserve audit logs, and disable integrations at the infrastructure level. Never log request bodies
that could contain passwords or broker credentials.

## Known production gaps

- No durable worker queue, distributed rate limiter, Redis, object storage or background scheduler service.
- No CI/CD execution evidence (workflow file is provided but was not run on GitHub).
- No tested PostgreSQL deployment, container build, backup/restore or load test in this environment.
- No live trading, streaming feed, news adapter, email/MFA, billing, or regulatory controls.
