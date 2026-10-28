# Data sources, provenance and limitations

## Provider abstraction

`backend/app/marketdata/base.py` defines the contract (`history`, `quote`, `batch_history`, `search`) and
provenance metadata. `service.py` owns caching, validation, freshness, symbol seeding and the honest failure
paths. Routers and analytics consume normalized frames, not provider-specific payloads.

Every response carries, where available: provider name, data status (`delayed`, `end_of_day`, `simulated`),
fetch time, observation end, currency, exchange and warnings.

## Yahoo Finance (default)

- Accessed server-side through **yfinance**.
- Daily adjusted OHLCV for research and charts; `fast_info` for a delayed quote when available, with a
  last-close fallback that is explicitly relabelled end-of-day.
- **Not a real-time exchange feed.** Quotes use the label `delayed`; daily bars use `end_of_day`.
- Coverage tested for US equities/indices and NSE symbols (`RELIANCE.NS`, `TCS.NS`, `^NSEI`).
- The provider can rate-limit (HTTP 429). The adapter retries once, then returns a clear error. If a
  fresh-enough cache exists, it may serve that cache with an age warning; it never substitutes random prices.
- History cache: SQLite bars keyed by symbol/interval/timestamp plus a cache metadata row. Default TTL is 20
  minutes (`DATA_CACHE_MINUTES`). Screener universe refresh uses the same TTL.
- Batch refresh of ~40 US symbols took about 3 seconds during verification.
- The interface displays stale observations (>7 days) with a warning.
- Adjusted prices depend on Yahoo's adjustments. Split/dividend correctness is not independently verified.
- **No point-in-time index membership or delisted-company universe** is available. Historical research is
  therefore not survivorship-free, and this is documented in the UI/report.

Yahoo's terms govern use. No redistribution right is claimed. A production deployment should select a
licensed provider appropriate to its jurisdiction, latency needs and entitlement.

## Simulated provider

Set `MARKET_DATA_PROVIDER=sample` to use deterministic synthetic daily paths seeded per symbol. Used for
offline development and tests only. Every response is labelled `simulated`, the UI shows a persistent banner,
and simulated output is never mixed into real research reports.

## User-uploaded datasets

- CSV only, size/row limited, parsed as text; no macros/scripts/formulas are executed.
- Column mapping is explicit; timestamp and close are required.
- Dates parse to UTC; non-positive/invalid closes are dropped and counted; duplicates keep the last
  timestamp+symbol row; OHLC inconsistencies are counted and optionally dropped.
- Adjusted close is set equal to close; no corporate-action inference.
- Files are stored under generated UUID names; original filenames are sanitized; path traversal is rejected by
  construction.
- Risk metrics are computed only for instruments with enough aligned daily observations. Uploaded data is not
  presented as a live feed and cannot be used to masquerade as one.

## News, fundamentals, macro, streaming

Not configured. No adapter is implemented. The UI shows a setup state and the API returns no fabricated
articles/fundamentals. A `NEWS_API_KEY` alone would not activate news because the adapter and license review
are missing.

## Brokerage

No broker adapter is implemented. `/api/v1/broker-connections` reports unavailability; live order requests
return HTTP 503; there is no hidden mock that reports success. Paper trading is separate and labelled.

## Backtest price basis

Backtests use provider-adjusted daily OHLC. Signals are evaluated at close `t` and executed at open `t+1`
with commission, slippage, optional half-spread, integer shares and long-only exposure. Stops are evaluated
on closes and executed next open; gap risk is not eliminated. This is a standard daily-bar simplification,
not an execution simulator.

## Provider replacement checklist

1. Implement `MarketDataProvider` (and optionally fundamentals/news/events) without leaking vendor payloads.
2. Normalize timestamps to UTC, preserve exchange/timezone/currency, and validate OHLCV.
3. Return provenance and failure states compatible with `ProviderMeta`.
4. Add cache TTL and rate-limit handling appropriate to your entitlements.
5. Keep adjusted/unadjusted semantics explicit; add point-in-time universes and corporate actions if needed.
6. Review licensing and redistribution restrictions before exposing data to end users.
7. Re-run leakage, screener, backtest and provider-failure tests.
