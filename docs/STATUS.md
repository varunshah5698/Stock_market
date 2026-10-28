# Implementation status & verified evidence

Last verified: **2026-10-27**. This file distinguishes what was executed from what is merely present in code.
A component existing is not treated as verification.

## Verification actually executed

| Check | Command / method | Result |
|---|---|---|
| Backend test suite | `cd backend && ../.venv/bin/python -m pytest -q` | **45 passed** |
| Frontend unit tests | `cd frontend && npm test` | **8 passed** (2 files) |
| TypeScript + production build | `cd frontend && npm run build` | **succeeded** |
| Frontend lint | `npm run lint` | no errors; warnings remain (see below) |
| Alembic baseline | `alembic upgrade head`, then `downgrade base` on a fresh SQLite DB | **both succeeded**, 30 app tables + `alembic_version` |
| Real provider adapter | yfinance against Yahoo (AAPL, MSFT, NVDA, RELIANCE.NS, indices) | returned real delayed/end-of-day bars; batch of 40 symbols in ~3 s |
| ML on real data | AAPL, 5-year request, h=5, 5 models + 2 baselines | completed; test result **worse than baseline** (reported) |
| Headless browser journey 1 | register → overview → screener → research → train → forecast → strategy → portfolio → paper order → settings → reliability | passed; no page errors |
| Headless browser journey 2 | login page, command palette, compare, watchlist + alert + trigger, CSV preview/import/stats, news, integrations, privacy, mobile landing | passed; **no console/page errors**; mobile horizontal overflow 0 px |
| UTC serialization regression | API timestamp checked; alert displayed "just now" | fixed and observed |
| Frontend dependency audit | `npm audit --omit=dev` | **0 vulnerabilities** |
| Python dependency audit | `pip-audit -r backend/requirements.txt` | **no known vulnerabilities** |
| Docker / Compose | not executed | **Docker unavailable in this environment** |
| PostgreSQL runtime | not executed | psycopg installed; migration path targets PostgreSQL, but no server was available |
| GitHub Actions workflow | not executed | workflow file provided; local equivalent commands executed |

Lint warnings: 63 `oxlint` warnings, dominated by unused imports and React effect/purity advisories.
There are **no lint errors**. They are recorded rather than described as clean.

## Feature/integration matrix

Status values: **VERIFIED**, **IMPLEMENTED BUT UNVERIFIED**, **PARTIAL**, **MISSING**,
**BLOCKED BY EXTERNAL DEPENDENCY**.

| ID | Requirement | Status | Evidence / remaining gap |
|---|---|---|---|
| UI-01 | 3D cinematic landing page | VERIFIED | R3F globe rendered in headless Chromium screenshot; lazy chunk; reduced-motion/no-WebGL fallback code |
| UI-02 | Auth experience | VERIFIED | Login/register/forgot/reset E2E; screenshots |
| UI-03 | Persistent app shell + command palette | VERIFIED | Browser test opened palette with Ctrl+K and navigated to a symbol |
| UI-04 | 12+ substantial modules | VERIFIED | 14 routes beyond overview: screener, research, compare, prediction, experiment report, strategy lab, backtest report, portfolios, watchlists, data studio, paper, news, reliability, settings |
| UI-05 | Responsive/mobile | VERIFIED (landing) | 390 px mobile screenshot, no horizontal overflow; inner app pages designed responsive but not every page screenshot-tested on mobile |
| UI-06 | Loading/empty/error states | VERIFIED | Observed in browser and covered by shared components; provider failure path returns explicit error/503 |
| AUTH-01 | Argon2id password hashing | VERIFIED | Test asserts hash prefix and no plaintext |
| AUTH-02 | Server-side sessions, HttpOnly | VERIFIED | Session tests; opaque token; SHA-256 stored |
| AUTH-03 | Login/logout/refresh semantics | VERIFIED | Protected-route and logout tests |
| AUTH-04 | Password reset, single use, expiry | VERIFIED | Test covers reset, reuse rejection, session revocation |
| AUTH-05 | Change password | VERIFIED | Test covers current-password check and other-session revocation |
| AUTH-06 | Rate limiting | PARTIAL | In-process sliding windows on auth/reset/upload/job endpoints; single-process only, no shared Redis limiter |
| AUTH-07 | CSRF protection | VERIFIED | Origin allow-list + same-origin allowance; test rejects evil origin |
| AUTH-08 | Secure headers / CORS | VERIFIED | Header test; restrictive CSP, HSTS only with secure cookies |
| AUTH-09 | Email verification | MISSING | No email provider. State disclosed in UI |
| AUTH-10 | MFA / OAuth | MISSING | Explicitly shown as not implemented |
| SEC-01 | Per-user ownership isolation | VERIFIED | Tests across experiments, datasets, portfolios, paper accounts, watchlists, strategies/backtests, alerts |
| SEC-02 | Upload safety | VERIFIED | Extension/size/row limits, text-only parsing, generated storage paths, path traversal test, OHLC/duplicate validation |
| SEC-03 | Secret handling | VERIFIED | `.env` ignored; `.env.example` placeholders; no secrets in UI; account export excludes hashes/tokens |
| SEC-04 | Account export/delete | VERIFIED (backup path untested) | Automated test proves cascaded deletion, dataset file removal, invalidated access. Backup propagation remains a deployment obligation |
| SEC-05 | Audit logging | VERIFIED | Sensitive actions recorded; audit visible in settings; tested for auth flows |
| DATA-01 | Real replaceable market data adapter | VERIFIED | Yahoo adapter + provider contract; real data observed |
| DATA-02 | Provenance/freshness labels | VERIFIED | provider/status/fetched_at/observation time in UI/API; stale warnings |
| DATA-03 | No fabricated fallback | VERIFIED | Failures return errors; stale cache is labelled; sample provider is explicit |
| DATA-04 | Symbol search/exchange/currency metadata | VERIFIED | Curated universe + provider search; NSE + US tested |
| DATA-05 | Corporate actions / point-in-time integrity | PARTIAL | Provider-adjusted OHLC; no survivorship-free universe or point-in-time fundamentals; disclosed |
| SCREEN-01 | Computed screener filters | VERIFIED | Metrics computed from cached bars; real 40-name US universe rendered |
| SCREEN-02 | Sorting/pagination/export/presets | VERIFIED | UI + API; CSV export executed in browser flow (not file-content asserted) |
| SCREEN-03 | Saved screening preferences | VERIFIED | Presets stored server-side |
| RES-01 | Candlestick research page + indicators | VERIFIED | Real AAPL chart/overlays/RSI/MACD screenshot |
| RES-02 | Notes / watchlist / alert / export | VERIFIED (notes save API tested indirectly) | Notes persist endpoint; watchlist add and alert creation E2E |
| RES-03 | Fundamentals | BLOCKED | No reliable point-in-time provider; setup state shown |
| ML-01 | Causal feature pipeline | VERIFIED | Feature causality test appends future rows and compares vectors exactly |
| ML-02 | Target alignment | VERIFIED | Test compares h-step target against provider closes |
| ML-03 | Chronological split + purge | VERIFIED | Unit test proves ordering and embargo gaps; run shows dates/counts |
| ML-04 | Model zoo + baselines | VERIFIED | 7 families registered; persistence/mean and momentum/majority baselines; 5 models trained on real data |
| ML-05 | Validation-only selection | VERIFIED | Test asserts selected = best validation RMSE; test block scored once |
| ML-06 | Metrics/calibration/intervals | VERIFIED | MAE/RMSE/R²/direction; Brier/ROC-AUC/confusion; residual intervals with measured coverage |
| ML-07 | Persisted experiments/artifacts | VERIFIED | Experiment + model version + artifact + prediction persisted; JSON report download |
| ML-08 | Prediction endpoint | VERIFIED | Forecast generated in browser with data cutoff, version, interval, warnings |
| ML-09 | Promotion policy | VERIFIED | Validation-only policy; real candidate did not beat baseline and was **not approved** |
| ML-10 | Multiple-testing safeguards (DSR/PBO/selection bias) | MISSING | Sweep API records budget but no formal selection-bias correction; single frozen test only |
| ML-11 | Walk-forward / nested CV | PARTIAL | A 6-fold expanding-window stability check runs over the validation block after selection (233 predictions; RMSE 4.803%). It is not used for selection and does not touch test. Nested CV is not implemented |
| ML-12 | 1,000+ experiment scheduler | PARTIAL | API caps a sweep at 50; background thread runner exists. No 1,000-config batch was executed |
| ML-13 | Deep learning / cross-sectional / ensembles | MISSING | Not justified or implemented; no claims made |
| STRAT-01 | Strategy rule builder | VERIFIED | Templates + custom rules, logic groups, risk fields; persisted with versions |
| STRAT-02 | Signal preview | VERIFIED (UI path available) | Endpoint computes entry/exit markers; rendered in UI |
| BT-01 | Event-driven backtest, next-open execution | VERIFIED | Unit tests assert entry at next open and stop exits |
| BT-02 | Costs, integer shares, cash accounting | VERIFIED | Cost comparison test; commission reserved in sizing; no negative cash |
| BT-03 | Performance metrics | VERIFIED | Equity, drawdown, Sharpe/Sortino, trades, fees, turnover, benchmark; screenshot/report |
| BT-04 | Reproducibility | PARTIAL | Stored config/data window/strategy version; exact provider data snapshot not archived (bars cached locally) |
| BT-05 | Overfitting diagnostics | MISSING | No DSR/PBO/deflated metrics |
| PORT-01 | Positions/cost basis/allocation | VERIFIED | Empty and non-empty shapes; E2E position add; weights |
| PORT-02 | Risk/correlation/contribution | VERIFIED | 249-observation risk block with single holding; API test with two holdings |
| PORT-03 | Scenario simulator | VERIFIED | Server-side normalization and risk result; UI slider path |
| PORT-04 | FX / realized P/L / tax lots | MISSING | Multi-currency warns; removing a position does not compute realized P/L |
| WATCH-01 | Multiple lists/reorder/notes | VERIFIED | E2E add/reorder; API tests |
| WATCH-02 | Watchlist performance/comparison | VERIFIED | Equal-weight index API/UI |
| ALERT-01 | Price/percent/RSI alerts | VERIFIED | Manual check fired; cooldown prevents duplicate firing |
| ALERT-02 | Periodic processor | IMPLEMENTED BUT UNVERIFIED | Background scheduler code exists but browser E2E ran with scheduler disabled; manual check endpoint verified |
| ALERT-03 | Email/websocket delivery | MISSING | In-app only; setup state disclosed |
| COMP-01 | Multi-asset comparison/correlation | VERIFIED | Real AAPL/MSFT/NVDA comparison screenshot; overlap warnings |
| DS-01 | Upload preview/mapping/validation/cleaning | VERIFIED | Browser CSV import; duplicate/OHLC/missing-date unit tests |
| DS-02 | Stats/correlations/histogram/export/delete | VERIFIED | Browser stats screenshot; export and delete tests |
| DS-03 | Launch ML on uploaded dataset | MISSING | Analysis only; UI states the limitation |
| NEWS-01 | Authorized news feed | BLOCKED | No adapter/key; explicit setup state; zero fabricated headlines |
| PAPER-01 | Paper ledger + Decimal accounting | VERIFIED | Buy/sell/idempotency/short-rejection/limit-order tests; E2E order |
| PAPER-02 | Order lifecycle/cancel/process | VERIFIED (cancel API; processing) | State machine limited to NEW/OPEN/FILLED/REJECTED/CANCELLED |
| PAPER-03 | Reserved cash/partial fills | MISSING | Limit orders do not reserve cash; no partial fills; disclosed |
| BROKER-01 | Official live brokerage | BLOCKED / DISABLED | No adapter; `/orders` returns 503; no fake connection |
| TRADE-01 | Autonomous 1-second trading | MISSING / DISABLED | No streaming feed, no execution path, no kill switch needed because no live path |
| OPS-01 | Alembic migrations | VERIFIED | Upgrade and downgrade executed on fresh SQLite |
| OPS-02 | Health/readiness | VERIFIED | `/health`, `/ready`; readiness checks DB |
| OPS-03 | Durable jobs | MISSING | Threads die on restart; startup marks interrupted jobs failed |
| OPS-04 | Docker/Postgres | IMPLEMENTED BUT UNVERIFIED | Dockerfile/Compose provided; Docker and Postgres unavailable here |
| OPS-05 | Backups/restore | MISSING | Documented requirement only; no backup test |
| OPS-06 | CI | IMPLEMENTED BUT UNVERIFIED | Workflow file provided; not executed on GitHub |
| TEST-01 | Automated backend tests | VERIFIED | 45 pass |
| TEST-02 | Automated frontend tests | VERIFIED | 8 pass |
| TEST-03 | E2E browser tests | VERIFIED manually | Two headless Chromium journeys, real Yahoo data |
| TEST-04 | Broker sandbox/failure injection | MISSING | No broker adapter exists |

## Defects found and fixed during verification

1. **UTC timestamps serialized as naive local time.** Alerts displayed "5 hours ago" immediately after firing.
   Fixed with a `UTCDateTime` type decorator; regression test added; UI re-verified as "just now".
2. **Empty portfolio response had an incomplete summary shape**, causing a React crash and blank page.
   Fixed server contract and added a test; a route-level error boundary now prevents a blank shell.
3. **All-in backtest sizing ignored commission**, causing orders to be rejected by their own costs.
   Fixed sizing to reserve commission; unit test covers high-cost runs.
4. **CSRF rejected same-origin production SPA requests** because only the dev origin was allow-listed.
   Fixed to allow the request's own origin explicitly.
5. **Data Studio grid overflow** on desktop. Fixed with `minmax(0,1fr)` and `min-w-0`; measured 0 px overflow.
6. **Duplicate chart legend and stale account cash display** in paper/watchlists. Fixed.
7. **Alembic autogeneration referenced application code** in the baseline. Re-rendered to plain SQLAlchemy types.
8. **Account deletion crashed on the preferences relationship** and could leave the account partially undeleted. Fixed with passive-delete relationships; an automated test now verifies cascaded rows, file removal and loss of access.

## Live trading decision

**Do not enable live autonomous trading.** No live execution path exists. Even if one were added, the verified
build has a single test window, no formal multiple-testing correction, no drift monitoring, no durable
worker queue, no broker reconciliation, no tested kill switch, and untested backup/restore. Those are
blocking requirements, not nice-to-haves.
