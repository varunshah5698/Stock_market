# Security notes

This is a security-focused engineering review of the implemented system, not a certification. No external
penetration test, compliance audit, or professional legal/privacy review was performed.

## Trust boundaries

- Browser ↔ API: cookie-authenticated same-origin requests, validated server-side.
- API ↔ database: least-privilege credentials configured by the deployment.
- API ↔ market provider: server-side requests; no provider key is exposed to the browser.
- API ↔ broker: **does not exist** in this build.
- Uploaded files: untrusted input, parsed as CSV text only.

## Implemented controls

### Authentication and sessions

- Argon2id password hashing (`argon2-cffi`, time cost 3, 64 MB, parallelism 2); no plaintext storage.
- Password policy: 10–128 characters, at least one letter and one digit. Server-side enforcement.
- Opaque random session tokens (256 bits), stored only as SHA-256 hashes. Cookie is `HttpOnly`,
  `SameSite=Lax`, path-scoped, and `Secure` when `COOKIE_SECURE=true`.
- Sessions expire (`SESSION_DAYS`, default 7) and can be revoked individually or all at once. Password
  change/reset revokes other sessions.
- Login returns a generic error; per-IP and per-account rate limits slow brute force.
- Password reset tokens are random, hashed, single-use, expire after 30 minutes; responses do not reveal
  whether an email exists. In non-production only, the reset token is returned for local testing.

### Authorization and ownership

Every user-owned resource is queried with `user_id` or ownership of its parent. Tests cover cross-user
access to experiments, datasets, portfolios, watchlists, alerts, paper accounts and strategies/backtests.
There is no admin bypass in the shipped routes.

### CSRF, CORS, headers

- Unsafe methods require an `Origin` that is allow-listed or exactly the request's own origin. Browser
  same-origin SPA requests work; cross-site form/fetch attempts are rejected.
- CORS restricts credentials to configured origins.
- Response headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, restrictive
  `Content-Security-Policy` (`frame-ancestors 'none'`, self-only scripts/connects), referrer policy,
  permissions policy, and HSTS when secure cookies are enabled.
- `no-store` cache headers are applied to API responses by default.

### Input and upload handling

- Pydantic server-side validation for request bodies, limits on lengths/numbers, symbol normalization.
- SQLAlchemy parameterized queries throughout; no string-built SQL.
- CSV: extension/size/row limits, duplicate-header rejection, explicit mapping, numeric coercion, OHLC
  validation, deduplication and UTC parsing. Files are re-parsed server-side; no macro/eval path exists.
- Storage paths are generated server-side; delete verifies the resolved path is inside the dataset directory.
- Exports prefix spreadsheet formula triggers (`=`, `+`, `-`, `@`) with an apostrophe in CSV output.

### Financial operation safety

- Paper orders use client idempotency keys with a unique `(account, key)` constraint; retries return the
  existing order instead of duplicating cash/position changes.
- Cash and position updates occur in one database transaction; insufficient cash/position rejects the order.
- Short selling is rejected. Limit orders do not reserve cash (explicit limitation).
- Live brokerage is hard-disabled. No endpoint can submit a real order. Attempts return 503.
- Paper vs live/real state is labelled throughout the UI and API. No autonomous execution loop exists.

### Secrets and logs

- `.env` is gitignored; `.env.example` contains placeholders only.
- Provider requests are server-side. Account export excludes password hashes and session tokens.
- Error responses use generic 500 copy; stack traces go to server logs.
- Broker/news/email credentials are not stored because those integrations do not exist. If added, use
  encrypted secret storage, narrow scopes, revocation and redaction tests.

### Audit and deletion

- Authentication, watchlist/strategy/experiment/backtest/paper/dataset/model/account actions write audit
  events without credentials.
- Users can export owned data and delete the account. Dataset files and model artifacts are removed;
  database rows cascade. Audit user references are nullable and become anonymized.
- Backup retention propagation is a deployment responsibility and is **not implemented/tested here**.

## Threat model summary

| Threat | Control | Residual risk |
|---|---|---|
| Account takeover | Argon2id, generic login errors, rate limits, reset token expiry | No MFA; no device/risk scoring; in-process rate limiter bypassable by multi-process/proxy |
| Broken authorization | Per-user queries, tests | Future routes must keep the pattern; no centralized policy engine |
| Session theft | HttpOnly/SameSite/Secure, server-side revocation | XSS or local compromise remains dangerous; no token binding |
| Credential leakage | Server-side keys, `.env` ignored, no secrets in UI | A deployment can still misconfigure logs/proxies |
| Malicious upload | CSV-only parsing, limits, generated paths | Parser resource use; no antivirus/CDR; 200k rows can be costly |
| Rate-limit abuse | Sliding windows on sensitive routes | Only some routes; in-memory; no shared store |
| SQL injection | ORM parameterization | Raw SQL additions would need review |
| XSS | React escaping, CSP self-only scripts | Inline styles allowed; no DOM `dangerouslySetInnerHTML` used |
| CSRF | Origin allow-list; SameSite | Non-browser clients are not protected by CSRF (and do not use ambient browser cookies) |
| SSRF | No user-supplied URL fetching | Provider adapters must not add arbitrary URLs |
| Replay / duplicate paper orders | Idempotency key + unique constraint | Not relevant to live trading (no live path) |
| Unsafe deserialization | Model artifacts are server-generated joblib; uploads are CSV-only | Joblib is not safe against a compromised artifact store; production should prefer a safer format/signing |
| Supply chain | Pinned major ranges; lockfile for frontend | No SBOM/vulnerability gate yet; CI workflow does not scan dependencies |
| Unauthorized trading permission changes | Trading is disabled; no permission mutation route | Would require a new reviewed design |

## Security-relevant limitations

- Rate limiting and background jobs are **in-process**. Multi-replica deployments need Redis/shared limits
  and a durable queue; otherwise limits and scheduled work are per-process.
- No email verification, MFA, OAuth, or password-breach check.
- No CSRF token; defense relies on SameSite=Lax plus strict origin validation. Document this before changing
  cookie/site topology.
- No security headers on the Vite dev server origin (only the API/SPA production responses); production is
  intended to serve the built SPA from the API origin with the configured CSP.
- The CSP currently allows `style-src 'unsafe-inline'`, needed by the styling approach and third-party SVG
  inline styles. Tighten it in production if feasible.
- Backups, restore, and database least-privilege setup are deployment tasks; not tested here.
- No WAF, bot protection, anomaly detection, or SIEM integration.
- The app does not claim PCI, SOC 2, GDPR, SEBI, SEC, or any other compliance status.

## Incident response checklist

1. Set `BACKGROUND_JOBS=false` (or stop the process) to halt alert/limit evaluation.
2. Rotate `SECRET_KEY` and database/provider credentials.
3. Revoke all sessions (users can do this in Settings; an operator can revoke rows in `sessions`).
4. Revoke/rotate any future broker credentials and disable the broker adapter.
5. Preserve audit logs, API logs, and database state before remediation.
6. Notify affected users and the deployment operator according to applicable obligations.
7. Restore from a verified backup only after confirming its integrity; live trading remains disabled.

## Reporting

This is a local research build. Report security issues to the operator of the deployment. Do not include
secrets, real account data, or live brokerage tokens in a report.
