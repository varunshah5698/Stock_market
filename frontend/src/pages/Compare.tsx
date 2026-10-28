import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Download, Info, Layers, Plus, RefreshCw, X } from 'lucide-react'
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CorrelationHeatmap, MarketLineChart, RiskScatter, SimpleBars } from '../components/charts'
import { DataStatus, EmptyState, ErrorState, LoadingPanel, PageHeader, SectionTitle, WarningList } from '../components/ui'
import { api } from '../lib/api'
import { cn, fmtNumber, fmtPct, pctClass } from '../lib/format'
import { useDocumentTitle } from '../lib/hooks'
import type { InstrumentSummary } from '../lib/types'

// Three.js stays out of the initial bundle.
const Globe3D = lazy(() =>
  import('../components/Market3D').then((module) => ({ default: module.CorrelationGlobe3D })),
)

interface ComparePayload {
  symbols: string[]
  period: string
  observations: number
  window: { start: string; end: string }
  normalized: { dates: string[]; series: Record<string, (number | null)[]> }
  summary: { symbol: string; cumulative_return_pct: number; annualized_volatility_pct: number; max_drawdown_pct: number; data_status: string }[]
  correlation: { symbols: string[]; matrix: number[][] }
  rolling_correlation: { pair: string[]; window: number; dates: string[]; values: (number | null)[] } | null
  benchmark?: { symbol: string; cumulative_return_pct: number; beta: Record<string, number> }
  failed: { symbol: string; error: string }[]
  warnings: string[]
}

const COLORS = ['#8b5cf6', '#22d3ee', '#34e0a1', '#fbbf24', '#ff6b8a', '#60a5fa']
const PERIODS = ['6mo', '1y', '2y', '3y', '5y']

export default function Compare() {
  useDocumentTitle('Compare')
  const [params, setParams] = useSearchParams()
  const initial = params.get('symbols') ?? 'AAPL,MSFT,NVDA'
  const [symbols, setSymbols] = useState(initial)
  const [input, setInput] = useState('')
  const [period, setPeriod] = useState(params.get('period') ?? '1y')
  const [benchmark, setBenchmark] = useState('SPY')
  const [suggestions, setSuggestions] = useState<InstrumentSummary[]>([])
  const [benchmarkMode, setBenchmarkMode] = useState(true)

  useEffect(() => {
    if (params.get('symbols')) setSymbols(params.get('symbols') ?? '')
  }, [params])

  const query = useQuery<ComparePayload>({
    queryKey: ['compare', symbols, period, benchmarkMode ? benchmark : ''],
    queryFn: () =>
      api(`/api/v1/compare?symbols=${encodeURIComponent(symbols)}&period=${period}${benchmarkMode ? `&benchmark=${encodeURIComponent(benchmark)}` : ''}`),
    enabled: symbols.split(',').filter(Boolean).length >= 2,
    staleTime: 120_000,
  })

  const addSymbol = async (raw: string) => {
    const value = raw.trim().toUpperCase()
    if (!value) return
    const current = symbols.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean)
    if (current.includes(value)) return
    if (current.length >= 6) return
    const next = [...current, value].join(',')
    setSymbols(next)
    setInput('')
    setSuggestions([])
    params.set('symbols', next)
    setParams(params, { replace: true })
  }

  const removeSymbol = (symbol: string) => {
    const next = symbols.split(',').map((item) => item.trim().toUpperCase()).filter((item) => item && item !== symbol).join(',')
    setSymbols(next)
    params.set('symbols', next)
    setParams(params, { replace: true })
  }

  const onSearch = async (value: string) => {
    setInput(value.toUpperCase())
    if (value.trim().length < 1) {
      setSuggestions([])
      return
    }
    try {
      const result = await api<{ results: InstrumentSummary[] }>(`/api/v1/instruments/search?q=${encodeURIComponent(value)}&limit=5`)
      setSuggestions(result.results)
    } catch {
      setSuggestions([])
    }
  }

  const chartSeries = useMemo(() => {
    if (!query.data) return []
    return query.data.symbols.slice(0, 6).map((symbol, index) => ({
      name: symbol,
      color: COLORS[index % COLORS.length],
      values: query.data!.normalized.series[symbol],
    }))
  }, [query.data])

  const scatter = useMemo(
    () => (query.data?.summary ?? []).map((row, index) => ({ label: row.symbol, x: row.annualized_volatility_pct, y: row.cumulative_return_pct, color: COLORS[index % COLORS.length] })),
    [query.data],
  )

  const exportCsv = () => {
    if (!query.data) return
    const rows = query.data.summary.map((row) => [row.symbol, row.cumulative_return_pct, row.annualized_volatility_pct, row.max_drawdown_pct].join(','))
    const blob = new Blob([`symbol,cumulative_return_pct,annualized_volatility_pct,max_drawdown_pct\n${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `stockpulse-compare-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Multi-asset comparison"
        title="Correlation lab"
        description="Aligned adjusted closes only. Correlation is historical, unstable, and never evidence of causation."
        actions={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw className={cn('h-3.5 w-3.5', query.isFetching && 'animate-spin')} /> Refresh</button>
            <button className="btn btn-outline btn-sm" onClick={exportCsv} disabled={!query.data}><Download className="h-3.5 w-3.5" /> Export summary</button>
          </>
        }
      />

      <section className="panel p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto_auto] lg:items-end">
          <div>
            <label className="label" htmlFor="compare-symbol">Instruments (2–6)</label>
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2 py-1.5">
              {symbols.split(',').filter(Boolean).map((symbol) => (
                <span key={symbol} className="flex items-center gap-1 rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-white">
                  {symbol}
                  <button onClick={() => removeSymbol(symbol)} className="text-dimx hover:text-loss" aria-label={`Remove ${symbol}`}><X className="h-2.5 w-2.5" /></button>
                </span>
              ))}
              <input
                id="compare-symbol"
                className="min-w-[100px] flex-1 bg-transparent py-0.5 text-[11px] text-white outline-none placeholder:text-dimx"
                placeholder="Add symbol…"
                value={input}
                onChange={(event) => void onSearch(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void addSymbol(input)}
              />
              <button onClick={() => void addSymbol(input)} disabled={!input.trim() || symbols.split(',').filter(Boolean).length >= 6} className="rounded p-1 text-dimx hover:text-violet-300 disabled:opacity-30" aria-label="Add symbol"><Plus className="h-3.5 w-3.5" /></button>
            </div>
            {suggestions.length > 0 && input && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-ink-850 p-1">
                {suggestions.map((item) => (
                  <button key={item.symbol} onClick={() => void addSymbol(item.symbol)} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[10.5px] hover:bg-white/[0.05]">
                    <span className="font-mono text-white">{item.symbol}</span>
                    <span className="truncate pl-3 text-[9.5px] text-dimx">{item.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="label" htmlFor="compare-period">Window</label>
            <select id="compare-period" className="select h-[34px] py-1" value={period} onChange={(event) => setPeriod(event.target.value)}>
              {PERIODS.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="compare-benchmark">Benchmark</label>
            <div className="flex items-center gap-2">
              <select id="compare-benchmark" className="select h-[34px] w-24 py-1" value={benchmark} onChange={(event) => setBenchmark(event.target.value)} disabled={!benchmarkMode}>
                <option value="SPY">SPY</option>
                <option value="^GSPC">S&amp;P 500</option>
                <option value="^NSEI">Nifty 50</option>
              </select>
              <button onClick={() => setBenchmarkMode((mode) => !mode)} className={cn('chip', benchmarkMode ? 'chip-cyan' : '')}>{benchmarkMode ? 'on' : 'off'}</button>
            </div>
          </div>
          <Link to="/app/screener" className="btn btn-outline btn-sm">Find symbols <ArrowUpRight className="h-3 w-3" /></Link>
        </div>
      </section>

      {query.isLoading ? (
        <LoadingPanel rows={6} />
      ) : query.isError ? (
        <ErrorState message={query.error instanceof Error ? query.error.message : 'Comparison unavailable'} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <div className="panel"><EmptyState title="Select at least two instruments" description="Add tickers above. Overlapping history is required." /></div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-[11px] text-mutedx">{query.data.observations} aligned observations · {query.data.window.start} → {query.data.window.end}</span>
            <DataStatus provider={query.data.summary[0]?.data_status === 'simulated' ? 'sample' : 'yahoo'} status={query.data.summary[0]?.data_status} compact />
            {query.data.failed.length > 0 && <span className="chip chip-warn">{query.data.failed.length} failed</span>}
          </div>

          <section className="panel p-4">
            <SectionTitle eyebrow="Normalized performance" title="Growth of 100" action={<span className="font-mono text-[8.5px] text-dimx">same start date</span>} />
            <MarketLineChart dates={query.data.normalized.dates} series={chartSeries} height={320} valueFormatter={(value) => value.toFixed(0)} reference={100} />
          </section>

          <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
            <section className="panel overflow-hidden">
              <div className="border-b border-white/[0.06] px-4 py-3">
                <div className="eyebrow mb-1">Performance & risk</div>
                <div className="text-[13px] text-white">Aligned-window summary</div>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Symbol</th><th className="text-right">Cumulative</th><th className="text-right">Ann. vol</th><th className="text-right">Max DD</th><th className="text-right">Beta</th><th /></tr></thead>
                  <tbody>
                    {query.data.summary.map((row) => (
                      <tr key={row.symbol}>
                        <td><Link to={`/app/research/${encodeURIComponent(row.symbol)}`} className="font-mono text-[11px] text-white hover:text-violet-300">{row.symbol}</Link></td>
                        <td className={cn('num text-right', pctClass(row.cumulative_return_pct))}>{fmtPct(row.cumulative_return_pct)}</td>
                        <td className="num text-right text-mutedx">{fmtNumber(row.annualized_volatility_pct, 2)}%</td>
                        <td className="num text-right text-loss">{fmtPct(row.max_drawdown_pct)}</td>
                        <td className="num text-right text-mutedx">{query.data.benchmark?.beta?.[row.symbol]?.toFixed(2) ?? '—'}</td>
                        <td className="text-right"><Link to={`/app/research/${encodeURIComponent(row.symbol)}`} className="text-dimx hover:text-white" aria-label={`Open ${row.symbol}`}><ArrowUpRight className="h-3 w-3" /></Link></td>
                      </tr>
                    ))}
                    {query.data.benchmark && (
                      <tr>
                        <td className="font-mono text-[10.5px] text-cyanx">{query.data.benchmark.symbol}</td>
                        <td className={cn('num text-right', pctClass(query.data.benchmark.cumulative_return_pct))}>{fmtPct(query.data.benchmark.cumulative_return_pct)}</td>
                        <td className="text-right text-dimx">—</td>
                        <td className="text-right text-dimx">—</td>
                        <td className="text-right text-dimx">1.00</td>
                        <td />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-white/[0.05] px-4 py-2 text-[9px] text-dimx">Beta is estimated against the selected benchmark over the aligned window. Cumulative returns exclude transaction costs.</div>
            </section>

            <section className="panel p-4">
              <SectionTitle eyebrow="Risk / return" title="Volatility vs return" />
              <RiskScatter points={scatter} height={260} />
              <div className="mt-1 font-mono text-[8.5px] text-dimx">Annualized historical volatility vs cumulative return. No risk-free adjustment.</div>
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <section className="panel p-4">
              <SectionTitle eyebrow="Dependence" title={`Correlation matrix · daily returns`} />
              <CorrelationHeatmap symbols={query.data.correlation.symbols} matrix={query.data.correlation.matrix} />
            </section>
            <section className="panel overflow-hidden">
              <div className="border-b border-white/[0.06] px-4 pb-3 pt-4">
                <SectionTitle eyebrow="Dependence · 3D" title="Correlation globe" />
              </div>
              <Suspense
                fallback={<div className="px-4 py-14 text-center font-mono text-[10px] text-dimx">Loading 3D globe…</div>}
              >
                <Globe3D symbols={query.data.correlation.symbols} matrix={query.data.correlation.matrix} height={320} />
              </Suspense>
              <div className="border-t border-white/[0.05] px-4 py-2 font-mono text-[8.5px] leading-relaxed text-dimx">
                Spheres are instruments; each edge is the pairwise daily-return correlation above. Red = positive (moves together,
                concentrates risk), cyan = negative. Thickness is |correlation|. Drag to orbit.
              </div>
            </section>
            <section className="panel p-4">
              <SectionTitle eyebrow="Stability" title={query.data.rolling_correlation ? `${query.data.rolling_correlation.pair.join(' / ')} · 30d` : 'Rolling correlation'} />
              {query.data.rolling_correlation ? (
                <MarketLineChart
                  dates={query.data.rolling_correlation.dates}
                  series={[{ name: '30d rolling correlation', color: '#22d3ee', values: query.data.rolling_correlation.values }]}
                  height={230}
                  reference={0}
                  yDomain={[-1, 1]}
                  valueFormatter={(value) => value.toFixed(2)}
                />
              ) : (
                <div className="py-12 text-center text-[11px] text-dimx">Not enough observations for a rolling estimate.</div>
              )}
              <div className="mt-1 flex items-start gap-1.5 font-mono text-[8.5px] leading-relaxed text-dimx">
                <Info className="mt-0.5 h-3 w-3 shrink-0" /> Correlation regime changes are common; a single stable number is a misleading summary.
              </div>
            </section>
          </div>

          <div className="grid gap-3">
            <WarningList warnings={query.data.warnings} title="Method notes" />
            {query.data.failed.length > 0 && (
              <div className="panel-quiet p-3">
                <div className="eyebrow mb-2 text-warn/80">Failed symbols</div>
                {query.data.failed.map((item) => <div key={item.symbol} className="text-[10.5px] text-mutedx">{item.symbol}: {item.error}</div>)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
