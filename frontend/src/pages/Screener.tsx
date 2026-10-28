import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownUp, Check, ChevronLeft, ChevronRight, Download, Filter, Plus, RotateCcw, Save, Search, SlidersHorizontal, Star, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DataStatus, EmptyState, ErrorState, LoadingPanel, Modal, PageHeader, StatusPill } from '../components/ui'
import { api, errorMessage, post, del } from '../lib/api'
import { cn, fmtCompact, fmtNumber, fmtPct, pctClass } from '../lib/format'
import { useDocumentTitle } from '../lib/hooks'
import { useToasts } from '../store/ui'
import type { ScreenerPayload, Watchlist } from '../lib/types'

interface Filters {
  q: string
  sector: string
  min_price: string
  max_price: string
  min_return_1m: string
  max_volatility: string
  rsi_min: string
  rsi_max: string
  above_sma50: string
  min_volume_ratio: string
  sort: string
  order: 'asc' | 'desc'
}

const EMPTY_FILTERS: Filters = {
  q: '',
  sector: '',
  min_price: '',
  max_price: '',
  min_return_1m: '',
  max_volatility: '',
  rsi_min: '',
  rsi_max: '',
  above_sma50: '',
  min_volume_ratio: '',
  sort: 'return_1m_pct',
  order: 'desc',
}

interface Preset {
  id: string
  name: string
  filters: Record<string, unknown>
  created_at: string
}

const OPTIONAL_COLUMNS = [
  { key: 'return_3m_pct', label: '3M return' },
  { key: 'rsi_14', label: 'RSI 14' },
  { key: 'volatility_20d_pct', label: 'Vol 20d' },
  { key: 'sma_50_distance_pct', label: 'vs SMA50' },
  { key: 'volume_ratio_20d', label: 'Vol ratio' },
  { key: 'atr_14_pct', label: 'ATR%' },
]

function queryString(filters: Filters, market: string, page: number, pageSize: number) {
  const params = new URLSearchParams({ market, page: String(page), page_size: String(pageSize), sort: filters.sort, order: filters.order })
  for (const key of ['q', 'sector', 'min_price', 'max_price', 'min_return_1m', 'max_volatility', 'rsi_min', 'rsi_max', 'above_sma50', 'min_volume_ratio'] as const) {
    if (filters[key]) params.set(key, filters[key])
  }
  return params.toString()
}

export default function Screener() {
  useDocumentTitle('Screener')
  const navigate = useNavigate()
  const toast = useToasts((state) => state.push)
  const queryClient = useQueryClient()
  const [market, setMarket] = useState<'US' | 'IN'>('US')
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(25)
  const [selected, setSelected] = useState<string[]>([])
  const [visibleColumns, setVisibleColumns] = useState<string[]>(['return_3m_pct', 'rsi_14', 'volatility_20d_pct', 'volume_ratio_20d'])
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [presetOpen, setPresetOpen] = useState(false)
  const [presetName, setPresetName] = useState('')

  const query = useQuery<ScreenerPayload>({
    queryKey: ['screener', market, filters, page, pageSize],
    queryFn: () => api(`/api/v1/screener?${queryString(filters, market, page, pageSize)}`),
    staleTime: 60_000,
  })

  const watchlists = useQuery<{ watchlists: Watchlist[] }>({
    queryKey: ['watchlists'],
    queryFn: () => api('/api/v1/watchlists?with_prices=false'),
    staleTime: 60_000,
  })

  const presets = useQuery<{ presets: Preset[] }>({
    queryKey: ['screener-presets'],
    queryFn: () => api('/api/v1/screener/presets'),
  })

  const addToWatchlist = useMutation({
    mutationFn: async (symbol: string) => {
      const target = watchlists.data?.watchlists.find((list) => list.is_default) ?? watchlists.data?.watchlists[0]
      if (!target) throw new Error('Create a watchlist first.')
      return post(`/api/v1/watchlists/${target.id}/items`, { symbol })
    },
    onSuccess: (_, symbol) => {
      toast(`${symbol} added to watchlist`, 'success')
      void queryClient.invalidateQueries({ queryKey: ['watchlists'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const savePreset = useMutation({
    mutationFn: () => post<Preset>('/api/v1/screener/presets', { name: presetName, filters: { ...filters, market } }),
    onSuccess: () => {
      toast('Screener preset saved', 'success')
      setPresetOpen(false)
      setPresetName('')
      void queryClient.invalidateQueries({ queryKey: ['screener-presets'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const removePreset = useMutation({
    mutationFn: (id: string) => del(`/api/v1/screener/presets/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['screener-presets'] }),
  })

  const apply = () => {
    setFilters(draft)
    setPage(1)
  }
  const reset = () => {
    setDraft(EMPTY_FILTERS)
    setFilters(EMPTY_FILTERS)
    setPage(1)
    setSelected([])
  }
  const setSort = (key: string) => {
    const nextOrder = filters.sort === key && filters.order === 'desc' ? 'asc' : 'desc'
    setFilters((current) => ({ ...current, sort: key, order: nextOrder }))
    setDraft((current) => ({ ...current, sort: key, order: nextOrder }))
    setPage(1)
  }
  const toggleSelected = (symbol: string) => {
    setSelected((current) => (current.includes(symbol) ? current.filter((item) => item !== symbol) : current.length >= 5 ? current : [...current, symbol]))
  }

  const rows = query.data?.rows ?? []
  const meta = query.data?.meta
  const sortable = (key: string, label: string) => (
    <button onClick={() => setSort(key)} className={cn('inline-flex items-center gap-1 hover:text-white', filters.sort === key && 'text-white')}>
      {label} <ArrowDownUp className="h-2.5 w-2.5 opacity-50" />
    </button>
  )

  const exportCsv = async () => {
    try {
      const all = await api<ScreenerPayload>(`/api/v1/screener?${queryString(filters, market, 1, 100)}`)
      const header = ['symbol', 'name', 'sector', 'price', 'change_1d_pct', 'return_1m_pct', 'return_3m_pct', 'volatility_20d_pct', 'rsi_14', 'volume_ratio_20d', 'as_of']
      const lines = [header.join(',')]
      for (const row of all.rows) {
        lines.push(
          [
            row.symbol,
            `"${row.name.replace(/"/g, '""')}"`,
            `"${row.sector.replace(/"/g, '""')}"`,
            row.price,
            row.change_1d_pct ?? '',
            row.return_1m_pct ?? '',
            row.return_3m_pct ?? '',
            row.volatility_20d_pct,
            row.rsi_14 ?? '',
            row.volume_ratio_20d ?? '',
            row.as_of,
          ].join(','),
        )
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `stockpulse-screener-${market}-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
      toast(`Exported ${all.rows.length} screened rows`, 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const sectors = useMemo(() => query.data?.sectors ?? [], [query.data])

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Market explorer"
        title="Screener"
        description="Rules are evaluated against cached daily bars, not hardcoded rows. Provider delays and failed symbols stay visible."
        actions={
          <>
            <div className="flex rounded-lg border border-white/[0.09] p-0.5">
              {(['US', 'IN'] as const).map((item) => (
                <button
                  key={item}
                  onClick={() => {
                    setMarket(item)
                    setPage(1)
                    setSelected([])
                  }}
                  className={cn('rounded px-2.5 py-1.5 text-[10px] transition', market === item ? 'bg-white/[0.08] text-white' : 'text-dimx hover:text-white')}
                >
                  {item === 'US' ? 'United States' : 'India (NSE)'}
                </button>
              ))}
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => void exportCsv()}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[250px_1fr]">
        <aside className="panel h-fit p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2 text-[12px] text-white"><SlidersHorizontal className="h-3.5 w-3.5 text-violet-400" /> Rules</span>
            <button onClick={reset} className="flex items-center gap-1 text-[9.5px] text-dimx hover:text-white"><RotateCcw className="h-3 w-3" /> Reset</button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="screen-q">Symbol or company</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-dimx" />
                <input id="screen-q" className="input pl-7" value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} onKeyDown={(event) => event.key === 'Enter' && apply()} placeholder="AAPL, bank…" />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="screen-sector">Sector</label>
              <select id="screen-sector" className="select" value={draft.sector} onChange={(event) => setDraft({ ...draft, sector: event.target.value })}>
                <option value="">All sectors</option>
                {Array.from(new Set((query.data?.rows ?? []).map((row) => row.sector))).filter(Boolean).sort().map((sector) => (
                  <option key={sector} value={sector}>{sector}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="min-price">Min price</label>
                <input id="min-price" type="number" min="0" className="input" value={draft.min_price} onChange={(event) => setDraft({ ...draft, min_price: event.target.value })} placeholder="any" />
              </div>
              <div>
                <label className="label" htmlFor="max-vol">Max vol %</label>
                <input id="max-vol" type="number" min="0" className="input" value={draft.max_volatility} onChange={(event) => setDraft({ ...draft, max_volatility: event.target.value })} placeholder="any" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="rsi-min">RSI min</label>
                <input id="rsi-min" type="number" className="input" value={draft.rsi_min} onChange={(event) => setDraft({ ...draft, rsi_min: event.target.value })} placeholder="any" />
              </div>
              <div>
                <label className="label" htmlFor="rsi-max">RSI max</label>
                <input id="rsi-max" type="number" className="input" value={draft.rsi_max} onChange={(event) => setDraft({ ...draft, rsi_max: event.target.value })} placeholder="any" />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="min-return">Min 1M return %</label>
              <input id="min-return" type="number" className="input" value={draft.min_return_1m} onChange={(event) => setDraft({ ...draft, min_return_1m: event.target.value })} placeholder="any" />
            </div>
            <div>
              <label className="label" htmlFor="sma-filter">Trend filter</label>
              <select id="sma-filter" className="select" value={draft.above_sma50} onChange={(event) => setDraft({ ...draft, above_sma50: event.target.value })}>
                <option value="">Any</option>
                <option value="true">Above SMA 50</option>
                <option value="false">Below SMA 50</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="vol-ratio">Min volume ratio</label>
              <input id="vol-ratio" type="number" step="0.1" className="input" value={draft.min_volume_ratio} onChange={(event) => setDraft({ ...draft, min_volume_ratio: event.target.value })} placeholder="any" />
            </div>
            <button onClick={apply} className="btn btn-primary w-full"><Filter className="h-3.5 w-3.5" /> Apply rules</button>
            <button onClick={() => setPresetOpen(true)} className="btn btn-ghost w-full btn-sm"><Save className="h-3 w-3" /> Save preset</button>
          </div>

          <div className="mt-4 border-t border-white/[0.06] pt-3">
            <div className="eyebrow mb-2">Saved presets</div>
            {presets.data?.presets.length ? (
              <div className="space-y-1">
                {presets.data.presets.map((preset) => (
                  <div key={preset.id} className="group flex items-center gap-1">
                    <button
                      className="flex-1 truncate rounded px-1.5 py-1 text-left text-[10px] text-mutedx hover:bg-white/[0.04] hover:text-white"
                      onClick={() => {
                        const next = { ...EMPTY_FILTERS, ...(preset.filters as Partial<Filters>) }
                        setDraft(next)
                        setFilters(next)
                        if (typeof preset.filters.market === 'string' && ['US', 'IN'].includes(preset.filters.market)) setMarket(preset.filters.market as 'US' | 'IN')
                        setPage(1)
                      }}
                    >
                      {preset.name}
                    </button>
                    <button onClick={() => removePreset.mutate(preset.id)} className="rounded p-1 text-dimx opacity-0 hover:text-loss group-hover:opacity-100" aria-label={`Delete ${preset.name}`}>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-dimx">No saved screens yet.</div>
            )}
          </div>
        </aside>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-mutedx">{query.data?.pagination.total ?? 0} instruments meet the rules</span>
              {meta && <DataStatus provider={meta.provider} status={meta.data_status} fetchedAt={meta.fetched_at} compact />}
            </div>
            <div className="flex items-center gap-2">
              {selected.length > 0 && (
                <button className="btn btn-outline btn-sm" onClick={() => navigate(`/app/compare?symbols=${selected.join(',')}`)}>
                  Compare {selected.length}
                </button>
              )}
              <div className="relative">
                <button className="btn btn-ghost btn-sm" onClick={() => setColumnsOpen((open) => !open)} aria-expanded={columnsOpen}>
                  <SlidersHorizontal className="h-3 w-3" /> Columns
                </button>
                {columnsOpen && (
                  <div className="absolute right-0 top-9 z-20 w-48 rounded-lg border border-white/10 bg-ink-850 p-2 shadow-card">
                    {OPTIONAL_COLUMNS.map((column) => (
                      <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[10.5px] text-mutedx hover:bg-white/[0.04]">
                        <input
                          type="checkbox"
                          className="accent-violet-500"
                          checked={visibleColumns.includes(column.key)}
                          onChange={(event) =>
                            setVisibleColumns((current) => event.target.checked ? [...current, column.key] : current.filter((item) => item !== column.key))
                          }
                        />
                        {column.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {query.isLoading ? (
            <LoadingPanel rows={8} label="Fetching universe data" />
          ) : query.isError ? (
            <ErrorState message={query.error instanceof Error ? query.error.message : 'Screener data unavailable'} onRetry={() => void query.refetch()} />
          ) : rows.length === 0 ? (
            <div className="panel">
              <EmptyState
                title="No instruments match these rules"
                description="Loosen a filter or reset the screen. If the universe cache is empty, refresh after the provider responds."
                icon={<Filter className="h-5 w-5" />}
                action={<button onClick={reset} className="btn btn-outline btn-sm">Reset rules</button>}
              />
            </div>
          ) : (
            <div className="panel overflow-hidden">
              <div className="overflow-x-auto">
                <table className="data-table min-w-[980px]">
                  <thead>
                    <tr>
                      <th className="w-8" />
                      <th>{sortable('symbol', 'Symbol')}</th>
                      <th>Company</th>
                      <th className="text-right">{sortable('price', 'Price')}</th>
                      <th className="text-right">{sortable('return_1m_pct', '1M')}</th>
                      {visibleColumns.includes('return_3m_pct') && <th className="text-right">3M</th>}
                      {visibleColumns.includes('rsi_14') && <th className="text-right">{sortable('rsi_14', 'RSI')}</th>}
                      {visibleColumns.includes('volatility_20d_pct') && <th className="text-right">{sortable('volatility_20d_pct', 'Vol 20d')}</th>}
                      {visibleColumns.includes('sma_50_distance_pct') && <th className="text-right">vs SMA50</th>}
                      {visibleColumns.includes('volume_ratio_20d') && <th className="text-right">{sortable('volume_ratio_20d', 'Vol ratio')}</th>}
                      {visibleColumns.includes('atr_14_pct') && <th className="text-right">ATR%</th>}
                      <th>Data</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.symbol}>
                        <td>
                          <input type="checkbox" className="h-3 w-3 accent-violet-500" checked={selected.includes(row.symbol)} onChange={() => toggleSelected(row.symbol)} aria-label={`Select ${row.symbol}`} />
                        </td>
                        <td>
                          <Link to={`/app/research/${encodeURIComponent(row.symbol)}`} className="font-mono text-[11px] text-white hover:text-violet-300">{row.symbol}</Link>
                          <div className="mt-0.5 font-mono text-[8px] text-dimx">{row.exchange}</div>
                        </td>
                        <td>
                          <div className="max-w-[170px] truncate text-[11px] text-mutedx">{row.name}</div>
                          <div className="font-mono text-[8.5px] text-dimx">{row.sector}</div>
                        </td>
                        <td className="num text-right text-white">{fmtNumber(row.price, 2)} <span className="text-[8px] text-dimx">{row.currency}</span></td>
                        <td className={cn('num text-right', pctClass(row.return_1m_pct))}>{fmtPct(row.return_1m_pct)}</td>
                        {visibleColumns.includes('return_3m_pct') && <td className={cn('num text-right', pctClass(row.return_3m_pct))}>{fmtPct(row.return_3m_pct)}</td>}
                        {visibleColumns.includes('rsi_14') && <td className={cn('num text-right', row.rsi_14 !== null && row.rsi_14 > 70 ? 'text-warn' : row.rsi_14 !== null && row.rsi_14 < 30 ? 'text-cyanx' : 'text-mutedx')}>{row.rsi_14 !== null ? row.rsi_14.toFixed(1) : '—'}</td>}
                        {visibleColumns.includes('volatility_20d_pct') && <td className="num text-right text-mutedx">{row.volatility_20d_pct.toFixed(1)}%</td>}
                        {visibleColumns.includes('sma_50_distance_pct') && <td className={cn('num text-right', pctClass(row.sma_50_distance_pct))}>{fmtPct(row.sma_50_distance_pct, 1)}</td>}
                        {visibleColumns.includes('volume_ratio_20d') && <td className="num text-right text-mutedx">{row.volume_ratio_20d?.toFixed(2) ?? '—'}</td>}
                        {visibleColumns.includes('atr_14_pct') && <td className="num text-right text-mutedx">{row.atr_14_pct?.toFixed(1) ?? '—'}%</td>}
                        <td className="font-mono text-[9px] text-dimx">{row.as_of}</td>
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => addToWatchlist.mutate(row.symbol)} className="rounded p-1 text-dimx hover:bg-white/5 hover:text-violet-300" title="Add to default watchlist" aria-label={`Add ${row.symbol} to watchlist`}>
                              <Star className="h-3.5 w-3.5" />
                            </button>
                            <Link to={`/app/research/${encodeURIComponent(row.symbol)}`} className="rounded p-1 text-dimx hover:bg-white/5 hover:text-white" aria-label={`Research ${row.symbol}`}>
                              <ChevronRight className="h-3.5 w-3.5" />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-3 py-2.5">
                <span className="font-mono text-[9px] text-dimx">
                  page {query.data?.pagination.page} / {query.data?.pagination.pages} · {fmtCompact(rows.reduce((sum, row) => sum + (row.avg_volume_20d ?? 0), 0))} avg volume shown
                </span>
                <div className="flex items-center gap-1">
                  <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="h-3.5 w-3.5" /> Previous</button>
                  <button className="btn btn-ghost btn-sm" disabled={page >= (query.data?.pagination.pages ?? 1)} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </div>
          )}

          {query.data && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[9.5px] text-dimx">
              <span>{query.data.meta.note}</span>
              <span>as of {query.data.meta.as_of ?? '—'}</span>
              {query.data.meta.failed_symbols.length > 0 && <span className="text-warn">{query.data.meta.failed_symbols.length} symbols failed provider retrieval</span>}
            </div>
          )}

          {sectors.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {sectors.map((sector) => (
                <button
                  key={sector.sector}
                  onClick={() => {
                    const next = { ...filters, sector: sector.sector }
                    setDraft(next)
                    setFilters(next)
                    setPage(1)
                  }}
                  className="chip hover:border-white/25 hover:text-white"
                  title={`Average 1M return ${sector.avg_return_1m_pct.toFixed(2)}% across ${sector.count} names`}
                >
                  {sector.sector} <span className={pctClass(sector.avg_return_1m_pct)}>{fmtPct(sector.avg_return_1m_pct, 1)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={presetOpen}
        onClose={() => setPresetOpen(false)}
        title="Save screener preset"
        description="Stores the current rule set for this account, on this server."
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setPresetOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={!presetName.trim() || savePreset.isPending} onClick={() => savePreset.mutate()}>
              {savePreset.isPending ? 'Saving…' : 'Save preset'}
            </button>
          </>
        }
      >
        <label className="label" htmlFor="preset-name">Preset name</label>
        <input id="preset-name" className="input" value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Oversold quality names" maxLength={80} />
      </Modal>
    </div>
  )
}
