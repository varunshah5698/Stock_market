import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRight,
  BellPlus,
  BookOpen,
  ChartCandlestick,
  Download,
  ExternalLink,
  Layers,
  Lock,
  Plus,
  Save,
  Star,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { MarketLineChart, PriceChart, SignedBars } from '../components/charts'
import { Badge, Button, Callout, DataStatus, ErrorState, Field, Input, LoadingPanel, Modal, PageHeader, SectionTitle, Select, Spinner, Toggle, WarningList } from '../components/ui'
import { api, errorMessage, post, put } from '../lib/api'
import { cn, fmtCompact, fmtDateTime, fmtNumber, fmtPct, pctClass } from '../lib/format'
import { useDocumentTitle } from '../lib/hooks'
import { rememberSymbol } from '../lib/recent'
import { useToasts } from '../store/ui'
import type { IndicatorPayload, InstrumentHistory, Watchlist } from '../lib/types'

const PERIODS = [
  { value: '3mo', label: '3M' },
  { value: '6mo', label: '6M' },
  { value: '1y', label: '1Y' },
  { value: '2y', label: '2Y' },
  { value: '5y', label: '5Y' },
]

// Candle interval. 1m history is capped at ~7 days and 3m is aggregated from
// 1m by the server, because the provider has no native 3-minute interval.
const TIMEFRAMES = [
  { value: '1m', label: '1m', hint: 'One-minute candles. Provider keeps ~7 days; delayed, not live.' },
  { value: '3m', label: '3m', hint: 'Three-minute candles aggregated server-side from one-minute bars.' },
  { value: '1d', label: '1D', hint: 'Daily end-of-day candles.' },
] as const
type Timeframe = (typeof TIMEFRAMES)[number]['value']

interface Profile {
  symbol: string
  name: string
  exchange: string
  market: string
  instrument_type: string
  currency: string
  sector: string
  industry: string
  quote: {
    price: number
    previous_close: number | null
    change_pct: number | null
    observation_time: string | null
    meta: { provider: string; data_status: string; fetched_at: string; warnings: string[] }
  }
  market_status: { status: string; source: string; exchange_time: string; note: string }
  fundamentals: { available: boolean; reason: string }
}

export default function Research() {
  const { symbol: routeSymbol } = useParams()
  const symbol = (routeSymbol ?? 'AAPL').toUpperCase()
  useDocumentTitle(`${symbol} research`)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToasts((state) => state.push)
  const [period, setPeriod] = useState('1y')
  const [timeframe, setTimeframe] = useState<Timeframe>('1d')
  const [overlays, setOverlays] = useState({ sma20: true, sma50: true, sma200: false, bb: false })
  const [symbolInput, setSymbolInput] = useState(symbol)
  const [alertOpen, setAlertOpen] = useState(false)
  const [alertKind, setAlertKind] = useState<'price_above' | 'price_below'>('price_above')
  const [alertThreshold, setAlertThreshold] = useState('')
  const [note, setNote] = useState('')
  const [noteDirty, setNoteDirty] = useState(false)

  useEffect(() => {
    setSymbolInput(symbol)
    rememberSymbol(symbol)
  }, [symbol])

  const profile = useQuery<Profile>({
    queryKey: ['profile', symbol],
    queryFn: () => api(`/api/v1/instruments/${encodeURIComponent(symbol)}/profile`),
  })

  const history = useQuery<InstrumentHistory>({
    // The interval is part of the key, so a previous timeframe's payload can
    // never be rendered as the newly selected one.
    queryKey: ['history', symbol, period, timeframe],
    queryFn: () =>
      api(`/api/v1/instruments/${encodeURIComponent(symbol)}/history?period=${period}&interval=${timeframe}`),
  })

  const indicators = useQuery<IndicatorPayload>({
    queryKey: ['indicators', symbol],
    queryFn: () => api(`/api/v1/instruments/${encodeURIComponent(symbol)}/indicators?period=2y`),
    staleTime: 120_000,
  })

  const watchlists = useQuery<{ watchlists: Watchlist[] }>({
    queryKey: ['watchlists'],
    queryFn: () => api('/api/v1/watchlists?with_prices=false'),
    staleTime: 60_000,
  })

  const noteQuery = useQuery<{ body: string; updated_at: string | null }>({
    queryKey: ['note', symbol],
    queryFn: () => api(`/api/v1/instruments/${encodeURIComponent(symbol)}/notes`),
  })

  useEffect(() => {
    if (noteQuery.data && !noteDirty) setNote(noteQuery.data.body)
  }, [noteQuery.data, noteDirty])

  useEffect(() => {
    if (profile.data?.quote.price) setAlertThreshold(profile.data.quote.price.toFixed(2))
  }, [profile.data?.quote.price])

  const addToWatchlist = useMutation({
    mutationFn: async () => {
      const target = watchlists.data?.watchlists.find((list) => list.is_default) ?? watchlists.data?.watchlists[0]
      if (!target) throw new Error('No watchlist exists yet.')
      return post(`/api/v1/watchlists/${target.id}/items`, { symbol })
    },
    onSuccess: () => {
      toast(`${symbol} added to watchlist`, 'success')
      void queryClient.invalidateQueries({ queryKey: ['watchlists'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const saveAlert = useMutation({
    mutationFn: () =>
      post('/api/v1/alerts', {
        symbol,
        kind: alertKind,
        threshold: Number(alertThreshold),
        cooldown_minutes: 60,
      }),
    onSuccess: () => {
      toast('Alert created. Evaluation is periodic, not streaming.', 'success')
      setAlertOpen(false)
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const saveNote = useMutation({
    mutationFn: () => put(`/api/v1/instruments/${encodeURIComponent(symbol)}/notes`, { body: note }),
    onSuccess: () => {
      setNoteDirty(false)
      toast('Research note saved', 'success')
      void queryClient.invalidateQueries({ queryKey: ['note', symbol] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const overlaysList = useMemo(() => {
    const series = indicators.data?.series
    if (!series) return []
    const list: { label: string; color: string; series: IndicatorPayload['series'][string] }[] = []
    if (overlays.sma20) list.push({ label: 'SMA 20', color: '#fbbf24', series: series.sma_20 })
    if (overlays.sma50) list.push({ label: 'SMA 50', color: '#22d3ee', series: series.sma_50 })
    if (overlays.sma200) list.push({ label: 'SMA 200', color: '#a78bfa', series: series.sma_200 })
    if (overlays.bb) {
      list.push({ label: 'BB upper', color: 'rgba(167,139,250,0.6)', series: series.bb_upper })
      list.push({ label: 'BB lower', color: 'rgba(167,139,250,0.6)', series: series.bb_lower })
    }
    return list
  }, [indicators.data, overlays])

  const latest = indicators.data?.latest ?? {}
  const bars = history.data?.bars ?? []
  const meta = history.data?.meta
  // Captured before the JSX: TanStack's result union narrows to `never` inside
  // the isError branch, so the members are read here instead.
  const historyError = history.error
  const refetchHistory = history.refetch

  if (history.isLoading && !history.data) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Research terminal" title={symbol} description="Loading delayed price history and indicators." />
        <LoadingPanel rows={8} />
      </div>
    )
  }

  if (history.isError) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Research terminal" title={symbol} />
        <ErrorState message={history.error instanceof Error ? history.error.message : 'Price history unavailable.'} onRetry={() => void history.refetch()} />
        <Link to="/app/screener" className="btn btn-outline">Back to screener</Link>
      </div>
    )
  }

  const quote = profile.data?.quote
  const positive = (quote?.change_pct ?? 0) >= 0
  const stale = history.data?.meta.warnings.some((warning) => warning.toLowerCase().includes('days old')) ?? false

  const exportCsv = () => {
    if (!bars.length) return
    const header = 'date,open,high,low,close,adj_close,volume'
    const lines = [header, ...bars.map((bar) => `${bar.date},${bar.open},${bar.high},${bar.low},${bar.close},${bar.adj_close},${bar.volume}`)]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `stockpulse-${symbol}-${period}-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
    toast(`Exported ${bars.length} daily bars`, 'success')
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`Research terminal · ${profile.data?.exchange ?? history.data?.instrument.exchange ?? ''} · ${profile.data?.instrument_type ?? 'equity'}`}
        title={profile.data?.name ?? history.data?.instrument.name ?? symbol}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="font-mono text-[11px] text-white">{symbol}</span>
            {profile.data && <Badge tone="neutral">{profile.data.sector || 'Unclassified'}</Badge>}
            {profile.data?.market_status && <Badge tone={profile.data.market_status.status === 'OPEN' ? 'gain' : 'neutral'}>{profile.data.market_status.status.toLowerCase()}</Badge>}
            {meta && <DataStatus provider={meta.provider} status={meta.data_status} fetchedAt={meta.fetched_at} compact />}
            {stale && <Badge tone="warn">stale observation</Badge>}
          </span>
        }
        actions={
          <>
            <form
              className="flex items-center gap-1.5"
              onSubmit={(event) => {
                event.preventDefault()
                const next = symbolInput.trim().toUpperCase()
                if (next) navigate(`/app/research/${encodeURIComponent(next)}`)
              }}
            >
              <Input value={symbolInput} onChange={(event) => setSymbolInput(event.target.value.toUpperCase())} className="h-8 w-28 font-mono text-[11px]" aria-label="Symbol" />
              <Button size="sm" type="submit" variant="outline">Go</Button>
            </form>
            <Button size="sm" variant="outline" loading={addToWatchlist.isPending} onClick={() => addToWatchlist.mutate()} icon={<Star className="h-3.5 w-3.5" />}>Watchlist</Button>
            <Button size="sm" variant="outline" onClick={() => setAlertOpen(true)} icon={<BellPlus className="h-3.5 w-3.5" />}>Alert</Button>
            <Button size="sm" variant="outline" onClick={exportCsv} icon={<Download className="h-3.5 w-3.5" />}>CSV</Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="panel p-4">
          <div className="eyebrow mb-1.5">Delayed quote</div>
          {profile.isLoading ? (
            <div className="space-y-2" aria-label="Loading quote"><div className="skeleton h-7 w-24" /><div className="skeleton h-3 w-32" /></div>
          ) : (
            <>
              <div className="num text-[26px] leading-none text-white">{quote ? fmtNumber(quote.price, 2) : '—'} <span className="text-[10px] text-dimx">{profile.data?.currency}</span></div>
              <div className={cn('mt-2 flex items-center gap-1.5 num text-[11px]', pctClass(quote?.change_pct))}>
                {positive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {fmtPct(quote?.change_pct)} <span className="text-dimx">vs previous close</span>
              </div>
              <div className="mt-2 font-mono text-[8.5px] text-dimx">{quote?.observation_time ? fmtDateTime(quote.observation_time) : '—'} · {quote?.meta.data_status}</div>
            </>
          )}
        </div>
        <div className="panel p-4">
          <div className="eyebrow mb-1.5">Realized volatility</div>
          {indicators.isLoading ? <div className="skeleton h-7 w-20" /> : <div className="num text-[26px] leading-none text-white">{latest.volatility_20d_pct !== undefined ? `${fmtNumber(latest.volatility_20d_pct as number, 1)}%` : '—'}</div>}
          <div className="mt-2 flex gap-3 font-mono text-[9px] text-dimx">
            <span>20d</span>
            <span>60d {latest.volatility_60d_pct !== undefined ? `${fmtNumber(latest.volatility_60d_pct as number, 1)}%` : '—'}</span>
          </div>
          <div className="mt-2 text-[9.5px] text-dimx">Annualized from daily adjusted returns.</div>
        </div>
        <div className="panel p-4">
          <div className="eyebrow mb-1.5">Drawdown</div>
          {indicators.isLoading ? <div className="skeleton h-7 w-20" /> : <div className="num text-[26px] leading-none text-warn">{latest.drawdown_from_peak_pct !== undefined ? `${fmtNumber(latest.drawdown_from_peak_pct as number, 1)}%` : '—'}</div>}
          <div className="mt-2 font-mono text-[9px] text-dimx">peak drawdown {latest.max_drawdown_pct !== undefined ? `${fmtNumber(latest.max_drawdown_pct as number, 1)}%` : '—'}</div>
          <div className="mt-2 text-[9.5px] text-dimx">Over the loaded indicator window.</div>
        </div>
        <div className="panel p-4">
          <div className="eyebrow mb-1.5">52-week range</div>
          {indicators.isLoading ? (
            <div className="space-y-2"><div className="skeleton h-3 w-full" /><div className="skeleton h-4 w-full" /></div>
          ) : latest.high_52w !== undefined && latest.low_52w !== undefined ? (
            <>
              <div className="flex items-baseline justify-between">
                <span className="num text-[12px] text-mutedx">{fmtNumber(latest.low_52w as number, 2)}</span>
                <span className="num text-[12px] text-mutedx">{fmtNumber(latest.high_52w as number, 2)}</span>
              </div>
              <div className="relative mt-2 h-1.5 rounded-full bg-white/[0.07]">
                <div
                  className="absolute top-0 h-1.5 w-1 rounded-full bg-violet-400"
                  style={{
                    left: `${Math.min(100, Math.max(0, (((latest.close as number) - (latest.low_52w as number)) / (((latest.high_52w as number) - (latest.low_52w as number)) || 1)) * 100))}%`,
                  }}
                />
              </div>
              <div className="mt-2 text-[9.5px] text-dimx">Position of last close in the 252-session range.</div>
            </>
          ) : (
            <div className="text-[11px] text-dimx">Insufficient history.</div>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
            <div className="flex items-center gap-2 text-[12px] text-white">
              <ChartCandlestick className="h-3.5 w-3.5 text-violet-400" /> Adjusted OHLC
              <span className="font-mono text-[9px] text-dimx">{bars.length} bars</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-md border border-white/[0.08] p-0.5">
                {TIMEFRAMES.map((item) => (
                  <button
                    key={item.value}
                    onClick={() => setTimeframe(item.value)}
                    title={item.hint}
                    className={cn('rounded px-2 py-1 font-mono text-[9px] transition', timeframe === item.value ? 'bg-white/[0.08] text-white' : 'text-dimx hover:text-white')}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="flex rounded-md border border-white/[0.08] p-0.5">
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/[0.05] px-4 py-2.5">
            <span className="eyebrow">Overlays</span>
            {[
              ['sma20', 'SMA 20', '#fbbf24'],
              ['sma50', 'SMA 50', '#22d3ee'],
              ['sma200', 'SMA 200', '#a78bfa'],
              ['bb', 'Bollinger', '#8b5cf6'],
            ].map(([key, label, color]) => (
              <label key={key} className="flex cursor-pointer items-center gap-1.5 text-[10px] text-mutedx">
                <input
                  type="checkbox"
                  className="h-3 w-3 accent-violet-500"
                  checked={overlays[key as keyof typeof overlays]}
                  onChange={(event) => setOverlays({ ...overlays, [key]: event.target.checked })}
                />
                <span className="h-0.5 w-3" style={{ background: color }} />
                {label}
              </label>
            ))}
            <span className="ml-auto font-mono text-[8.5px] text-dimx">{meta?.provider} · {meta?.data_status}</span>
          </div>
          <div className="p-2">
            {history.isFetching && <div className="px-2 pb-1"><Spinner label="Refreshing bars" /></div>}
            {history.isError ? (
              <ErrorState
                title={`Could not load ${timeframe} candles`}
                message={errorMessage(historyError)}
                onRetry={() => void refetchHistory()}
              />
            ) : bars.length === 0 ? (
              <div className="px-3 py-12 text-center font-mono text-[10px] text-dimx">
                {history.isPending ? `Loading ${timeframe} candles…` : `No ${timeframe} candles are available for ${symbol}.`}
              </div>
            ) : (
              <PriceChart bars={bars} overlays={overlaysList} height={380} currency={history.data?.meta.currency} />
            )}
          </div>
          {headersWarnings(meta?.warnings)}
        </section>

        <div className="space-y-4">
          <section className="panel p-4">
            <SectionTitle eyebrow="Performance" title="Return windows" action={<span className="font-mono text-[8.5px] text-dimx">as of {history.data?.meta.observation_end?.slice(0, 10) ?? '—'}</span>} />
            <div className="grid grid-cols-2 gap-3">
              {[
                ['1W', latest.return_1w_pct],
                ['1M', latest.return_1m_pct],
                ['3M', latest.return_3m_pct],
                ['1Y', latest.return_1y_pct],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-lg border border-white/[0.05] bg-white/[0.015] p-2.5">
                  <div className="eyebrow">{label as string}</div>
                  <div className={cn('mt-1 num text-[15px]', pctClass(value as number))}>{value !== undefined && value !== null ? fmtPct(value as number) : '—'}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between text-[10px] text-dimx">
              <span>RSI(14)</span>
              <span className={cn('num', (latest.rsi_14 as number) > 70 ? 'text-warn' : (latest.rsi_14 as number) < 30 ? 'text-cyanx' : 'text-white')}>
                {latest.rsi_14 !== undefined ? fmtNumber(latest.rsi_14 as number, 1) : '—'}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] text-dimx">
              <span>ATR(14)</span>
              <span className="num text-white">{latest.atr_14_pct !== undefined ? `${fmtNumber(latest.atr_14_pct as number, 2)}%` : '—'}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to={`/app/compare?symbols=${symbol},SPY`} className="btn btn-outline btn-sm"><Layers className="h-3 w-3" /> Compare vs SPY</Link>
              <Link to={`/app/prediction?symbol=${symbol}`} className="btn btn-outline btn-sm"><ArrowUpRight className="h-3 w-3" /> Predict</Link>
            </div>
          </section>

          <section className="panel p-4">
            <SectionTitle eyebrow="Instrument" title="Profile" />
            <dl className="space-y-2 text-[11px]">
              {[
                ['Exchange', profile.data?.exchange ?? '—'],
                ['Market', profile.data?.market ?? '—'],
                ['Currency', profile.data?.currency ?? '—'],
                ['Sector', profile.data?.sector || '—'],
                ['Industry', profile.data?.industry || '—'],
                ['Market state', profile.data?.market_status.status ?? '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4 border-b border-white/[0.04] pb-2 last:border-0 last:pb-0">
                  <dt className="text-dimx">{label}</dt>
                  <dd className="text-right text-mutedx">{profile.isLoading ? 'Loading…' : value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 rounded-md border border-white/[0.06] bg-black/20 p-2.5 text-[9.5px] leading-relaxed text-dimx">
              {profile.data?.market_status.note ?? 'Market state is a clock-based estimate where available.'}
            </div>
          </section>

          <section className="panel p-4">
            <SectionTitle eyebrow="Fundamentals" title="Not configured" />
            <div className="flex items-start gap-2.5 rounded-md border border-white/[0.06] bg-white/[0.015] p-3">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-dimx" />
              <p className="text-[10.5px] leading-relaxed text-dimx">{profile.data?.fundamentals.reason ?? 'No point-in-time fundamentals provider is configured.'}</p>
            </div>
          </section>

          <section className="panel p-4">
            <SectionTitle eyebrow="Research note" title="Your annotation" action={noteDirty ? <span className="chip chip-warn">unsaved</span> : null} />
            {noteQuery.isLoading ? (
              <div className="skeleton h-24 w-full" />
            ) : (
              <>
                <textarea
                  className="textarea min-h-[110px] text-[12px]"
                  value={note}
                  onChange={(event) => {
                    setNote(event.target.value)
                    setNoteDirty(true)
                  }}
                  placeholder="Write a thesis, event note or falsification criterion…"
                  maxLength={20_000}
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="font-mono text-[8.5px] text-dimx">{note.length.toLocaleString()} / 20,000</span>
                  <Button size="sm" variant="outline" loading={saveNote.isPending} disabled={!noteDirty} onClick={() => saveNote.mutate()} icon={<Save className="h-3 w-3" />}>Save note</Button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel p-4">
          <SectionTitle eyebrow="Momentum" title="RSI (14)" action={<span className="font-mono text-[8.5px] text-dimx">2Y window</span>} />
          {indicators.isLoading ? (
            <div className="skeleton h-[170px] w-full" />
          ) : indicators.data ? (
            <MarketLineChart
              dates={indicators.data.series.rsi_14.dates}
              series={[{ name: 'RSI 14', color: '#a78bfa', values: indicators.data.series.rsi_14.values }]}
              height={180}
              reference={50}
              yDomain={[0, 100]}
              valueFormatter={(value) => value.toFixed(0)}
            />
          ) : (
            <div className="text-[11px] text-dimx">Indicators unavailable.</div>
          )}
          <div className="mt-1 font-mono text-[8.5px] text-dimx">Above 70 = extended; below 30 = oversold. Not a buy or sell instruction.</div>
        </section>
        <section className="panel p-4">
          <SectionTitle eyebrow="Trend" title="MACD histogram" action={<span className="font-mono text-[8.5px] text-dimx">2Y window</span>} />
          {indicators.isLoading ? (
            <div className="skeleton h-[170px] w-full" />
          ) : indicators.data ? (
            <SignedBars dates={indicators.data.series.macd_hist.dates} values={indicators.data.series.macd_hist.values.map((value) => value ?? 0)} height={180} formatter={(value) => fmtNumber(value, 2)} />
          ) : (
            <div className="text-[11px] text-dimx">Indicators unavailable.</div>
          )}
          <div className="mt-1 font-mono text-[8.5px] text-dimx">MACD(12,26,9) histogram in price units. Lagging by construction.</div>
        </section>
      </div>

      {meta && <WarningList warnings={meta.warnings} title="Data provenance & warnings" />}

      <section className="panel p-4">
        <SectionTitle eyebrow="Data dictionary" title="How to read this page" />
        <div className="grid gap-3 text-[10.5px] leading-relaxed text-dimx sm:grid-cols-2 lg:grid-cols-3">
          <p><span className="text-mutedx">Adjusted OHLC.</span> Provider-adjusted for splits and dividends. Executions are never assumed at the close that generated a signal.</p>
          <p><span className="text-mutedx">Realized volatility.</span> Standard deviation of daily returns × √252 over the stated window, not an implied-vol forecast.</p>
          <p><span className="text-mutedx">Drawdown.</span> Current close versus the running peak of the loaded window.</p>
          <p><span className="text-mutedx">RSI.</span> Wilder-smoothed relative strength index over 14 sessions.</p>
          <p><span className="text-mutedx">Data status.</span> Delayed/end-of-day unless a different provider is explicitly configured and labelled.</p>
          <p><span className="text-mutedx">Not a recommendation.</span> The interface does not convert any indicator into a BUY or SELL label.</p>
        </div>
      </section>

      <Modal
        open={alertOpen}
        onClose={() => setAlertOpen(false)}
        title={`Create a ${symbol} alert`}
        description="Alerts run on a periodic server job using delayed quotes. They are not streaming and can fire late."
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setAlertOpen(false)}>Cancel</button>
            <Button variant="primary" loading={saveAlert.isPending} onClick={() => saveAlert.mutate()} disabled={!alertThreshold || Number(alertThreshold) <= 0}>Create alert</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Condition">
            <Select value={alertKind} onChange={(event) => setAlertKind(event.target.value as 'price_above' | 'price_below')}>
              <option value="price_above">Price at or above</option>
              <option value="price_below">Price at or below</option>
            </Select>
          </Field>
          <Field label="Threshold" hint={`Last delayed price: ${quote ? fmtNumber(quote.price, 2) : '—'} ${profile.data?.currency ?? ''}`}>
            <Input type="number" step="0.01" min="0.01" value={alertThreshold} onChange={(event) => setAlertThreshold(event.target.value)} />
          </Field>
          <Callout tone="warn">No alert is guaranteed to fire at the threshold. Evaluation cadence and delayed provider prices both affect timing.</Callout>
        </div>
      </Modal>
    </div>
  )
}

function headersWarnings(warnings?: string[]) {
  if (!warnings?.length) return null
  return (
    <div className="border-t border-white/[0.05] px-4 py-2 text-[9px] leading-relaxed text-dimx">
      {warnings.join(' · ')}
    </div>
  )
}
