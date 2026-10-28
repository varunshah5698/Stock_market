import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  BarChart3,
  Copy,
  FlaskConical,
  Gauge,
  History,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Badge, Button, Callout, EmptyState, ErrorState, Field, Input, LoadingPanel, Modal, PageHeader, SectionTitle, Select, StatusPill, Tabs } from '../components/ui'
import { api, del, errorMessage, post, put } from '../lib/api'
import { cn, fmtDateTime, fmtNumber, fmtPct, relativeTime } from '../lib/format'
import { useDocumentTitle } from '../lib/hooks'
import { useToasts } from '../store/ui'
import type { BacktestSummary, Strategy, StrategyRule, StrategyRules } from '../lib/types'

const INDICATORS: { value: string; label: string; window?: boolean; defaultValue: number }[] = [
  { value: 'price', label: 'Price', defaultValue: 100 },
  { value: 'price_vs_sma', label: 'Price vs SMA', window: true, defaultValue: 0 },
  { value: 'sma', label: 'SMA', window: true, defaultValue: 100 },
  { value: 'ema', label: 'EMA', window: true, defaultValue: 100 },
  { value: 'rsi', label: 'RSI', window: true, defaultValue: 30 },
  { value: 'macd_hist', label: 'MACD histogram', defaultValue: 0 },
  { value: 'bb_pctb', label: 'Bollinger %B', window: true, defaultValue: 0.1 },
  { value: 'atr_pct', label: 'ATR %', window: true, defaultValue: 3 },
  { value: 'momentum', label: 'Momentum', window: true, defaultValue: 0.05 },
  { value: 'breakout_high', label: 'Breakout distance', window: true, defaultValue: 0 },
  { value: 'volatility', label: 'Realized volatility', window: true, defaultValue: 0.35 },
  { value: 'volume_ratio', label: 'Volume ratio', defaultValue: 0 },
]

const OPERATORS = [
  { value: '>', label: '>' },
  { value: '>=', label: '≥' },
  { value: '<', label: '<' },
  { value: '<=', label: '≤' },
  { value: 'cross_above', label: 'crosses above' },
  { value: 'cross_below', label: 'crosses below' },
]

type Tab = 'strategies' | 'backtests'

interface StrategyList {
  strategies: Strategy[]
  templates_available: number
}

interface BacktestList {
  backtests: BacktestSummary[]
  pagination: { page: number; page_size: number; total: number; pages: number }
}

interface Preview {
  signal_days: { entry: number; exit: number }
  markers: { date: string; type: string }[]
  latest_signal: string
  data: { start: string; end: string; provider: string; status: string }
  warnings: string[]
}

function cloneRules(rules: StrategyRules): StrategyRules {
  return JSON.parse(JSON.stringify(rules)) as StrategyRules
}

function newRule(): StrategyRule {
  return { indicator: 'price_vs_sma', op: '>', value: 0, params: { window: 50 } }
}

function ruleLabel(rule: StrategyRule) {
  const meta = INDICATORS.find((item) => item.value === rule.indicator)
  const label = meta?.label ?? rule.indicator
  const window = rule.params?.window ? `(${rule.params.window})` : ''
  const operator = OPERATORS.find((item) => item.value === rule.op)?.label ?? rule.op
  return `${label}${window} ${operator} ${rule.value ?? '—'}`
}

export default function Strategies() {
  useDocumentTitle('Strategy lab')
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') === 'backtests' ? 'backtests' : 'strategies') as Tab
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToasts((state) => state.push)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ name: string; description: string; rules: StrategyRules } | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewSymbol, setPreviewSymbol] = useState('AAPL')
  const [backtestOpen, setBacktestOpen] = useState(false)
  const [backtestSymbol, setBacktestSymbol] = useState('AAPL')
  const [benchmark, setBenchmark] = useState('SPY')
  const [period, setPeriod] = useState('5y')
  const [capital, setCapital] = useState('100000')
  const [commission, setCommission] = useState('2')
  const [slippage, setSlippage] = useState('5')
  const [spread, setSpread] = useState('0')

  const strategies = useQuery<StrategyList>({
    queryKey: ['strategies'],
    queryFn: () => api('/api/v1/strategies'),
  })

  const backtests = useQuery<BacktestList>({
    queryKey: ['backtests'],
    queryFn: () => api('/api/v1/backtests?page_size=30'),
    refetchInterval: 5000,
  })

  const selected = strategies.data?.strategies.find((strategy) => strategy.id === selectedId) ?? null

  const baseline = useMemo(() => {
    if (!selected) return null
    return JSON.stringify({ name: selected.name, description: selected.description, rules: selected.rules })
  }, [selected])

  const dirty = Boolean(draft && baseline && JSON.stringify(draft) !== baseline)

  useEffect(() => {
    if (!strategies.data || selectedId) return
    const first = strategies.data.strategies.find((strategy) => !strategy.is_template) ?? strategies.data.strategies[0]
    if (first) {
      setSelectedId(first.id)
      setDraft({ name: first.name, description: first.description, rules: cloneRules(first.rules) })
      setIsNew(false)
    }
  }, [strategies.data, selectedId])

  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const selectStrategy = (strategy: Strategy) => {
    if (dirty && !window.confirm('Discard unsaved strategy changes?')) return
    setSelectedId(strategy.id)
    setDraft({ name: strategy.name, description: strategy.description, rules: cloneRules(strategy.rules) })
    setIsNew(false)
    setPreview(null)
  }

  const startNew = () => {
    if (dirty && !window.confirm('Discard unsaved strategy changes?')) return
    setSelectedId(null)
    setIsNew(true)
    setDraft({
      name: 'New strategy',
      description: '',
      rules: {
        entry: [newRule()],
        exit: [{ indicator: 'price_vs_sma', op: '<', value: -0.02, params: { window: 50 } }],
        entry_logic: 'all',
        exit_logic: 'any',
        stop_loss_pct: 10,
        take_profit_pct: null,
        max_holding_days: null,
        position_size_pct: 100,
      },
    })
    setPreview(null)
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('Nothing to save')
      const payload = { name: draft.name, description: draft.description, rules: draft.rules }
      if (isNew || !selected || selected.is_template) return post<Strategy>('/api/v1/strategies', payload)
      return put<Strategy>(`/api/v1/strategies/${selected.id}`, payload)
    },
    onSuccess: (saved) => {
      toast('Strategy saved', 'success')
      setSelectedId(saved.id)
      setIsNew(false)
      setDraft({ name: saved.name, description: saved.description, rules: cloneRules(saved.rules) })
      void queryClient.invalidateQueries({ queryKey: ['strategies'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/v1/strategies/${id}`),
    onSuccess: () => {
      toast('Strategy deleted', 'success')
      setSelectedId(null)
      setDraft(null)
      void queryClient.invalidateQueries({ queryKey: ['strategies'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const clone = useMutation({
    mutationFn: (id: string) => post<Strategy>(`/api/v1/strategies/${id}/clone`),
    onSuccess: (copy) => {
      toast('Strategy cloned', 'success')
      setSelectedId(copy.id)
      setDraft({ name: copy.name, description: copy.description, rules: cloneRules(copy.rules) })
      setIsNew(false)
      void queryClient.invalidateQueries({ queryKey: ['strategies'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const loadPreview = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error('Save the strategy before previewing signals')
      return api<Preview>(`/api/v1/strategies/${selectedId}/preview?symbol=${encodeURIComponent(previewSymbol)}&period=2y`)
    },
    onSuccess: setPreview,
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const runBacktest = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error('Save the strategy before running a backtest')
      return post<{ backtest: { id: string } }>('/api/v1/backtests', {
        strategy_id: selectedId,
        symbol: backtestSymbol,
        benchmark,
        period,
        initial_capital: Number(capital),
        commission_bps: Number(commission),
        slippage_bps: Number(slippage),
        spread_bps: Number(spread),
      })
    },
    onSuccess: (data) => {
      setBacktestOpen(false)
      toast('Backtest queued', 'success')
      void queryClient.invalidateQueries({ queryKey: ['backtests'] })
      navigate(`/app/backtests/${data.backtest.id}`)
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const setTab = (next: Tab) => {
    const nextParams = new URLSearchParams(params)
    nextParams.set('tab', next)
    setParams(nextParams, { replace: true })
  }

  const updateRules = (patch: Partial<StrategyRules>) => {
    if (!draft) return
    setDraft({ ...draft, rules: { ...draft.rules, ...patch } })
  }

  const updateRule = (group: 'entry' | 'exit', index: number, patch: Partial<StrategyRule>) => {
    if (!draft) return
    const next = draft.rules[group].map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule))
    updateRules({ [group]: next } as Partial<StrategyRules>)
  }

  const addRule = (group: 'entry' | 'exit') => {
    if (!draft) return
    updateRules({ [group]: [...draft.rules[group], newRule()] } as Partial<StrategyRules>)
  }

  const removeRule = (group: 'entry' | 'exit', index: number) => {
    if (!draft) return
    if (group === 'entry' && draft.rules.entry.length <= 1) {
      toast('A strategy needs at least one entry rule', 'warning')
      return
    }
    updateRules({ [group]: draft.rules[group].filter((_, ruleIndex) => ruleIndex !== index) } as Partial<StrategyRules>)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Quantitative strategy laboratory"
        title="Strategy lab"
        description="Compose explicit rules, preview signals, then simulate with next-open execution and explicit costs. No hidden parameter changes."
        actions={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => void strategies.refetch()} disabled={strategies.isFetching}><RefreshCw className={cn('h-3.5 w-3.5', strategies.isFetching && 'animate-spin')} /> Refresh</button>
            <button className="btn btn-primary btn-sm" onClick={startNew}><Plus className="h-3.5 w-3.5" /> New strategy</button>
          </>
        }
      />

      <Tabs
        tabs={[
          { value: 'strategies', label: 'Strategies', count: strategies.data?.strategies.length },
          { value: 'backtests', label: 'Backtests', count: backtests.data?.pagination.total },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'backtests' ? (
        <section className="panel overflow-hidden">
          <div className="border-b border-white/[0.06] px-4 py-3">
            <div className="eyebrow mb-0.5">Historical simulations</div>
            <div className="text-[13px] text-white">Stored backtest reports</div>
          </div>
          {backtests.isLoading ? (
            <div className="p-4"><LoadingPanel rows={6} /></div>
          ) : backtests.isError ? (
            <div className="p-4"><ErrorState message={backtests.error instanceof Error ? backtests.error.message : 'Backtests unavailable'} onRetry={() => void backtests.refetch()} /></div>
          ) : !backtests.data?.backtests.length ? (
            <EmptyState title="No backtests yet" description="Configure a strategy, then run a historical simulation. Every report keeps its cost and execution assumptions." icon={<History className="h-5 w-5" />} action={<button className="btn btn-outline btn-sm" onClick={() => setTab('strategies')}>Open strategies</button>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[980px]">
                <thead><tr><th>Run</th><th>Strategy</th><th>Status</th><th className="text-right">Total return</th><th className="text-right">Sharpe</th><th className="text-right">Max DD</th><th className="text-right">Costs</th><th>Created</th><th /></tr></thead>
                <tbody>
                  {backtests.data.backtests.map((backtest) => {
                    const metrics = backtest.metrics as Record<string, number | null>
                    return (
                      <tr key={backtest.id}>
                        <td><Link to={`/app/backtests/${backtest.id}`} className="font-mono text-[11px] text-white hover:text-violet-300">{backtest.symbol}</Link><div className="font-mono text-[8px] text-dimx">{backtest.id.slice(0, 8)}</div></td>
                        <td className="max-w-[160px] truncate text-[10.5px] text-mutedx">{backtest.strategy_name}</td>
                        <td><StatusPill status={backtest.status} /></td>
                        <td className={cn('num text-right', (metrics?.total_return ?? 0) >= 0 ? 'text-gain' : 'text-loss')}>{metrics?.total_return !== null && metrics?.total_return !== undefined ? fmtPct(metrics.total_return * 100) : '—'}</td>
                        <td className="num text-right text-mutedx">{metrics?.sharpe_rf_zero !== null && metrics?.sharpe_rf_zero !== undefined ? fmtNumber(metrics.sharpe_rf_zero, 2) : '—'}</td>
                        <td className="num text-right text-loss">{metrics?.max_drawdown !== null && metrics?.max_drawdown !== undefined ? fmtPct(metrics.max_drawdown * 100) : '—'}</td>
                        <td className="num text-right text-dimx">{metrics?.total_fees !== null && metrics?.total_fees !== undefined ? fmtNumber(metrics.total_fees, 2) : '—'}</td>
                        <td className="font-mono text-[9px] text-dimx">{relativeTime(backtest.created_at)}</td>
                        <td className="text-right"><Link to={`/app/backtests/${backtest.id}`} className="text-dimx hover:text-white" aria-label="Open backtest"><ArrowRight className="h-3.5 w-3.5" /></Link></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-white/[0.05] px-4 py-2 text-[9px] text-dimx">Backtests are historical simulations after modeled costs. They are not live performance, forecasts, or proof of future returns.</div>
        </section>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
          <aside className="panel h-fit overflow-hidden">
            <div className="border-b border-white/[0.06] px-3 py-2.5">
              <div className="eyebrow">Library</div>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-2">
              {(strategies.data?.strategies ?? []).map((strategy) => (
                <button
                  key={strategy.id}
                  onClick={() => selectStrategy(strategy)}
                  className={cn(
                    'mb-1 w-full rounded-lg border p-2.5 text-left transition',
                    selectedId === strategy.id ? 'border-violet-400/30 bg-violet-500/[0.06]' : 'border-transparent hover:border-white/10 hover:bg-white/[0.03]',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[11px] leading-snug text-white">{strategy.name}</span>
                    {strategy.is_template && <Badge tone="violet">template</Badge>}
                  </div>
                  <div className="mt-1 flex items-center gap-2 font-mono text-[8.5px] text-dimx">
                    <span>v{strategy.version}</span>
                    <span>·</span>
                    <span>{strategy.rules.entry.length} entry / {strategy.rules.exit.length} exit</span>
                  </div>
                </button>
              ))}
              {!strategies.data?.strategies.length && <div className="px-2 py-6 text-center text-[10.5px] text-dimx">No strategies yet.</div>}
            </div>
          </aside>

          {strategies.isLoading ? (
            <LoadingPanel rows={8} />
          ) : strategies.isError ? (
            <ErrorState message={strategies.error instanceof Error ? strategies.error.message : 'Strategies unavailable'} onRetry={() => void strategies.refetch()} />
          ) : !draft ? (
            <div className="panel"><EmptyState title="Select or create a strategy" description="Templates are provided, but they are starting points — not recommendations." action={<button className="btn btn-primary btn-sm" onClick={startNew}>New strategy</button>} /></div>
          ) : (
            <section className="panel overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] p-4">
                <div className="min-w-0 flex-1">
                  <input
                    className="display w-full border-0 bg-transparent p-0 text-[20px] font-semibold text-white outline-none focus:ring-0"
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    maxLength={120}
                    aria-label="Strategy name"
                  />
                  <input
                    className="mt-1 w-full border-0 bg-transparent p-0 text-[11px] text-mutedx outline-none focus:ring-0"
                    value={draft.description}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                    placeholder="Describe the hypothesis this strategy tests…"
                    maxLength={500}
                    aria-label="Strategy description"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {selected?.is_template && <Badge tone="violet">template</Badge>}
                  {dirty && <Badge tone="warn">unsaved</Badge>}
                  <Button size="sm" variant="outline" onClick={() => clone.mutate(selectedId!)} disabled={!selectedId || clone.isPending} icon={<Copy className="h-3 w-3" />}>Clone</Button>
                  <Button size="sm" variant="outline" loading={save.isPending} onClick={() => save.mutate()} icon={<Save className="h-3 w-3" />}>
                    {isNew || selected?.is_template ? 'Save as new' : 'Save'}
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => setBacktestOpen(true)} disabled={!selectedId || dirty} icon={<Play className="h-3 w-3" />}>Run backtest</Button>
                  {selected && !selected.is_template && (
                    <button
                      className="btn btn-ghost btn-sm text-dimx hover:text-loss"
                      onClick={() => {
                        if (window.confirm(`Delete "${selected.name}"? Stored backtests referencing it will also be removed.`)) remove.mutate(selected.id)
                      }}
                      aria-label="Delete strategy"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-4 p-4">
                <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 font-mono text-[9.5px] leading-relaxed text-dimx">
                  <span className="text-violet-400">IF</span> {draft.rules.entry_logic === 'all' ? 'ALL' : 'ANY'} entry conditions hold at the close{' '}
                  <span className="text-violet-400">THEN</span> buy at the next open. Exit when {draft.rules.exit_logic === 'all' ? 'ALL' : 'ANY'} exit conditions hold, or a risk condition triggers.
                </div>

                {(['entry', 'exit'] as const).map((group) => (
                  <div key={group}>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={cn('rounded px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wider', group === 'entry' ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss')}>{group}</span>
                        <div className="flex rounded border border-white/[0.08] p-0.5">
                          {(['all', 'any'] as const).map((logic) => (
                            <button
                              key={logic}
                              onClick={() => updateRules({ [`${group}_logic`]: logic } as Partial<StrategyRules>)}
                              className={cn('rounded px-1.5 py-0.5 font-mono text-[8px] uppercase', draft.rules[`${group}_logic`] === logic ? 'bg-white/[0.08] text-white' : 'text-dimx')}
                            >
                              {logic}
                            </button>
                          ))}
                        </div>
                      </div>
                      <button onClick={() => addRule(group)} className="flex items-center gap-1 text-[9px] text-violet-400 hover:text-white"><Plus className="h-3 w-3" /> Add rule</button>
                    </div>
                    <div className="space-y-1.5">
                      {draft.rules[group].map((rule, index) => {
                        const indicator = INDICATORS.find((item) => item.value === rule.indicator)
                        return (
                          <div key={`${group}-${index}`} className="grid gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.015] p-2 sm:grid-cols-[1.3fr_0.9fr_0.8fr_0.7fr_auto]">
                            <select
                              className="select py-1.5 text-[10.5px]"
                              value={rule.indicator}
                              onChange={(event) => {
                                const meta = INDICATORS.find((item) => item.value === event.target.value)
                                updateRule(group, index, {
                                  indicator: event.target.value,
                                  value: meta?.defaultValue ?? 0,
                                  params: meta?.window ? { window: rule.params?.window ?? 20 } : {},
                                })
                              }}
                              aria-label={`${group} indicator`}
                            >
                              {INDICATORS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                            </select>
                            <select className="select py-1.5 text-[10.5px]" value={rule.op} onChange={(event) => updateRule(group, index, { op: event.target.value })} aria-label={`${group} operator`}>
                              {OPERATORS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                            </select>
                            <input
                              className="input py-1.5 text-[10.5px]"
                              type="number"
                              step="any"
                              value={rule.value ?? ''}
                              onChange={(event) => updateRule(group, index, { value: event.target.value === '' ? null : Number(event.target.value) })}
                              aria-label={`${group} threshold`}
                            />
                            {indicator?.window ? (
                              <input
                                className="input py-1.5 text-[10.5px]"
                                type="number"
                                min="2"
                                max="300"
                                value={rule.params?.window ?? 20}
                                onChange={(event) => updateRule(group, index, { params: { ...rule.params, window: Number(event.target.value) } })}
                                aria-label={`${group} window`}
                                placeholder="window"
                              />
                            ) : (
                              <div className="flex items-center justify-center font-mono text-[8px] text-dimx">no window</div>
                            )}
                            <button onClick={() => removeRule(group, index)} className="rounded p-1.5 text-dimx hover:bg-white/5 hover:text-loss" aria-label={`Remove ${group} rule`}><Trash2 className="h-3 w-3" /></button>
                          </div>
                        )
                      })}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {draft.rules[group].map((rule, index) => (
                        <span key={index} className="chip">{ruleLabel(rule)}</span>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="grid gap-3 border-t border-white/[0.06] pt-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Stop loss %" hint="Evaluated on closes; executed next open.">
                    <Input type="number" step="0.5" min="0.5" max="50" value={draft.rules.stop_loss_pct ?? ''} onChange={(event) => updateRules({ stop_loss_pct: event.target.value === '' ? null : Number(event.target.value) })} placeholder="none" />
                  </Field>
                  <Field label="Take profit %" hint="Optional. Gap risk remains.">
                    <Input type="number" step="0.5" min="0.5" max="200" value={draft.rules.take_profit_pct ?? ''} onChange={(event) => updateRules({ take_profit_pct: event.target.value === '' ? null : Number(event.target.value) })} placeholder="none" />
                  </Field>
                  <Field label="Max holding days" hint="Forced exit at next open.">
                    <Input type="number" min="1" max="500" value={draft.rules.max_holding_days ?? ''} onChange={(event) => updateRules({ max_holding_days: event.target.value === '' ? null : Number(event.target.value) })} placeholder="none" />
                  </Field>
                  <Field label="Position size %" hint="Of available cash, costs reserved.">
                    <Input type="number" min="1" max="100" value={draft.rules.position_size_pct ?? 100} onChange={(event) => updateRules({ position_size_pct: Number(event.target.value) })} />
                  </Field>
                </div>

                <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="eyebrow mb-0.5">Signal preview</div>
                      <div className="text-[11px] text-mutedx">Signals over the last two years. Not a backtest.</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Input className="h-8 w-28 font-mono text-[10px]" value={previewSymbol} onChange={(event) => setPreviewSymbol(event.target.value.toUpperCase())} aria-label="Preview symbol" />
                      <Button size="sm" variant="outline" loading={loadPreview.isPending} onClick={() => loadPreview.mutate()} disabled={!selectedId || dirty}>
                        Preview signals
                      </Button>
                    </div>
                  </div>
                  {(dirty || !selectedId) && <div className="mb-2 text-[9.5px] text-warn">Save the strategy before previewing or running it.</div>}
                  {preview && (
                    <div className="grid gap-2 sm:grid-cols-4">
                      <div className="rounded border border-white/[0.05] p-2"><div className="eyebrow">Entry days</div><div className="num mt-1 text-[14px] text-gain">{preview.signal_days.entry}</div></div>
                      <div className="rounded border border-white/[0.05] p-2"><div className="eyebrow">Exit days</div><div className="num mt-1 text-[14px] text-loss">{preview.signal_days.exit}</div></div>
                      <div className="rounded border border-white/[0.05] p-2"><div className="eyebrow">Latest signal</div><div className="mt-1 text-[11px] text-white">{preview.latest_signal}</div></div>
                      <div className="rounded border border-white/[0.05] p-2"><div className="eyebrow">Data</div><div className="mt-1 font-mono text-[8.5px] text-dimx">{preview.data.provider} · {preview.data.status}</div></div>
                      {preview.markers.length > 0 && (
                        <div className="sm:col-span-4">
                          <div className="mb-1 font-mono text-[8.5px] text-dimx">last signals: {preview.markers.slice(-8).map((marker) => `${marker.date} ${marker.type}`).join(' · ')}</div>
                          <div className="text-[8.5px] text-dimx">{preview.warnings.join(' ')}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      <Modal
        open={backtestOpen}
        onClose={() => setBacktestOpen(false)}
        title="Run historical backtest"
        description="Signals execute at the next open. Costs are charged on both sides. This is a simulation, not live performance."
        wide
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setBacktestOpen(false)}>Cancel</button>
            <Button variant="primary" loading={runBacktest.isPending} disabled={!selectedId || dirty || !backtestSymbol} onClick={() => runBacktest.mutate()}><Play className="h-3.5 w-3.5" /> Run backtest</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Instrument"><Input value={backtestSymbol} onChange={(event) => setBacktestSymbol(event.target.value.toUpperCase())} className="font-mono" /></Field>
          <Field label="Benchmark"><Input value={benchmark} onChange={(event) => setBenchmark(event.target.value.toUpperCase())} className="font-mono" /></Field>
          <Field label="History window">
            <Select value={period} onChange={(event) => setPeriod(event.target.value)}>
              {['1y', '2y', '3y', '5y', '10y', 'max'].map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}
            </Select>
          </Field>
          <Field label="Initial capital (USD)"><Input type="number" min="1000" value={capital} onChange={(event) => setCapital(event.target.value)} /></Field>
          <Field label="Commission (bps)"><Input type="number" min="0" value={commission} onChange={(event) => setCommission(event.target.value)} /></Field>
          <Field label="Slippage (bps)"><Input type="number" min="0" value={slippage} onChange={(event) => setSlippage(event.target.value)} /></Field>
          <Field label="Spread (bps)" hint="Half-spread is applied on each side."><Input type="number" min="0" value={spread} onChange={(event) => setSpread(event.target.value)} /></Field>
          <div className="sm:col-span-2">
            <Callout tone="warn">A high historical Sharpe ratio does not imply a repeatable edge. Check turnover, cost sensitivity and drawdown before drawing conclusions.</Callout>
          </div>
        </div>
      </Modal>
    </div>
  )
}
