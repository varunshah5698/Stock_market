import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Download, Gauge, History, ShieldAlert, TriangleAlert } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { AreaTrend, MarketLineChart, MonthlyReturnGrid, SignedBars } from '../components/charts'
import { Badge, Callout, DataStatus, EmptyState, ErrorState, LoadingPanel, Metric, PageHeader, SectionTitle, Spinner, StatusPill, WarningList } from '../components/ui'
import { api } from '../lib/api'
import { cn, fmtDateTime, fmtNumber, fmtPct, pctClass, relativeTime } from '../lib/format'
import { useDocumentTitle } from '../lib/hooks'
import type { BacktestDetail as BacktestDetailType, Trade } from '../lib/types'

function metric(metrics: Record<string, unknown>, key: string): number | null {
  const value = metrics?.[key]
  return typeof value === 'number' ? value : null
}

export default function BacktestDetail() {
  const { id = '' } = useParams()
  useDocumentTitle('Backtest')
  const query = useQuery<BacktestDetailType>({
    queryKey: ['backtest', id],
    queryFn: () => api(`/api/v1/backtests/${id}`),
    refetchInterval: (query) => {
      const data = query.state.data as BacktestDetailType | undefined
      return data && (data.status === 'queued' || data.status === 'running') ? 3000 : false
    },
  })

  const trades = useQuery<{ trades: Trade[]; pagination: { total: number } }>({
    queryKey: ['backtest-trades', id],
    queryFn: () => api(`/api/v1/backtests/${id}/trades?page_size=100`),
    enabled: query.data?.status === 'succeeded',
  })

  if (query.isLoading) {
    return <div className="space-y-5"><PageHeader eyebrow="Backtest report" title="Loading simulation" /><LoadingPanel rows={8} /></div>
  }

  if (query.isError || !query.data) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Backtest report" title="Simulation" />
        <ErrorState message={query.error instanceof Error ? query.error.message : 'Backtest unavailable'} onRetry={() => void query.refetch()} />
        <Link to="/app/strategies?tab=backtests" className="btn btn-outline"><ArrowLeft className="h-3.5 w-3.5" /> Back to backtests</Link>
      </div>
    )
  }

  const data = query.data
  const equity = data.equity
  const metrics = data.metrics as Record<string, unknown>
  const benchmark = (metrics.benchmark ?? {}) as Record<string, unknown>
  const assumptions = (equity.assumptions ?? {}) as Record<string, unknown>
  const dataInfo = (equity.data ?? {}) as Record<string, unknown>
  const warnings = (equity.warnings ?? []) as string[]
  const succeeded = data.status === 'succeeded'
  const totalReturn = metric(metrics, 'total_return')

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<span className="flex items-center gap-2"><Link to="/app/strategies?tab=backtests" className="hover:text-white">Backtests</Link><span>/</span>Report</span>}
        title={`${data.symbol} · ${data.strategy?.name ?? 'Deleted strategy'}`}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusPill status={data.status} />
            <span className="font-mono text-[10px] text-dimx">{data.data_start ?? '—'} → {data.data_end ?? '—'}</span>
            {data.strategy && <Badge tone="violet">v{data.strategy.version}</Badge>}
            {Boolean(dataInfo.data_status) && <DataStatus provider={String(dataInfo.provider ?? '')} status={String(dataInfo.data_status)} compact />}
          </span>
        }
        actions={
          <>
            <a className="btn btn-outline btn-sm" href={`/api/v1/backtests/${data.id}/export.csv`} download>
              <Download className="h-3.5 w-3.5" /> Export equity CSV
            </a>
            <Link to="/app/strategies" className="btn btn-outline btn-sm"><Gauge className="h-3.5 w-3.5" /> Strategy lab</Link>
          </>
        }
      />

      {data.status === 'failed' && (
        <div className="panel p-5">
          <div className="mb-2 flex items-center gap-2 text-[13px] text-loss"><TriangleAlert className="h-4 w-4" /> Simulation failed</div>
          <p className="text-[12px] leading-relaxed text-mutedx">{data.error || 'The engine could not produce a valid simulation.'}</p>
          <Link to="/app/strategies" className="btn btn-outline btn-sm mt-4"><ArrowLeft className="h-3 w-3" /> Adjust the strategy</Link>
        </div>
      )}

      {(data.status === 'queued' || data.status === 'running') && (
        <div className="panel flex items-center gap-3 p-5">
          <Spinner label="" />
          <div>
            <div className="text-[13px] text-white">{data.status === 'queued' ? 'Backtest queued' : 'Running simulation'}</div>
            <div className="mt-0.5 text-[11px] text-mutedx">The engine loads history and executes each signal at the next open. This page refreshes every three seconds.</div>
          </div>
        </div>
      )}

      {succeeded && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="panel p-4">
              <div className="eyebrow mb-1.5">Net total return</div>
              <div className={cn('num text-[26px] leading-none', pctClass(totalReturn))}>{totalReturn !== null ? fmtPct(totalReturn * 100) : '—'}</div>
              <div className="mt-2 font-mono text-[8.5px] text-dimx">after commissions & slippage</div>
            </div>
            <div className="panel p-4">
              <div className="eyebrow mb-1.5">CAGR</div>
              <div className="num text-[26px] leading-none text-white">{metric(metrics, 'cagr') !== null ? fmtPct((metric(metrics, 'cagr') as number) * 100) : '—'}</div>
              <div className="mt-2 font-mono text-[8.5px] text-dimx">annualized geometric return</div>
            </div>
            <div className="panel p-4">
              <div className="eyebrow mb-1.5">Sharpe (rf = 0)</div>
              <div className="num text-[26px] leading-none text-white">{metric(metrics, 'sharpe_rf_zero') !== null ? fmtNumber(metric(metrics, 'sharpe_rf_zero') as number, 2) : '—'}</div>
              <div className="mt-2 font-mono text-[8.5px] text-dimx">daily returns · not a forecast</div>
            </div>
            <div className="panel p-4">
              <div className="eyebrow mb-1.5">Max drawdown</div>
              <div className="num text-[26px] leading-none text-loss">{metric(metrics, 'max_drawdown') !== null ? fmtPct((metric(metrics, 'max_drawdown') as number) * 100) : '—'}</div>
              <div className="mt-2 font-mono text-[8.5px] text-dimx">peak-to-trough, simulated</div>
            </div>
          </div>

          <div className="panel p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="eyebrow mb-1">Equity curve</div>
                <div className="text-[13px] text-white">Strategy vs benchmark</div>
              </div>
              <div className="flex flex-wrap gap-3 font-mono text-[9px] text-dimx">
                <span>final {fmtNumber(metric(metrics, 'final_equity') ?? 0, 2)}</span>
                <span>fees {fmtNumber(metric(metrics, 'total_fees') ?? 0, 2)}</span>
                <span>turnover {fmtNumber(metric(metrics, 'turnover_total') ?? 0, 2)}×</span>
                <span>exposure {fmtNumber(metric(metrics, 'exposure_pct') ?? 0, 1)}%</span>
              </div>
            </div>
            <MarketLineChart
              dates={equity.dates}
              series={[
                { name: 'Strategy', color: '#8b5cf6', values: equity.strategy },
                ...(equity.benchmark ? [{ name: `Benchmark (${String(benchmark.symbol ?? data.benchmark)})`, color: '#22d3ee', values: equity.benchmark, dashed: true }] : []),
              ]}
              height={320}
              valueFormatter={(value) => fmtNumber(value, 0)}
            />
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[8.5px] text-dimx">
              <span>{String(assumptions.execution ?? 'signal at close t, order at open t+1')}</span>
              <span>{String(assumptions.shares ?? '')}</span>
              <span>{String(assumptions.stops ?? '')}</span>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
            <section className="panel p-4">
              <SectionTitle eyebrow="Risk path" title="Drawdown from running peak" />
              {equity.drawdown.length ? (
                <SignedBars dates={equity.dates} values={equity.drawdown.slice(0, equity.dates.length)} height={200} formatter={(value) => `${(value * 100).toFixed(1)}%`} />
              ) : (
                <div className="py-10 text-center text-[11px] text-dimx">Drawdown path unavailable.</div>
              )}
            </section>
            <section className="panel p-4">
              <SectionTitle eyebrow="Trade statistics" title="Completed & open" />
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Closed trades" value={String(metric(metrics, 'closed_trades') ?? 0)} />
                <Metric label="Win rate" value={metric(metrics, 'win_rate') !== null ? `${((metric(metrics, 'win_rate') as number) * 100).toFixed(1)}%` : '—'} />
                <Metric label="Profit factor" value={metric(metrics, 'profit_factor') !== null ? fmtNumber(metric(metrics, 'profit_factor') as number, 2) : '—'} />
                <Metric label="Open at end" value={metrics.open_position ? 'Yes' : 'No'} tone={metrics.open_position ? 'warn' : 'neutral'} />
                <Metric label="Avg win" value={metric(metrics, 'average_win') !== null ? fmtNumber(metric(metrics, 'average_win') as number, 2) : '—'} tone="gain" />
                <Metric label="Avg loss" value={metric(metrics, 'average_loss') !== null ? fmtNumber(metric(metrics, 'average_loss') as number, 2) : '—'} tone="loss" />
              </div>
              <div className="mt-3 rounded border border-white/[0.06] bg-black/20 p-2.5 font-mono text-[8.5px] leading-relaxed text-dimx">
                Annualized volatility {metric(metrics, 'annualized_volatility') !== null ? fmtPct((metric(metrics, 'annualized_volatility') as number) * 100) : '—'} · Sortino {metric(metrics, 'sortino_rf_zero') !== null ? fmtNumber(metric(metrics, 'sortino_rf_zero') as number, 2) : '—'} · drawdown duration {String(metric(metrics, 'drawdown_duration_days') ?? '—')} sessions
              </div>
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <section className="panel p-4">
              <SectionTitle eyebrow="Consistency" title="Monthly returns" />
              {equity.monthly_returns?.length ? <MonthlyReturnGrid data={equity.monthly_returns} /> : <div className="py-8 text-center text-[11px] text-dimx">Not enough months for a monthly view.</div>}
              <div className="mt-2 font-mono text-[8.5px] text-dimx">Monthly returns from the simulated equity curve, net of modeled costs. Individual months can be misleading.</div>
            </section>
            <section className="panel p-4">
              <SectionTitle eyebrow="Benchmark" title={String(benchmark.symbol ?? data.benchmark)} />
              {benchmark.error ? (
                <Callout tone="warn">{String(benchmark.error)}</Callout>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="Benchmark return" value={typeof benchmark.total_return === 'number' ? fmtPct(benchmark.total_return * 100) : '—'} />
                  <Metric label="Excess vs strategy" value={metric(metrics, 'excess_vs_benchmark') !== null ? fmtPct((metric(metrics, 'excess_vs_benchmark') as number) * 100) : '—'} tone={((metric(metrics, 'excess_vs_benchmark') ?? 0) >= 0 ? 'gain' : 'loss')} />
                  <Metric label="Benchmark vol" value={typeof benchmark.annualized_volatility === 'number' ? fmtPct(benchmark.annualized_volatility * 100) : '—'} />
                  <Metric label="Benchmark max DD" value={typeof benchmark.max_drawdown === 'number' ? fmtPct(benchmark.max_drawdown * 100) : '—'} />
                </div>
              )}
              <div className="mt-3 text-[9px] leading-relaxed text-dimx">{String(benchmark.note ?? 'Buy-and-hold comparison uses the same entry cost assumptions where available.')}</div>
            </section>
          </div>

          <section className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
              <div>
                <div className="eyebrow mb-0.5">Transaction log</div>
                <div className="text-[13px] text-white">{trades.data?.pagination.total ?? 0} completed / open trades</div>
              </div>
              <span className="font-mono text-[8.5px] text-dimx">showing first 100</span>
            </div>
            {trades.isLoading ? (
              <div className="p-4"><LoadingPanel rows={4} /></div>
            ) : !trades.data?.trades.length ? (
              <EmptyState title="No trades executed" description="The strategy produced no executable signals with the available capital and rules." icon={<History className="h-5 w-5" />} />
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table min-w-[880px]">
                  <thead><tr><th>Entry</th><th>Exit</th><th className="text-right">Qty</th><th className="text-right">Entry</th><th className="text-right">Exit</th><th className="text-right">Fees</th><th className="text-right">P/L</th><th className="text-right">Return</th><th>Reason</th></tr></thead>
                  <tbody>
                    {trades.data.trades.map((trade, index) => (
                      <tr key={trade.id ?? index}>
                        <td className="font-mono text-[10px] text-mutedx">{trade.entry_date}</td>
                        <td className="font-mono text-[10px] text-mutedx">{trade.exit_date ?? 'open'}</td>
                        <td className="num text-right text-mutedx">{fmtNumber(trade.quantity, 0)}</td>
                        <td className="num text-right text-white">{fmtNumber(trade.entry_price, 2)}</td>
                        <td className="num text-right text-white">{trade.exit_price !== null ? fmtNumber(trade.exit_price, 2) : '—'}</td>
                        <td className="num text-right text-dimx">{fmtNumber(trade.fees, 2)}</td>
                        <td className={cn('num text-right', (trade.pnl ?? 0) >= 0 ? 'text-gain' : 'text-loss')}>{trade.pnl !== null ? fmtNumber(trade.pnl, 2) : '—'}</td>
                        <td className={cn('num text-right', pctClass(trade.return_pct))}>{fmtPct(trade.return_pct)}</td>
                        <td><Badge tone={trade.exit_reason === 'open_at_end' ? 'warn' : trade.exit_reason === 'stop_loss' ? 'loss' : 'neutral'}>{trade.exit_reason.replace(/_/g, ' ')}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="panel p-4">
              <SectionTitle eyebrow="Assumptions" title="Exactly what the simulator did" />
              <dl className="space-y-2 text-[10.5px]">
                {Object.entries({
                  Execution: assumptions.execution,
                  Commission: `${assumptions.commission_bps} bps`,
                  Slippage: `${assumptions.slippage_bps} bps`,
                  Spread: `${assumptions.spread_bps} bps`,
                  'Position sizing': `${assumptions.position_size_pct}% of cash`,
                  Shares: assumptions.shares,
                  Stops: assumptions.stops,
                  'Risk-free rate': assumptions.risk_free_rate,
                  'Price basis': String(dataInfo.price_basis ?? '—'),
                }).map(([label, value]) => (
                  <div key={label} className="flex flex-col justify-between gap-0.5 border-b border-white/[0.04] pb-2 last:border-0 sm:flex-row sm:gap-4">
                    <dt className="shrink-0 text-dimx">{label}</dt>
                    <dd className="text-right text-mutedx">{String(value ?? '—')}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="panel p-4">
              <SectionTitle eyebrow="Strategy definition" title="Versioned rules" />
              {data.strategy ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone="violet">v{data.strategy.version}</Badge>
                    <Badge>{data.strategy.rules.entry_logic} entry</Badge>
                    <Badge>{data.strategy.rules.exit_logic} exit</Badge>
                    {data.strategy.rules.stop_loss_pct && <Badge tone="loss">stop {data.strategy.rules.stop_loss_pct}%</Badge>}
                  </div>
                  <div className="space-y-1.5 font-mono text-[9.5px] leading-relaxed text-mutedx">
                    {data.strategy.rules.entry.map((rule, index) => (
                      <div key={`entry-${index}`}><span className="text-gain">ENTRY</span> {rule.indicator}({rule.params.window ?? '—'}) {rule.op} {rule.value}</div>
                    ))}
                    {data.strategy.rules.exit.map((rule, index) => (
                      <div key={`exit-${index}`}><span className="text-loss">EXIT</span> {rule.indicator}({rule.params.window ?? '—'}) {rule.op} {rule.value}</div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-dimx">The strategy was deleted; the stored report remains.</div>
              )}
            </section>
          </div>

          <section className="flex flex-col gap-3">
            <WarningList warnings={warnings} title="Report warnings" />
            <Callout tone="warn" title="What this report is not">
              {data.disclaimer} The simulation uses adjusted prices, integer shares, long-only exposure and modeled costs. It does not
              establish that the strategy can be executed at these prices in live markets, and no order is routed anywhere.
            </Callout>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[8.5px] text-dimx">
              <span>run {data.id}</span>
              <span>created {fmtDateTime(data.created_at)}</span>
              <span>finished {data.finished_at ? fmtDateTime(data.finished_at) : '—'}</span>
              <span>{relativeTime(data.finished_at)}</span>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
