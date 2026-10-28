import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRight,
  Layers,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  Wallet,
} from 'lucide-react'
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CorrelationHeatmap, Donut, SimpleBars } from '../components/charts'
import { Badge, Button, Callout, EmptyState, ErrorState, Field, Input, LoadingPanel, Metric, Modal, PageHeader, SectionTitle, WarningList } from '../components/ui'
import { api, del, errorMessage, post } from '../lib/api'
import { cn, fmtMoney, fmtNumber, fmtPct, pctClass } from '../lib/format'
import { useDocumentTitle } from '../lib/hooks'
import { useToasts } from '../store/ui'
import type { PortfolioDetail, PortfolioSummary, RiskBlock } from '../lib/types'

// Three.js stays out of the initial bundle.
const Terrain3D = lazy(() =>
  import('../components/Market3D').then((module) => ({ default: module.RiskTerrain3D })),
)

interface ScenarioResult extends RiskBlock {
  scenario_weights: Record<string, number>
  disclaimer: string
}

const ALLOCATION_COLORS = ['#8b5cf6', '#22d3ee', '#34e0a1', '#fbbf24', '#ff6b8a', '#60a5fa', '#c084fc', '#2dd4bf']

export default function Portfolios() {
  useDocumentTitle('Portfolios')
  const queryClient = useQueryClient()
  const toast = useToasts((state) => state.push)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [positionOpen, setPositionOpen] = useState(false)
  const [name, setName] = useState('Core portfolio')
  const [currency, setCurrency] = useState('USD')
  const [symbol, setSymbol] = useState('AAPL')
  const [quantity, setQuantity] = useState('10')
  const [avgCost, setAvgCost] = useState('100')
  const [notes, setNotes] = useState('')
  const [benchmark, setBenchmark] = useState('SPY')
  const [benchmarkDraft, setBenchmarkDraft] = useState('SPY')
  const [weights, setWeights] = useState<Record<string, number>>({})
  const [scenario, setScenario] = useState<ScenarioResult | null>(null)

  const portfolios = useQuery<{ portfolios: PortfolioSummary[] }>({
    queryKey: ['portfolios'],
    queryFn: () => api('/api/v1/portfolios'),
  })

  useEffect(() => {
    if (!selectedId && portfolios.data?.portfolios.length) setSelectedId(portfolios.data.portfolios[0].id)
  }, [portfolios.data, selectedId])

  const detail = useQuery<PortfolioDetail>({
    queryKey: ['portfolio', selectedId, benchmark],
    queryFn: () => api(`/api/v1/portfolios/${selectedId}?benchmark=${encodeURIComponent(benchmark)}`),
    enabled: Boolean(selectedId),
  })

  useEffect(() => {
    if (!detail.data) return
    const total = detail.data.positions.reduce((sum, position) => sum + position.market_value, 0)
    const next: Record<string, number> = {}
    for (const position of detail.data.positions) {
      next[position.symbol] = total ? Math.round((position.market_value / total) * 1000) / 10 : 0
    }
    setWeights(next)
    setScenario(null)
  }, [detail.data?.portfolio.id, detail.data?.positions.length])

  const createPortfolio = useMutation({
    mutationFn: () => post<{ id: string }>('/api/v1/portfolios', { name, base_currency: currency }),
    onSuccess: (data) => {
      toast('Portfolio created', 'success')
      setCreateOpen(false)
      setSelectedId(data.id)
      void queryClient.invalidateQueries({ queryKey: ['portfolios'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const addPosition = useMutation({
    mutationFn: () =>
      post(`/api/v1/portfolios/${selectedId}/positions`, {
        symbol: symbol.toUpperCase(),
        quantity: Number(quantity),
        avg_cost: Number(avgCost),
        notes,
      }),
    onSuccess: () => {
      toast('Position saved', 'success')
      setPositionOpen(false)
      setNotes('')
      void queryClient.invalidateQueries({ queryKey: ['portfolio', selectedId] })
      void queryClient.invalidateQueries({ queryKey: ['portfolios'] })
      void queryClient.invalidateQueries({ queryKey: ['overview'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const removePosition = useMutation({
    mutationFn: (positionId: number) => del(`/api/v1/portfolios/${selectedId}/positions/${positionId}`),
    onSuccess: () => {
      toast('Position removed', 'success')
      void queryClient.invalidateQueries({ queryKey: ['portfolio', selectedId] })
      void queryClient.invalidateQueries({ queryKey: ['portfolios'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const deletePortfolio = useMutation({
    mutationFn: () => del(`/api/v1/portfolios/${selectedId}`),
    onSuccess: () => {
      toast('Portfolio deleted', 'success')
      setSelectedId(null)
      void queryClient.invalidateQueries({ queryKey: ['portfolios'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const runScenario = useMutation({
    mutationFn: () => post<ScenarioResult>(`/api/v1/portfolios/${selectedId}/scenario`, { weights }),
    onSuccess: (result) => {
      setScenario(result)
      toast('Hypothetical allocation evaluated', 'success')
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const allocation = useMemo(
    () =>
      (detail.data?.allocation ?? []).map((item, index) => ({
        name: item.symbol,
        value: Math.max(0, item.weight_pct ?? 0) / 100,
        color: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length],
      })),
    [detail.data],
  )

  const risk = detail.data?.risk
  const weightsTotal = Object.values(weights).reduce((sum, weight) => sum + weight, 0)

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Portfolio intelligence"
        title="Portfolio lab"
        description="Manual holdings valued at delayed/end-of-day prices. This is an estimate, never a broker-confirmed balance."
        actions={
          <>
            <div className="flex items-center gap-1.5">
              <Input
                className="h-8 w-20 font-mono text-[10px]"
                value={benchmarkDraft}
                onChange={(event) => setBenchmarkDraft(event.target.value.toUpperCase())}
                aria-label="Benchmark"
              />
              <Button size="sm" variant="outline" onClick={() => setBenchmark(benchmarkDraft || 'SPY')}>Benchmark</Button>
            </div>
            <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)} icon={<Plus className="h-3.5 w-3.5" />}>New portfolio</Button>
          </>
        }
      />

      {portfolios.isLoading ? (
        <LoadingPanel rows={6} />
      ) : portfolios.isError ? (
        <ErrorState message={portfolios.error instanceof Error ? portfolios.error.message : 'Portfolios unavailable'} onRetry={() => void portfolios.refetch()} />
      ) : !portfolios.data?.portfolios.length ? (
        <div className="panel">
          <EmptyState
            title="No portfolios yet"
            description="Create a portfolio and add manual holdings. Cost basis, exposure and risk contribution require position data."
            icon={<Wallet className="h-5 w-5" />}
            action={<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>Create portfolio</Button>}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] pb-3">
            {portfolios.data.portfolios.map((portfolio) => (
              <button
                key={portfolio.id}
                onClick={() => setSelectedId(portfolio.id)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-left text-[11px] transition',
                  selectedId === portfolio.id ? 'border-violet-400/30 bg-violet-500/[0.08] text-white' : 'border-white/[0.06] text-mutedx hover:border-white/15 hover:text-white',
                )}
              >
                <span className="block">{portfolio.name}</span>
                <span className="font-mono text-[8px] text-dimx">{portfolio.positions} position{portfolio.positions === 1 ? '' : 's'} · {portfolio.base_currency}</span>
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1.5">
              <button className="btn btn-ghost btn-sm" onClick={() => void detail.refetch()} disabled={detail.isFetching}><RefreshCw className={cn('h-3.5 w-3.5', detail.isFetching && 'animate-spin')} /> Refresh</button>
              <button
                className="btn btn-ghost btn-sm text-dimx hover:text-loss"
                onClick={() => {
                  if (window.confirm('Delete this portfolio and its manual positions? This cannot be undone.')) deletePortfolio.mutate()
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
          </div>

          {detail.isLoading ? (
            <LoadingPanel rows={8} />
          ) : detail.isError ? (
            <ErrorState message={detail.error instanceof Error ? detail.error.message : 'Portfolio unavailable'} onRetry={() => void detail.refetch()} />
          ) : !detail.data ? null : (
            <>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <div className="panel p-4">
                  <div className="eyebrow mb-1.5">Estimated market value</div>
                  <div className="num text-[25px] leading-none text-white">{fmtMoney(detail.data.summary.market_value, detail.data.portfolio.base_currency)}</div>
                  <div className="mt-2 font-mono text-[8.5px] text-dimx">delayed/end-of-day estimate</div>
                </div>
                <div className="panel p-4">
                  <div className="eyebrow mb-1.5">Unrealized P/L</div>
                  <div className={cn('num text-[25px] leading-none', pctClass(detail.data.summary.unrealized_pnl))}>{fmtMoney(detail.data.summary.unrealized_pnl, detail.data.portfolio.base_currency)}</div>
                  <div className="mt-2 font-mono text-[8.5px] text-dimx">{detail.data.summary.unrealized_pct !== null ? fmtPct(detail.data.summary.unrealized_pct) : '—'} vs manual cost basis</div>
                </div>
                <div className="panel p-4">
                  <div className="eyebrow mb-1.5">Concentration</div>
                  <div className="num text-[25px] leading-none text-white">{fmtNumber(detail.data.summary.concentration_hhi, 3)}</div>
                  <div className="mt-2 font-mono text-[8.5px] text-dimx">HHI · top weight {fmtNumber(detail.data.summary.top_weight_pct, 1)}%</div>
                </div>
                <div className="panel p-4">
                  <div className="eyebrow mb-1.5">Historical volatility</div>
                  <div className="num text-[25px] leading-none text-white">{risk?.available && risk.annualized_volatility !== undefined ? fmtPct(risk.annualized_volatility * 100, 2, false) : '—'}</div>
                  <div className="mt-2 font-mono text-[8.5px] text-dimx">{risk?.available ? `${risk.observations} aligned observations` : risk?.reason ?? 'Risk unavailable'}</div>
                </div>
              </div>

              {detail.data.warnings.length > 0 && <WarningList warnings={detail.data.warnings} title="Valuation notes" />}

              <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
                <section className="panel overflow-hidden">
                  <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                    <div>
                      <div className="eyebrow mb-0.5">Holdings</div>
                      <div className="text-[13px] text-white">Positions & manual cost basis</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setPositionOpen(true)} icon={<Plus className="h-3 w-3" />}>Add position</Button>
                  </div>
                  {detail.data.positions.length === 0 ? (
                    <EmptyState title="No positions" description="Add manual holdings to value the portfolio and estimate risk." action={<Button size="sm" variant="outline" onClick={() => setPositionOpen(true)}>Add position</Button>} />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="data-table min-w-[760px]">
                        <thead><tr><th>Symbol</th><th className="text-right">Qty</th><th className="text-right">Avg cost</th><th className="text-right">Price</th><th className="text-right">Value</th><th className="text-right">P/L</th><th className="text-right">Weight</th><th /></tr></thead>
                        <tbody>
                          {detail.data.positions.map((position) => (
                            <tr key={position.id}>
                              <td><Link to={`/app/research/${encodeURIComponent(position.symbol)}`} className="font-mono text-[11px] text-white hover:text-violet-300">{position.symbol}</Link><div className="font-mono text-[8px] text-dimx">{position.as_of} · {position.currency}</div></td>
                              <td className="num text-right text-mutedx">{fmtNumber(position.quantity, 2)}</td>
                              <td className="num text-right text-mutedx">{fmtNumber(position.avg_cost, 2)}</td>
                              <td className="num text-right text-white">{fmtNumber(position.price, 2)}</td>
                              <td className="num text-right text-white">{fmtMoney(position.market_value, position.currency)}</td>
                              <td className={cn('num text-right', pctClass(position.unrealized_pnl))}>{fmtMoney(position.unrealized_pnl, position.currency)}</td>
                              <td className="num text-right text-mutedx">{position.weight_pct !== null ? `${position.weight_pct.toFixed(1)}%` : '—'}</td>
                              <td className="text-right">
                                <button
                                  className="rounded p-1 text-dimx hover:bg-white/5 hover:text-loss"
                                  onClick={() => {
                                    if (window.confirm(`Remove ${position.symbol} from the portfolio? This does not compute realized P/L.`)) removePosition.mutate(position.id)
                                  }}
                                  aria-label={`Remove ${position.symbol}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.05] px-4 py-2 text-[9px] text-dimx">
                    <span>{detail.data.summary.valuation_source ?? 'Delayed valuation estimate.'}</span>
                    <span>currencies: {(detail.data.summary.currencies ?? []).join(', ') || '—'}</span>
                  </div>
                </section>

                <div className="space-y-4">
                  <section className="panel p-4">
                    <SectionTitle eyebrow="Allocation" title="By holding" />
                    {allocation.length ? (
                      <>
                        <Donut data={allocation} height={190} centerLabel="market value" centerValue={fmtMoney(detail.data.summary.market_value, detail.data.portfolio.base_currency, { compact: true })} />
                        <div className="mt-2 space-y-1.5">
                          {detail.data.positions.map((position, index) => (
                            <div key={position.symbol} className="flex items-center justify-between text-[10px]">
                              <span className="flex items-center gap-2 text-mutedx"><span className="h-1.5 w-1.5 rounded-sm" style={{ background: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length] }} />{position.symbol}</span>
                              <span className="num text-white">{position.weight_pct !== null ? `${position.weight_pct.toFixed(1)}%` : '—'}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="py-8 text-center text-[11px] text-dimx">No allocation to display.</div>
                    )}
                  </section>

                  <section className="panel p-4">
                    <SectionTitle eyebrow="Risk" title="Contribution to variance" />
                    {risk?.available && risk.risk_contribution?.length ? (
                      <>
                        <div className="space-y-2">
                          {risk.risk_contribution.map((item) => (
                            <div key={item.symbol}>
                              <div className="mb-1 flex justify-between font-mono text-[9px]">
                                <span className="text-mutedx">{item.symbol}</span>
                                <span className="text-white">{item.variance_contribution_pct.toFixed(1)}%</span>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                                <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyanx/70" style={{ width: `${Math.max(0, item.variance_contribution_pct)}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <Metric label="Max drawdown" value={risk.max_drawdown !== undefined ? fmtPct(risk.max_drawdown * 100) : '—'} />
                          <Metric label="Cumulative" value={risk.cumulative_return !== undefined ? fmtPct(risk.cumulative_return * 100) : '—'} />
                        </div>
                        <Suspense
                          fallback={<div className="mt-3 py-16 text-center font-mono text-[9px] text-dimx">Loading 3D terrain…</div>}
                        >
                          <div className="mt-3 overflow-hidden rounded-lg border border-white/[0.06]">
                            <Terrain3D items={risk.risk_contribution} height={260} />
                          </div>
                        </Suspense>
                        <div className="mt-1 font-mono text-[8px] leading-relaxed text-dimx">
                          Bar height is the position&apos;s share of portfolio variance; colour reflects its weight. Same numbers as the bars above — drag to orbit.
                        </div>
                        {risk.benchmark && (
                          <div className="mt-3 rounded border border-white/[0.06] bg-black/20 p-2.5 font-mono text-[8.5px] text-dimx">
                            benchmark {detail.data.portfolio.base_currency === 'INR' ? '^NSEI' : benchmark}: {fmtPct(risk.benchmark.benchmark_return * 100)} vs portfolio {fmtPct(risk.benchmark.cumulative_return * 100)} · beta {risk.benchmark.beta?.toFixed(2) ?? '—'}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-[10.5px] leading-relaxed text-dimx">{risk?.reason ?? 'Risk metrics need at least 60 aligned daily observations.'}</div>
                    )}
                  </section>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <section className="panel p-4">
                  <SectionTitle eyebrow="Dependence" title="Correlation matrix" />
                  {risk?.available && risk.correlation ? (
                    <CorrelationHeatmap symbols={risk.correlation.symbols} matrix={risk.correlation.matrix} />
                  ) : (
                    <div className="py-8 text-center text-[11px] text-dimx">Correlation needs overlapping price history for at least two holdings.</div>
                  )}
                  <div className="mt-2 text-[9px] leading-relaxed text-dimx">Correlations are estimated from aligned adjusted closes over the last year and can change abruptly.</div>
                </section>

                <section className="panel p-4">
                  <SectionTitle eyebrow="Scenario" title="Hypothetical re-weighting" action={scenario && <Badge tone="violet">applied</Badge>} />
                  {detail.data.positions.length === 0 ? (
                    <div className="text-[11px] text-dimx">Add positions to run a scenario.</div>
                  ) : (
                    <>
                      <div className="space-y-3">
                        {detail.data.positions.map((position) => (
                          <div key={position.symbol}>
                            <div className="mb-1 flex items-center justify-between font-mono text-[9.5px]">
                              <span className="text-mutedx">{position.symbol}</span>
                              <span className="text-white">{weights[position.symbol]?.toFixed(1) ?? '0'}%</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              step="0.5"
                              value={weights[position.symbol] ?? 0}
                              onChange={(event) => setWeights({ ...weights, [position.symbol]: Number(event.target.value) })}
                              className="w-full accent-violet-500"
                              aria-label={`${position.symbol} hypothetical weight`}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 flex items-center justify-between font-mono text-[9px]">
                        <span className={weightsTotal > 100 ? 'text-warn' : 'text-dimx'}>total {weightsTotal.toFixed(1)}% (server normalizes)</span>
                        <Button size="sm" variant="outline" loading={runScenario.isPending} onClick={() => runScenario.mutate()} icon={<SlidersHorizontal className="h-3 w-3" />}>Evaluate</Button>
                      </div>
                      {scenario && (
                        <div className="mt-3 rounded-lg border border-white/[0.07] bg-black/25 p-3">
                          <div className="grid grid-cols-2 gap-3">
                            <Metric label="Scenario vol" value={scenario.annualized_volatility !== undefined ? fmtPct(scenario.annualized_volatility * 100, 2, false) : '—'} />
                            <Metric label="Scenario max DD" value={scenario.max_drawdown !== undefined ? fmtPct(scenario.max_drawdown * 100) : '—'} />
                          </div>
                          <div className="mt-1.5 text-[8.5px] leading-relaxed text-dimx">{scenario.disclaimer}</div>
                        </div>
                      )}
                    </>
                  )}
                  <div className="mt-3 border-t border-white/[0.06] pt-2">
                    <Link to={`/app/compare?symbols=${detail.data.positions.slice(0, 4).map((item) => item.symbol).join(',')}`} className="text-[10px] text-violet-400 hover:text-white">Open these instruments in the correlation lab <ArrowUpRight className="inline h-3 w-3" /></Link>
                  </div>
                </section>
              </div>

              <Callout tone="warn" title="Valuation boundary">
                Positions are manual records. Prices are delayed/end-of-day snapshots. Removing a position records a manual removal at cost and does not calculate realized P/L. This is not a brokerage statement.
              </Callout>
            </>
          )}
        </>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create portfolio"
        description="A manual research portfolio. No broker connection is created."
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setCreateOpen(false)}>Cancel</button>
            <Button variant="primary" loading={createPortfolio.isPending} disabled={!name.trim()} onClick={() => createPortfolio.mutate()}>Create</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name"><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></Field>
          <Field label="Base currency"><Input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={8} className="font-mono" /></Field>
        </div>
      </Modal>

      <Modal
        open={positionOpen}
        onClose={() => setPositionOpen(false)}
        title="Add manual position"
        description="Quantity and acquisition price are user supplied. If the symbol already exists, the position is merged at a weighted average cost."
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setPositionOpen(false)}>Cancel</button>
            <Button variant="primary" loading={addPosition.isPending} disabled={!symbol || Number(quantity) <= 0 || Number(avgCost) <= 0} onClick={() => addPosition.mutate()}>Save position</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Symbol"><Input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} className="font-mono" /></Field>
          <Field label="Quantity"><Input type="number" min="0.000001" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field>
          <Field label="Average acquisition price"><Input type="number" min="0.0001" step="any" value={avgCost} onChange={(event) => setAvgCost(event.target.value)} /></Field>
          <Field label="Notes (optional)"><Input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} /></Field>
        </div>
      </Modal>
    </div>
  )
}
