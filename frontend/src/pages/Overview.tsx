import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  BellRing,
  BrainCircuit,
  ChartNoAxesCombined,
  Database,
  Gauge,
  Plus,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AreaTrend, SimpleBars } from '../components/charts'
import { DataStatus, EmptyState, ErrorState, LoadingPanel, Metric, PageHeader, SectionTitle, StatusPill, WarningList } from '../components/ui'
import { api } from '../lib/api'
import { cn, fmtCompact, fmtDateTime, fmtMoney, fmtNumber, fmtPct, pctClass, relativeTime } from '../lib/format'
import { useDocumentTitle } from '../lib/hooks'
import { readRecentSymbols } from '../lib/recent'
import type { InstrumentHistory, OverviewPayload, Quote } from '../lib/types'

const PERIODS = [
  { value: '3mo', label: '3M' },
  { value: '6mo', label: '6M' },
  { value: '1y', label: '1Y' },
]

function IndexCard({ quote }: { quote: Quote }) {
  return (
    <Link to={`/app/research/${encodeURIComponent(quote.symbol)}`} className="panel-quiet group px-3.5 py-3 transition hover:border-white/20">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10.5px] text-mutedx">{quote.name ?? quote.symbol}</span>
        <span className="font-mono text-[8px] text-dimx">{quote.symbol}</span>
      </div>
      <div className="mt-2 flex items-end justify-between">
        <span className="num text-[17px] text-white">{fmtNumber(quote.price, 2)}</span>
        <span className={cn('flex items-center gap-1 num text-[11px]', pctClass(quote.change_pct))}>
          {quote.change_pct !== null && quote.change_pct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {fmtPct(quote.change_pct)}
        </span>
      </div>
      <div className="mt-1.5 font-mono text-[8.5px] text-dimx">as of {quote.as_of ?? '—'}</div>
    </Link>
  )
}

export default function Overview() {
  useDocumentTitle('Overview')
  const [period, setPeriod] = useState('6mo')
  const [benchmark, setBenchmark] = useState<'^GSPC' | '^NSEI'>('^GSPC')
  const recentSymbols = readRecentSymbols()

  const overview = useQuery<OverviewPayload>({
    queryKey: ['overview'],
    queryFn: () => api('/api/v1/markets/overview'),
    refetchInterval: 120_000,
  })

  const chart = useQuery<InstrumentHistory>({
    queryKey: ['overview-chart', benchmark, period],
    queryFn: () => api(`/api/v1/instruments/${encodeURIComponent(benchmark)}/history?period=${period}`),
    staleTime: 120_000,
  })

  const recent = useQuery<{ quotes: Quote[]; missing: string[] }>({
    queryKey: ['recent-quotes', recentSymbols.join(',')],
    queryFn: () => api(`/api/v1/markets/quotes?symbols=${encodeURIComponent(recentSymbols.join(','))}`),
    enabled: recentSymbols.length > 0,
  })

  const sectors = useMemo(
    () =>
      (overview.data?.sectors ?? []).map((sector) => ({
        label: sector.sector.replace('Communication Services', 'Comm. svcs').replace('Consumer Discretionary', 'Cons. disc.'),
        value: sector.avg_return_1m_pct,
      })),
    [overview.data],
  )

  if (overview.isLoading) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Overview" title="Market command center" description="Loading market context, watchlist and research state." />
        <div className="grid gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <LoadingPanel key={item} rows={1} />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <LoadingPanel rows={5} />
          <LoadingPanel rows={5} />
        </div>
      </div>
    )
  }

  if (overview.isError) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Overview" title="Market command center" />
        <ErrorState message={overview.error instanceof Error ? overview.error.message : 'Market data is unavailable.'} onRetry={() => void overview.refetch()} />
      </div>
    )
  }

  const data = overview.data!
  const chartBars = chart.data?.bars ?? []

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`Overview · ${data.market_status.status.toLowerCase().replace('-', ' ')} (clock estimate)`}
        title="Market command center"
        description={
          <>
            Personalized context from delayed/end-of-day data. Watchlist moves are not portfolio returns.{' '}
            <span className="text-dimx">Updated {relativeTime(data.generated_at)}.</span>
          </>
        }
        actions={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => void overview.refetch()} disabled={overview.isFetching}>
              <RefreshCw className={cn('h-3.5 w-3.5', overview.isFetching && 'animate-spin')} /> Refresh
            </button>
            <Link to="/app/prediction" className="btn btn-primary btn-sm">
              <BrainCircuit className="h-3.5 w-3.5" /> New experiment
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {data.indices.map((index) => <IndexCard key={index.symbol} quote={index} />)}
        {data.indices.length === 0 && (
          <div className="panel-quiet col-span-full p-4 text-[11px] text-mutedx">No index observations available from the provider.</div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <div className="space-y-4">
          <section className="panel p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="eyebrow mb-1">Market trend</div>
                <div className="flex items-center gap-2">
                  <span className="display text-[15px] text-white">{benchmark === '^GSPC' ? 'S&P 500' : 'Nifty 50'}</span>
                  <DataStatus provider={data.provider.name} status={chart.data?.meta.data_status ?? data.provider.data_status} fetchedAt={chart.data?.meta.fetched_at} compact />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex rounded-md border border-white/[0.08] p-0.5" role="group" aria-label="Benchmark">
                  {[
                    ['^GSPC', 'US'],
                    ['^NSEI', 'India'],
                  ].map(([symbol, label]) => (
                    <button
                      key={symbol}
                      onClick={() => setBenchmark(symbol as '^GSPC' | '^NSEI')}
                      className={cn('rounded px-2 py-1 text-[10px] transition', benchmark === symbol ? 'bg-white/[0.08] text-white' : 'text-dimx hover:text-white')}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex rounded-md border border-white/[0.08] p-0.5" role="group" aria-label="Chart period">
                  {PERIODS.map((item) => (
                    <button
                      key={item.value}
                      onClick={() => setPeriod(item.value)}
                      className={cn('rounded px-2 py-1 font-mono text-[9px] transition', period === item.value ? 'bg-white/[0.08] text-white' : 'text-dimx hover:text-white')}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {chart.isLoading ? (
              <div className="skeleton h-[220px] w-full" />
            ) : chart.isError ? (
              <ErrorState message={chart.error instanceof Error ? chart.error.message : 'Chart unavailable'} onRetry={() => void chart.refetch()} />
            ) : chartBars.length === 0 ? (
              <EmptyState title="No chart observations" description="The provider returned no daily bars for this benchmark." icon={<ChartNoAxesCombined className="h-5 w-5" />} />
            ) : (
              <AreaTrend
                dates={chartBars.map((bar) => bar.date)}
                values={chartBars.map((bar) => bar.adj_close)}
                height={210}
                color={benchmark === '^GSPC' ? '#8b5cf6' : '#22d3ee'}
                valueFormatter={(value) => fmtNumber(value, 0)}
              />
            )}
          </section>

          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <div>
                <div className="eyebrow mb-0.5">Watchlist</div>
                <div className="text-[13px] text-white">{data.watchlist.name ?? 'No watchlist yet'}</div>
              </div>
              <Link to="/app/watchlists" className="text-[10px] text-violet-400 hover:text-white">Manage</Link>
            </div>
            {data.watchlist.symbols.length === 0 ? (
              <EmptyState title="Your watchlist is empty" description="Add symbols to see delayed movement and open research quickly." action={<Link to="/app/watchlists" className="btn btn-outline btn-sm"><Plus className="h-3.5 w-3.5" /> Add symbols</Link>} />
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr><th>Symbol</th><th className="text-right">Last</th><th className="text-right">1D</th><th className="text-right">As of</th><th /></tr>
                  </thead>
                  <tbody>
                    {data.watchlist.symbols.map((quote) => (
                      <tr key={quote.symbol}>
                        <td><Link to={`/app/research/${encodeURIComponent(quote.symbol)}`} className="font-mono text-[11px] text-white hover:text-violet-300">{quote.symbol}</Link></td>
                        <td className="num text-right text-white">{fmtNumber(quote.price, 2)} <span className="text-[8px] text-dimx">{quote.currency}</span></td>
                        <td className={cn('num text-right', pctClass(quote.change_pct))}>{fmtPct(quote.change_pct)}</td>
                        <td className="text-right font-mono text-[9px] text-dimx">{quote.as_of ?? '—'}</td>
                        <td className="text-right"><Link to={`/app/research/${encodeURIComponent(quote.symbol)}`} className="text-dimx hover:text-white" aria-label={`Open ${quote.symbol}`}><ArrowRight className="h-3.5 w-3.5" /></Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="panel p-4">
              <SectionTitle eyebrow="Sector breadth" title="US sector return · 1M" action={<Link to="/app/screener" className="text-[10px] text-violet-400 hover:text-white">Screener</Link>} />
              {sectors.length ? (
                <SimpleBars
                  data={sectors}
                  height={240}
                  layout="vertical"
                  valueFormatter={(value) => `${value.toFixed(0)}%`}
                  colorFor={(value) => (value >= 0 ? 'rgba(52,224,161,0.7)' : 'rgba(255,107,138,0.7)')}
                />
              ) : (
                <EmptyState title="Sector metrics not cached" description="Open the screener once to populate the instrument universe, then return here." icon={<ScanSearch className="h-5 w-5" />} action={<Link to="/app/screener" className="btn btn-outline btn-sm">Open screener</Link>} />
              )}
              <div className="mt-2 text-[9.5px] text-dimx">{data.coverage.sector_metrics}</div>
            </section>
            <section className="panel p-4">
              <SectionTitle eyebrow="Market movers" title="Polled universe" />
              <div className="space-y-1">
                {data.market_movers.slice(0, 7).map((quote) => (
                  <Link key={quote.symbol} to={`/app/research/${encodeURIComponent(quote.symbol)}`} className="flex items-center justify-between rounded-md px-1.5 py-1.5 transition hover:bg-white/[0.03]">
                    <span className="font-mono text-[10.5px] text-white">{quote.symbol}</span>
                    <span className="flex items-center gap-3">
                      <span className="num text-[10px] text-mutedx">{fmtNumber(quote.price, 2)}</span>
                      <span className={cn('num w-16 text-right text-[10px]', pctClass(quote.change_pct))}>{fmtPct(quote.change_pct)}</span>
                    </span>
                  </Link>
                ))}
                {data.market_movers.length === 0 && <div className="py-8 text-center text-[11px] text-dimx">No snapshots available.</div>}
              </div>
            </section>
          </div>
        </div>

        <div className="space-y-4">
          <section className="panel p-4">
            <SectionTitle eyebrow="Portfolio" title="Estimated value" action={<Link to="/app/portfolios" className="text-[10px] text-violet-400 hover:text-white">Open lab</Link>} />
            {data.portfolios.length === 0 ? (
              <EmptyState title="No portfolios yet" description="Add manual positions to monitor exposure and risk. Values are delayed estimates, not broker balances." icon={<Wallet className="h-5 w-5" />} action={<Link to="/app/portfolios" className="btn btn-outline btn-sm"><Plus className="h-3.5 w-3.5" /> Create portfolio</Link>} />
            ) : (
              <div className="space-y-3">
                {data.portfolios.map((portfolio) => (
                  <Link key={portfolio.id} to="/app/portfolios" className="block rounded-lg border border-white/[0.06] bg-white/[0.015] p-3 transition hover:border-white/15">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-white">{portfolio.name}</span>
                      <span className={cn('num text-[11px]', pctClass(portfolio.unrealized_pnl))}>{fmtMoney(portfolio.unrealized_pnl, portfolio.currency)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="num text-[15px] text-white">{fmtMoney(portfolio.market_value, portfolio.currency)}</span>
                      <span className="font-mono text-[9px] text-dimx">{portfolio.positions} position{portfolio.positions === 1 ? '' : 's'}</span>
                    </div>
                    <div className="mt-1 text-[9px] text-dimx">{portfolio.valuation}</div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="panel p-4">
            <SectionTitle eyebrow="Monitoring" title="Alerts & data" action={<Link to="/app/watchlists" className="text-[10px] text-violet-400 hover:text-white">Alerts</Link>} />
            <div className="grid grid-cols-2 gap-3">
              <Metric label="Active alerts" value={data.alerts.active} sub="periodic evaluation" />
              <Metric label="Unread" value={data.alerts.unread_notifications} sub="in-app notifications" />
              <Metric label="Cached bars" value={fmtCompact(data.coverage.cached_bars)} sub="local SQLite cache" />
              <Metric label="Instruments" value={data.coverage.instruments} sub="curated universe" />
            </div>
            <div className="mt-3 rounded-md border border-white/[0.06] bg-black/20 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-mutedx">{data.provider.name} provider</span>
                <span className={cn('h-1.5 w-1.5 rounded-full', data.provider.data_status === 'simulated' ? 'bg-warn' : 'bg-cyanx')} />
              </div>
              <div className="mt-1 text-[9.5px] leading-relaxed text-dimx">{data.provider.notes}</div>
              <Link to="/app/settings" className="mt-2 inline-flex items-center gap-1 text-[9.5px] text-violet-400 hover:text-white">Provider settings <ArrowRight className="h-2.5 w-2.5" /></Link>
            </div>
          </section>

          <section className="panel p-4">
            <SectionTitle eyebrow="Recent research" title="Runs & reports" action={<Link to="/app/prediction?tab=experiments" className="text-[10px] text-violet-400 hover:text-white">All</Link>} />
            <div className="space-y-2">
              {data.recent_experiments.map((experiment) => (
                <Link key={experiment.id} to={`/app/experiments/${experiment.id}`} className="flex items-center justify-between rounded-md border border-white/[0.05] px-2.5 py-2 transition hover:border-white/15">
                  <span className="flex items-center gap-2">
                    <BrainCircuit className="h-3 w-3 text-violet-400" />
                    <span className="font-mono text-[10px] text-white">{experiment.symbol}</span>
                    <span className="text-[9px] text-dimx">{experiment.target} h{experiment.horizon}</span>
                  </span>
                  <StatusPill status={experiment.status} />
                </Link>
              ))}
              {data.recent_backtests.map((backtest) => (
                <Link key={backtest.id} to={`/app/backtests/${backtest.id}`} className="flex items-center justify-between rounded-md border border-white/[0.05] px-2.5 py-2 transition hover:border-white/15">
                  <span className="flex items-center gap-2">
                    <Gauge className="h-3 w-3 text-cyanx/80" />
                    <span className="font-mono text-[10px] text-white">{backtest.symbol}</span>
                    <span className={cn('num text-[9px]', pctClass((backtest.total_return ?? 0) * 100))}>{backtest.total_return !== null ? fmtPct(backtest.total_return * 100) : '—'}</span>
                  </span>
                  <StatusPill status={backtest.status} />
                </Link>
              ))}
              {data.recent_experiments.length === 0 && data.recent_backtests.length === 0 && (
                <div className="py-6 text-center">
                  <p className="text-[11px] text-mutedx">No research runs yet.</p>
                  <Link to="/app/prediction" className="btn btn-outline btn-sm mt-3">Run a model comparison</Link>
                </div>
              )}
            </div>
          </section>

          <section className="panel p-4">
            <SectionTitle eyebrow="Recently viewed" title="Jump back in" />
            {recentSymbols.length === 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {['AAPL', 'MSFT', 'NVDA', 'RELIANCE.NS'].map((symbol) => (
                  <Link key={symbol} to={`/app/research/${encodeURIComponent(symbol)}`} className="chip hover:border-white/25 hover:text-white">{symbol}</Link>
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {(recent.data?.quotes ?? recentSymbols.map((symbol) => ({ symbol, price: NaN, change_pct: null, previous_close: NaN }))).slice(0, 6).map((quote) => (
                  <Link key={quote.symbol} to={`/app/research/${encodeURIComponent(quote.symbol)}`} className="flex items-center justify-between rounded px-1.5 py-1.5 text-[10.5px] transition hover:bg-white/[0.03]">
                    <span className="font-mono text-mutedx">{quote.symbol}</span>
                    <span className="flex items-center gap-3">
                      <span className="num text-white">{Number.isFinite(quote.price) ? fmtNumber(quote.price, 2) : '—'}</span>
                      <span className={cn('num w-14 text-right', pctClass(quote.change_pct))}>{fmtPct(quote.change_pct)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Link to="/app/screener" className="chip hover:border-white/25 hover:text-white">Screener</Link>
              <Link to="/app/compare" className="chip hover:border-white/25 hover:text-white">Compare</Link>
              <Link to="/app/data" className="chip hover:border-white/25 hover:text-white">Data studio</Link>
            </div>
          </section>
        </div>
      </div>

      {(data.warnings.length > 0 || overview.isFetching) && (
        <div className="grid gap-3 lg:grid-cols-2">
          <WarningList warnings={data.warnings} title="Data & scope notes" />
          <div className="panel-quiet p-3.5">
            <div className="eyebrow mb-2">Platform integrity</div>
            <div className="grid gap-2 text-[10.5px] text-mutedx sm:grid-cols-2">
              <Link to="/app/reliability" className="flex items-center gap-2 rounded border border-white/[0.06] px-2 py-2 hover:border-white/20"><ShieldCheck className="h-3 w-3 text-cyanx/70" /> Model promotion state</Link>
              <Link to="/app/settings" className="flex items-center gap-2 rounded border border-white/[0.06] px-2 py-2 hover:border-white/20"><Database className="h-3 w-3 text-violet-400" /> Integrations & sessions</Link>
              <Link to="/app/watchlists" className="flex items-center gap-2 rounded border border-white/[0.06] px-2 py-2 hover:border-white/20"><BellRing className="h-3 w-3 text-warn/70" /> Alert delivery state</Link>
              <Link to="/app/paper" className="flex items-center gap-2 rounded border border-white/[0.06] px-2 py-2 hover:border-white/20"><Wallet className="h-3 w-3 text-gain/70" /> Paper ledger</Link>
            </div>
            <div className="mt-2 font-mono text-[8.5px] text-dimx">generated {fmtDateTime(data.generated_at)}</div>
          </div>
        </div>
      )}
    </div>
  )
}
