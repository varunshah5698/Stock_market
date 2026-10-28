import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  BellPlus,
  CheckCheck,
  GitCompareArrows,
  ListChecks,
  Plus,
  RefreshCw,
  Settings2,
  Star,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MarketLineChart } from '../components/charts'
import { Badge, Button, Callout, EmptyState, ErrorState, Field, Input, LoadingPanel, Modal, PageHeader, SectionTitle, Select, StatusPill, Tabs, Toggle } from '../components/ui'
import { api, del, errorMessage, patch, post, put } from '../lib/api'
import { cn, fmtDate, fmtDateTime, fmtNumber, fmtPct, pctClass, relativeTime } from '../lib/format'
import { useDocumentTitle } from '../lib/hooks'
import { useToasts } from '../store/ui'
import type { Watchlist } from '../lib/types'

interface AlertRow {
  id: string
  symbol: string
  kind: string
  threshold: number | null
  cooldown_minutes: number
  is_active: boolean
  last_fired_at: string | null
  created_at: string
  monitoring: string
}

interface AlertEvent {
  id: string
  alert_id: string
  message: string
  value: number | null
  data: Record<string, unknown>
  triggered_at: string
}

interface AlertsPayload {
  alerts: AlertRow[]
  events: AlertEvent[]
  monitoring: { mode: string; note: string }
}

interface Performance {
  symbols: string[]
  failed: { symbol: string; error: string }[]
  dates: string[]
  values: number[]
  cumulative_return_pct: number
  observations: number
  method: string
  warnings: string[]
}

type Tab = 'watchlists' | 'alerts'

export default function Watchlists() {
  useDocumentTitle('Watchlists & alerts')
  const toast = useToasts((state) => state.push)
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('watchlists')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [period, setPeriod] = useState('1y')
  const [newListOpen, setNewListOpen] = useState(false)
  const [listName, setListName] = useState('New watchlist')
  const [itemSymbol, setItemSymbol] = useState('')
  const [itemNote, setItemNote] = useState('')
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [compareOpen, setCompareOpen] = useState(false)
  const [alertSymbol, setAlertSymbol] = useState('')
  const [alertKind, setAlertKind] = useState('price_above')
  const [alertThreshold, setAlertThreshold] = useState('')
  const [alertCooldown, setAlertCooldown] = useState('60')

  const watchlists = useQuery<{ watchlists: Watchlist[]; warnings: string[] }>({
    queryKey: ['watchlists'],
    queryFn: () => api('/api/v1/watchlists?with_prices=true'),
    refetchInterval: 120_000,
  })

  const selected = watchlists.data?.watchlists.find((list) => list.id === selectedId) ?? null

  useEffect(() => {
    if (!selectedId && watchlists.data?.watchlists.length) {
      setSelectedId((watchlists.data.watchlists.find((item) => item.is_default) ?? watchlists.data.watchlists[0]).id)
    }
  }, [watchlists.data, selectedId])

  const performance = useQuery<Performance>({
    queryKey: ['watchlist-performance', selectedId, period],
    queryFn: () => api(`/api/v1/watchlists/${selectedId}/performance?period=${period}`),
    enabled: Boolean(selectedId && selected?.items.length),
  })

  const comparison = useQuery<{ watchlists: (Performance & { id: string; name: string })[] }>({
    queryKey: ['watchlist-comparison', compareIds, period],
    queryFn: () => api(`/api/v1/watchlists/comparison?ids=${compareIds.join(',')}&period=${period}`),
    enabled: compareOpen && compareIds.length >= 2,
  })

  const alerts = useQuery<AlertsPayload>({
    queryKey: ['alerts'],
    queryFn: () => api('/api/v1/alerts'),
  })

  const createList = useMutation({
    mutationFn: () => post<{ id: string }>('/api/v1/watchlists', { name: listName }),
    onSuccess: (data) => {
      toast('Watchlist created', 'success')
      setNewListOpen(false)
      setListName('New watchlist')
      setSelectedId(data.id)
      void queryClient.invalidateQueries({ queryKey: ['watchlists'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const addItem = useMutation({
    mutationFn: () => post(`/api/v1/watchlists/${selectedId}/items`, { symbol: itemSymbol.toUpperCase(), note: itemNote }),
    onSuccess: () => {
      toast(`${itemSymbol.toUpperCase()} added`, 'success')
      setItemSymbol('')
      setItemNote('')
      void queryClient.invalidateQueries({ queryKey: ['watchlists'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const removeItem = useMutation({
    mutationFn: (symbol: string) => del(`/api/v1/watchlists/${selectedId}/items/${encodeURIComponent(symbol)}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['watchlists'] })
      void queryClient.invalidateQueries({ queryKey: ['watchlist-performance'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const reorder = useMutation({
    mutationFn: (symbols: string[]) => put(`/api/v1/watchlists/${selectedId}/reorder`, { symbols }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['watchlists'] }),
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const deleteList = useMutation({
    mutationFn: () => del(`/api/v1/watchlists/${selectedId}`),
    onSuccess: () => {
      toast('Watchlist deleted', 'success')
      setSelectedId(null)
      void queryClient.invalidateQueries({ queryKey: ['watchlists'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const makeDefault = useMutation({
    mutationFn: () => put(`/api/v1/watchlists/${selectedId}`, { is_default: true }),
    onSuccess: () => {
      toast('Default watchlist updated', 'success')
      void queryClient.invalidateQueries({ queryKey: ['watchlists'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const createAlert = useMutation({
    mutationFn: () =>
      post('/api/v1/alerts', {
        symbol: alertSymbol.toUpperCase(),
        kind: alertKind,
        threshold: Number(alertThreshold),
        cooldown_minutes: Number(alertCooldown),
      }),
    onSuccess: () => {
      toast('Alert created. Monitoring is periodic.', 'success')
      setAlertSymbol('')
      setAlertThreshold('')
      void queryClient.invalidateQueries({ queryKey: ['alerts'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const updateAlert = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) => patch(`/api/v1/alerts/${id}`, { is_active }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['alerts'] }),
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const deleteAlert = useMutation({
    mutationFn: (id: string) => del(`/api/v1/alerts/${id}`),
    onSuccess: () => {
      toast('Alert deleted', 'success')
      void queryClient.invalidateQueries({ queryKey: ['alerts'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const checkAlerts = useMutation({
    mutationFn: () => post<{ triggered: { message: string }[] }>('/api/v1/alerts/check'),
    onSuccess: (data) => {
      toast(data.triggered.length ? `${data.triggered.length} alert${data.triggered.length === 1 ? '' : 's'} triggered` : 'No alerts triggered', data.triggered.length ? 'success' : 'info', data.triggered[0]?.message)
      void queryClient.invalidateQueries({ queryKey: ['alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const compareSeries = useMemo(() => {
    if (!comparison.data) return []
    return comparison.data.watchlists
      .filter((item) => item.dates?.length)
      .map((item, index) => ({
        name: item.name,
        color: ['#8b5cf6', '#22d3ee', '#34e0a1', '#fbbf24'][index % 4],
        values: item.values,
      }))
  }, [comparison.data])

  const move = (index: number, direction: -1 | 1) => {
    if (!selected) return
    const symbols = selected.items.map((item) => item.symbol)
    const target = index + direction
    if (target < 0 || target >= symbols.length) return
    ;[symbols[index], symbols[target]] = [symbols[target], symbols[index]]
    reorder.mutate(symbols)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Monitoring"
        title="Watchlists & alerts"
        description="Market movement, equal-weight watchlist indices, and periodic threshold alerts. Delayed data is not a streaming feed."
        actions={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => void watchlists.refetch()} disabled={watchlists.isFetching}><RefreshCw className={cn('h-3.5 w-3.5', watchlists.isFetching && 'animate-spin')} /> Refresh</button>
            <button className="btn btn-primary btn-sm" onClick={() => setNewListOpen(true)}><Plus className="h-3.5 w-3.5" /> New watchlist</button>
          </>
        }
      />

      <Tabs
        tabs={[
          { value: 'watchlists', label: 'Watchlists', count: watchlists.data?.watchlists.length },
          { value: 'alerts', label: 'Alerts & notifications', count: alerts.data?.alerts.length },
        ]}
        value={tab}
        onChange={(next) => setTab(next)}
      />

      {tab === 'watchlists' ? (
        <>
          {watchlists.isLoading ? (
            <LoadingPanel rows={6} />
          ) : watchlists.isError ? (
            <ErrorState message={watchlists.error instanceof Error ? watchlists.error.message : 'Watchlists unavailable'} onRetry={() => void watchlists.refetch()} />
          ) : !watchlists.data?.watchlists.length ? (
            <div className="panel"><EmptyState title="No watchlists" description="Create a list to monitor delayed movement and evaluate equal-weight performance." icon={<ListChecks className="h-5 w-5" />} action={<Button size="sm" variant="primary" onClick={() => setNewListOpen(true)}>Create watchlist</Button>} /></div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {watchlists.data.watchlists.map((list) => (
                  <button
                    key={list.id}
                    onClick={() => setSelectedId(list.id)}
                    className={cn('rounded-lg border px-2.5 py-1.5 text-[10.5px] transition', selectedId === list.id ? 'border-violet-400/30 bg-violet-500/[0.08] text-white' : 'border-white/[0.06] text-mutedx hover:border-white/15')}
                  >
                    {list.name} <span className="ml-1 font-mono text-[8px] text-dimx">{list.items.length}</span>
                    {list.is_default && <Star className="ml-1 inline h-2.5 w-2.5 text-warn" />}
                  </button>
                ))}
                <button className="chip hover:border-white/25 hover:text-white" onClick={() => setCompareOpen(true)} disabled={(watchlists.data.watchlists.length ?? 0) < 2}><GitCompareArrows className="h-2.5 w-2.5" /> Compare lists</button>
              </div>

              {selected && (
                <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
                  <section className="panel overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
                      <div>
                        <div className="eyebrow mb-0.5">Watchlist</div>
                        <div className="flex items-center gap-2 text-[13px] text-white">{selected.name} {selected.is_default && <Badge tone="warn">default</Badge>}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!selected.is_default && <button className="btn btn-ghost btn-sm" onClick={() => makeDefault.mutate()}><Star className="h-3 w-3" /> Make default</button>}
                        <button className="btn btn-ghost btn-sm text-dimx hover:text-loss" onClick={() => { if (window.confirm(`Delete "${selected.name}"?`)) deleteList.mutate() }} aria-label="Delete watchlist"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-end gap-2 border-b border-white/[0.05] px-4 py-3">
                      <Field label="Add symbol" className="w-28"><Input value={itemSymbol} onChange={(event) => setItemSymbol(event.target.value.toUpperCase())} className="h-8 font-mono text-[10px]" placeholder="AAPL" /></Field>
                      <Field label="Note" className="flex-1"><Input value={itemNote} onChange={(event) => setItemNote(event.target.value)} className="h-8 text-[10px]" placeholder="optional" maxLength={500} /></Field>
                      <Button size="sm" variant="outline" loading={addItem.isPending} disabled={!itemSymbol.trim()} onClick={() => addItem.mutate()}>Add</Button>
                    </div>
                    {selected.items.length === 0 ? (
                      <EmptyState title="Empty watchlist" description="Add symbols above. The default watchlist is used by quick-add actions elsewhere." />
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="data-table min-w-[580px]">
                          <thead><tr><th>Symbol</th><th className="text-right">Last</th><th className="text-right">1D</th><th className="text-right">As of</th><th>Note</th><th className="text-right">Order</th><th /></tr></thead>
                          <tbody>
                            {selected.items.map((item, index) => (
                              <tr key={item.symbol}>
                                <td><Link to={`/app/research/${encodeURIComponent(item.symbol)}`} className="font-mono text-[11px] text-white hover:text-violet-300">{item.symbol}</Link></td>
                                <td className="num text-right text-white">{item.quote ? fmtNumber(item.quote.price, 2) : '—'}</td>
                                <td className={cn('num text-right', pctClass(item.quote?.change_pct))}>{item.quote ? fmtPct(item.quote.change_pct) : '—'}</td>
                                <td className="text-right font-mono text-[8.5px] text-dimx">{item.quote?.as_of ?? item.quote?.data_status ?? '—'}</td>
                                <td className="max-w-[150px] truncate text-[10px] text-dimx">{item.note || '—'}</td>
                                <td className="text-right">
                                  <div className="flex justify-end gap-0.5">
                                    <button onClick={() => move(index, -1)} disabled={index === 0} className="rounded p-1 text-dimx hover:text-white disabled:opacity-20" aria-label="Move up"><ArrowUp className="h-3 w-3" /></button>
                                    <button onClick={() => move(index, 1)} disabled={index === selected.items.length - 1} className="rounded p-1 text-dimx hover:text-white disabled:opacity-20" aria-label="Move down"><ArrowDown className="h-3 w-3" /></button>
                                  </div>
                                </td>
                                <td className="text-right"><button onClick={() => removeItem.mutate(item.symbol)} className="rounded p-1 text-dimx hover:text-loss" aria-label={`Remove ${item.symbol}`}><Trash2 className="h-3 w-3" /></button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  <div className="space-y-4">
                    <section className="panel p-4">
                      <SectionTitle
                        eyebrow="Equal-weight index"
                        title="Watchlist performance"
                        action={
                          <select className="select h-7 w-16 py-0 font-mono text-[9px]" value={period} onChange={(event) => setPeriod(event.target.value)}>
                            {['6mo', '1y', '2y', '3y', '5y'].map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}
                          </select>
                        }
                      />
                      {!selected.items.length ? (
                        <div className="py-8 text-center text-[11px] text-dimx">Add symbols to compute a watchlist index.</div>
                      ) : performance.isLoading ? (
                        <div className="skeleton h-[220px] w-full" />
                      ) : performance.isError ? (
                        <ErrorState message={performance.error instanceof Error ? performance.error.message : 'Performance unavailable'} onRetry={() => void performance.refetch()} />
                      ) : performance.data ? (
                        <>
                          <div className="mb-2 flex items-end justify-between">
                            <div className={cn('num text-[22px]', pctClass(performance.data.cumulative_return_pct))}>{fmtPct(performance.data.cumulative_return_pct)}</div>
                            <div className="font-mono text-[8.5px] text-dimx">{performance.data.observations} observations</div>
                          </div>
                          <MarketLineChart
                            dates={performance.data.dates}
                            series={[{ name: 'Equal-weight watchlist', color: '#22d3ee', values: performance.data.values }]}
                            height={220}
                            reference={100}
                            valueFormatter={(value) => value.toFixed(0)}
                          />
                          <div className="mt-2 text-[9px] leading-relaxed text-dimx">{performance.data.method} Watchlist performance is not your portfolio return.</div>
                          {performance.data.failed.length > 0 && <div className="mt-1 text-[9px] text-warn">{performance.data.failed.length} symbols excluded for missing history.</div>}
                        </>
                      ) : null}
                    </section>

                    <section className="panel p-4">
                      <SectionTitle eyebrow="Monitoring" title="Quick alert" />
                      <div className="space-y-2">
                        <Input value={alertSymbol} onChange={(event) => setAlertSymbol(event.target.value.toUpperCase())} placeholder="Symbol (e.g. AAPL)" className="font-mono" />
                        <div className="grid grid-cols-2 gap-2">
                          <Select value={alertKind} onChange={(event) => setAlertKind(event.target.value)}>
                            <option value="price_above">Price above</option>
                            <option value="price_below">Price below</option>
                            <option value="pct_move">Abs % move</option>
                            <option value="rsi_above">RSI above</option>
                            <option value="rsi_below">RSI below</option>
                          </Select>
                          <Input type="number" step="0.01" value={alertThreshold} onChange={(event) => setAlertThreshold(event.target.value)} placeholder="Threshold" />
                        </div>
                        <Button size="sm" variant="outline" className="w-full" loading={createAlert.isPending} disabled={!alertSymbol.trim() || !alertThreshold} onClick={() => createAlert.mutate()} icon={<BellPlus className="h-3 w-3" />}>Create alert</Button>
                      </div>
                      <div className="mt-2 text-[9px] leading-relaxed text-dimx">Alerts fire on a periodic job using delayed quotes. No instant delivery is promised.</div>
                    </section>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[1.3fr_1fr]">
          <div className="space-y-4">
          <section className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
              <div>
                <div className="eyebrow mb-0.5">Alert rules</div>
                <div className="text-[13px] text-white">Persistent monitoring</div>
              </div>
              <Button size="sm" variant="outline" loading={checkAlerts.isPending} onClick={() => checkAlerts.mutate()} icon={<CheckCheck className="h-3 w-3" />}>Check now</Button>
            </div>
            {alerts.isLoading ? (
              <div className="p-4"><LoadingPanel rows={5} /></div>
            ) : alerts.isError ? (
              <ErrorState message={alerts.error instanceof Error ? alerts.error.message : 'Alerts unavailable'} onRetry={() => void alerts.refetch()} />
            ) : !alerts.data?.alerts.length ? (
              <EmptyState title="No alerts" description="Create a threshold alert from any watchlist or the research terminal. Evaluation is periodic, not streaming." icon={<BellPlus className="h-5 w-5" />} />
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table min-w-[680px]">
                  <thead><tr><th>Symbol</th><th>Condition</th><th className="text-right">Threshold</th><th>Active</th><th>Last fired</th><th /></tr></thead>
                  <tbody>
                    {alerts.data.alerts.map((alert) => (
                      <tr key={alert.id}>
                        <td><Link to={`/app/research/${encodeURIComponent(alert.symbol)}`} className="font-mono text-[11px] text-white hover:text-violet-300">{alert.symbol}</Link></td>
                        <td className="text-[10.5px] text-mutedx">{alert.kind.replace(/_/g, ' ')}</td>
                        <td className="num text-right text-mutedx">{alert.threshold !== null ? fmtNumber(alert.threshold, 2) : '—'}</td>
                        <td><Toggle checked={alert.is_active} onChange={(value) => updateAlert.mutate({ id: alert.id, is_active: value })} ariaLabel={`${alert.symbol} alert active`} /></td>
                        <td className="font-mono text-[9px] text-dimx">{alert.last_fired_at ? relativeTime(alert.last_fired_at) : 'never'}</td>
                        <td className="text-right"><button onClick={() => deleteAlert.mutate(alert.id)} className="rounded p-1 text-dimx hover:text-loss" aria-label={`Delete alert ${alert.id}`}><Trash2 className="h-3 w-3" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="border-t border-white/[0.05] px-4 py-2 text-[9px] text-dimx">{alerts.data?.monitoring.note ?? 'Alerts are evaluated periodically.'}</div>
          </section>

          <section className="panel p-4">
            <SectionTitle eyebrow="History" title="Triggered events" />
            {alerts.data?.events.length ? (
              <div className="space-y-2">
                {alerts.data.events.slice(0, 12).map((event) => (
                  <div key={event.id} className="border-b border-white/[0.05] pb-2 last:border-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[10.5px] leading-relaxed text-mutedx">{event.message}</span>
                      <span className="shrink-0 font-mono text-[8px] text-dimx">{fmtDateTime(event.triggered_at)}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[8px] text-dimx">{String(event.data.data_status ?? '')} · {String(event.data.provider ?? '')}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-[11px] text-dimx">No alert events yet.</div>
            )}
          </section>
          </div>

          <div className="space-y-4">
            <section className="panel p-4">
              <SectionTitle eyebrow="Create alert" title="New rule" />
              <div className="space-y-2.5">
                <Field label="Symbol"><Input value={alertSymbol} onChange={(event) => setAlertSymbol(event.target.value.toUpperCase())} placeholder="AAPL" className="font-mono" /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Condition">
                    <Select value={alertKind} onChange={(event) => setAlertKind(event.target.value)}>
                      <option value="price_above">Price above</option>
                      <option value="price_below">Price below</option>
                      <option value="pct_move">Absolute % move</option>
                      <option value="rsi_above">RSI above</option>
                      <option value="rsi_below">RSI below</option>
                    </Select>
                  </Field>
                  <Field label="Threshold"><Input type="number" step="0.01" value={alertThreshold} onChange={(event) => setAlertThreshold(event.target.value)} /></Field>
                </div>
                <Field label="Cooldown (minutes)" hint="Minimum gap between firings."><Input type="number" min="5" max="1440" value={alertCooldown} onChange={(event) => setAlertCooldown(event.target.value)} /></Field>
                <Button variant="primary" className="w-full" loading={createAlert.isPending} disabled={!alertSymbol.trim() || !alertThreshold} onClick={() => createAlert.mutate()} icon={<BellPlus className="h-3.5 w-3.5" />}>Create alert</Button>
              </div>
              <Callout tone="warn" title="No instant promises">
                Evaluation requires the server scheduler or an explicit check. A threshold can be crossed between checks. Cooldowns prevent duplicate firing.
              </Callout>
            </section>

          </div>
        </div>
      )}

      <Modal
        open={newListOpen}
        onClose={() => setNewListOpen(false)}
        title="New watchlist"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setNewListOpen(false)}>Cancel</button>
            <Button variant="primary" disabled={!listName.trim()} loading={createList.isPending} onClick={() => createList.mutate()}>Create</Button>
          </>
        }
      >
        <Field label="Name"><Input value={listName} onChange={(event) => setListName(event.target.value)} maxLength={80} /></Field>
      </Modal>

      <Modal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        title="Compare watchlists"
        description="Equal-weight daily rebalanced indices. Comparison is descriptive, not a portfolio recommendation."
        wide
        footer={<button className="btn btn-ghost" onClick={() => setCompareOpen(false)}>Close</button>}
      >
        <div className="mb-3 flex flex-wrap gap-2">
          {watchlists.data?.watchlists.map((list) => (
            <button
              key={list.id}
              onClick={() => setCompareIds((current) => current.includes(list.id) ? current.filter((id) => id !== list.id) : [...current, list.id].slice(0, 4))}
              className={cn('chip', compareIds.includes(list.id) && 'chip-violet')}
            >
              {list.name}
            </button>
          ))}
        </div>
        {compareIds.length < 2 ? (
          <div className="py-8 text-center text-[11px] text-dimx">Select at least two watchlists.</div>
        ) : comparison.isLoading ? (
          <LoadingPanel rows={4} />
        ) : comparison.isError ? (
          <ErrorState message={comparison.error instanceof Error ? comparison.error.message : 'Comparison unavailable'} />
        ) : comparison.data ? (
          <MarketLineChart
            dates={comparison.data.watchlists.find((item) => item.dates?.length)?.dates ?? []}
            series={compareSeries}
            height={300}
            reference={100}
            valueFormatter={(value) => value.toFixed(0)}
          />
        ) : null}
      </Modal>
    </div>
  )
}
