import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BrainCircuit, ChevronRight, FlaskConical, Info, Play, Plus, RefreshCw, Search, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Badge, Button, Callout, EmptyState, ErrorState, Field, Input, LoadingPanel, PageHeader, Select, StatusPill, Tabs } from '../components/ui'
import { api, errorMessage, post } from '../lib/api'
import { cn, fmtDateTime, fmtNumber, fmtPct, pctClass, relativeTime } from '../lib/format'
import { useDocumentTitle, useDebounced } from '../lib/hooks'
import { useToasts } from '../store/ui'
import type { ExperimentSummary, MetricRecord } from '../lib/types'

interface ModelCatalog {
  available: { key: string; name: string; task: string; complexity: string; notes: string }[]
  defaults: { return: string[]; direction: string[] }
  feature_version: string
  features: Record<string, string>
  data_provider: string
  notes: string[]
}

interface ExperimentsResponse {
  experiments: ExperimentSummary[]
  pagination: { page: number; page_size: number; total: number; pages: number }
  note: string
}

type Tab = 'new' | 'experiments'

function metric(record: MetricRecord | null | undefined, key: string): number | null {
  if (!record) return null
  const value = record[key]
  return typeof value === 'number' ? value : null
}

function selectedScore(experiment: ExperimentSummary, phase: 'validation' | 'test') {
  const record = phase === 'validation' ? experiment.validation : experiment.test
  if (!record) return null
  return (experiment.config as { target?: string })?.target === 'direction'
    ? metric(record, 'balanced_accuracy')
    : metric(record, 'rmse')
}

export default function PredictionLab() {
  useDocumentTitle('Prediction lab')
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') === 'experiments' ? 'experiments' : 'new') as Tab
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToasts((state) => state.push)

  const [symbol, setSymbol] = useState(params.get('symbol')?.toUpperCase() ?? 'AAPL')
  const [symbolQuery, setSymbolQuery] = useState('')
  const debounced = useDebounced(symbolQuery, 250)
  const [horizon, setHorizon] = useState(5)
  const [target, setTarget] = useState<'return' | 'direction'>('return')
  const [period, setPeriod] = useState('5y')
  const [models, setModels] = useState<string[]>([])

  const catalog = useQuery<ModelCatalog>({
    queryKey: ['ml-models'],
    queryFn: () => api('/api/v1/ml/models'),
    staleTime: 300_000,
  })

  const experiments = useQuery<ExperimentsResponse>({
    queryKey: ['experiments', tab],
    queryFn: () => api('/api/v1/ml/experiments?page_size=25'),
    refetchInterval: 5000,
  })

  const search = useQuery<{ results: { symbol: string; name: string; exchange: string }[] }>({
    queryKey: ['symbol-search-lab', debounced],
    queryFn: () => api(`/api/v1/instruments/search?q=${encodeURIComponent(debounced)}&limit=6`),
    enabled: debounced.trim().length > 0,
    staleTime: 60_000,
  })

  const availableModels = useMemo(() => catalog.data?.available.filter((model) => model.task === target) ?? [], [catalog.data, target])

  useEffect(() => {
    if (!catalog.data) return
    setModels(catalog.data.defaults[target] ?? [])
  }, [catalog.data, target])

  const createExperiment = useMutation({
    mutationFn: () =>
      post<{ experiment: ExperimentSummary }>('/api/v1/ml/experiments', {
        symbol: symbol.trim().toUpperCase(),
        horizon,
        target,
        models,
        period,
        test_fraction: 0.2,
        validation_fraction: 0.2,
      }),
    onSuccess: (data) => {
      toast(`Experiment launched for ${symbol}`, 'success')
      void queryClient.invalidateQueries({ queryKey: ['experiments'] })
      navigate(`/app/experiments/${data.experiment.id}`)
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const setTab = (next: Tab) => {
    const nextParams = new URLSearchParams(params)
    nextParams.set('tab', next)
    setParams(nextParams, { replace: true })
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="AI prediction laboratory"
        title="Model laboratory"
        description="Chronological train, validation and test. Baselines first. The test block is scored once and never used for selection."
        actions={
          <>
            <Link to="/app/reliability" className="btn btn-outline btn-sm">Model reliability</Link>
            <Link to="/app/strategies" className="btn btn-outline btn-sm">Strategy lab</Link>
          </>
        }
      />

      <Tabs
        tabs={[
          { value: 'new', label: 'New experiment' },
          { value: 'experiments', label: 'Experiments', count: experiments.data?.pagination.total },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'experiments' ? (
        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
            <div>
              <div className="eyebrow mb-0.5">Experiment registry</div>
              <div className="text-[13px] text-white">Stored runs and validation audit</div>
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => void experiments.refetch()} disabled={experiments.isFetching}><RefreshCw className={cn('h-3.5 w-3.5', experiments.isFetching && 'animate-spin')} /> Refresh</button>
          </div>
          {experiments.isLoading ? (
            <div className="p-4"><LoadingPanel rows={6} /></div>
          ) : experiments.isError ? (
            <div className="p-4"><ErrorState message={experiments.error instanceof Error ? experiments.error.message : 'Experiments unavailable'} onRetry={() => void experiments.refetch()} /></div>
          ) : experiments.data?.experiments.length === 0 ? (
            <EmptyState title="No experiments yet" description="Configure a run in the New experiment tab. Training happens in a background worker thread." icon={<FlaskConical className="h-5 w-5" />} action={<button className="btn btn-primary btn-sm" onClick={() => setTab('new')}>Configure experiment</button>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[900px]">
                <thead><tr><th>Run</th><th>Status</th><th>Target</th><th>Selected model</th><th className="text-right">Validation</th><th className="text-right">Test</th><th className="text-right">Created</th><th /></tr></thead>
                <tbody>
                  {experiments.data?.experiments.map((experiment) => {
                    const targetValue = (experiment.config as { target?: string })?.target ?? 'return'
                    const val = selectedScore(experiment, 'validation')
                    const test = selectedScore(experiment, 'test')
                    return (
                      <tr key={experiment.id}>
                        <td><Link to={`/app/experiments/${experiment.id}`} className="font-mono text-[11px] text-white hover:text-violet-300">{experiment.symbol}</Link><div className="font-mono text-[8px] text-dimx">{experiment.id.slice(0, 8)}</div></td>
                        <td><StatusPill status={experiment.status} /></td>
                        <td><span className="text-[10.5px] text-mutedx">{targetValue === 'direction' ? 'direction' : 'return'} · h{String((experiment.config as { horizon?: number }).horizon ?? '—')}</span></td>
                        <td className="text-[10.5px] text-mutedx">{experiment.selected_model ?? '—'}</td>
                        <td className="num text-right text-white">{val !== null ? (targetValue === 'direction' ? `${(val * 100).toFixed(1)}%` : (val * 100).toFixed(3) + '%') : '—'}</td>
                        <td className={cn('num text-right', test !== null && targetValue === 'return' ? 'text-mutedx' : 'text-mutedx')}>{test !== null ? (targetValue === 'direction' ? `${(test * 100).toFixed(1)}%` : (test * 100).toFixed(3) + '%') : '—'}</td>
                        <td className="text-right font-mono text-[9px] text-dimx">{relativeTime(experiment.created_at)}</td>
                        <td className="text-right"><Link to={`/app/experiments/${experiment.id}`} className="text-dimx hover:text-white" aria-label="Open experiment"><ChevronRight className="h-3.5 w-3.5" /></Link></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-white/[0.05] px-4 py-2 text-[9px] leading-relaxed text-dimx">
            Validation drives selection. Test columns are an audit only; ranking experiments by test performance would invalidate the test window.
          </div>
        </section>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <section className="panel p-5">
            <div className="mb-5 flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 text-violet-400" />
              <h2 className="display text-[15px] text-white">Configure a run</h2>
              <span className="ml-auto font-mono text-[8.5px] text-dimx">{catalog.data?.feature_version ?? ''}</span>
            </div>
            <div className="space-y-4">
              <div>
                <label className="label" htmlFor="experiment-symbol">Instrument</label>
                <div className="relative">
                  <Input
                    id="experiment-symbol"
                    value={symbolQuery || symbol}
                    onChange={(event) => {
                      setSymbolQuery(event.target.value.toUpperCase())
                      setSymbol(event.target.value.toUpperCase())
                    }}
                    className="font-mono"
                    placeholder="AAPL or RELIANCE.NS"
                    aria-autocomplete="list"
                  />
                  <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dimx" />
                  {symbolQuery && search.data?.results.length ? (
                    <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-white/10 bg-ink-850 shadow-card">
                      {search.data.results.map((item) => (
                        <button
                          key={item.symbol}
                          className="flex w-full items-center justify-between px-3 py-2 text-left transition hover:bg-white/[0.05]"
                          onClick={() => {
                            setSymbol(item.symbol)
                            setSymbolQuery('')
                          }}
                        >
                          <span className="font-mono text-[10.5px] text-white">{item.symbol}</span>
                          <span className="max-w-[55%] truncate text-[9.5px] text-dimx">{item.name} · {item.exchange}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {['AAPL', 'MSFT', 'NVDA', 'RELIANCE.NS'].map((item) => (
                    <button key={item} onClick={() => { setSymbol(item); setSymbolQuery('') }} className="chip hover:border-white/25 hover:text-white">{item}</button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Prediction horizon" hint="Sessions ahead. Overlapping labels are purged.">
                  <Select value={horizon} onChange={(event) => setHorizon(Number(event.target.value))}>
                    {[1, 3, 5, 10, 20, 60].map((value) => <option key={value} value={value}>{value} session{value > 1 ? 's' : ''}</option>)}
                  </Select>
                </Field>
                <Field label="Target">
                  <Select value={target} onChange={(event) => setTarget(event.target.value as 'return' | 'direction')}>
                    <option value="return">Forward return</option>
                    <option value="direction">Direction (up/down)</option>
                  </Select>
                </Field>
              </div>

              <Field label="Training history" hint="Yahoo history may return fewer rows than requested for newer listings.">
                <Select value={period} onChange={(event) => setPeriod(event.target.value)}>
                  {['1y', '2y', '3y', '5y', '10y', 'max'].map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
                </Select>
              </Field>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="label mb-0">Candidate models</span>
                  <span className="font-mono text-[8.5px] text-dimx">{models.length} selected</span>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {availableModels.map((model) => (
                    <label key={model.key} className={cn('flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition', models.includes(model.key) ? 'border-violet-400/30 bg-violet-500/[0.06]' : 'border-white/[0.06] hover:border-white/15')} title={model.notes}>
                      <input
                        type="checkbox"
                        className="mt-0.5 h-3 w-3 accent-violet-500"
                        checked={models.includes(model.key)}
                        onChange={(event) =>
                          setModels((current) => event.target.checked ? [...current, model.key] : current.filter((item) => item !== model.key))
                        }
                      />
                      <span>
                        <span className="block text-[11px] text-white">{model.name}</span>
                        <span className="block font-mono text-[8.5px] uppercase tracking-wider text-dimx">{model.complexity} complexity</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <Callout tone="info" title="What happens on launch">
                A worker trains each candidate on the training block, scores it on validation, selects on validation only, refits on
                train + validation, and scores the untouched test block once. Predictions are generated separately and labelled as research candidates until approved.
              </Callout>

              <button
                className="btn btn-primary w-full py-2.5"
                disabled={!symbol.trim() || models.length === 0 || createExperiment.isPending}
                onClick={() => createExperiment.mutate()}
              >
                {createExperiment.isPending ? 'Queueing…' : 'Launch experiment'} <Play className="h-3.5 w-3.5" />
              </button>
            </div>
          </section>

          <div className="space-y-4">
            <section className="panel p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="eyebrow mb-1">Evaluation protocol</div>
                  <div className="text-[13px] text-white">Default 60 / 20 / 20 split</div>
                </div>
                <Badge tone="violet">purged</Badge>
              </div>
              <div className="space-y-2">
                {[
                  ['Train 60%', 'Fit preprocessing and model parameters', 'bg-violet-500/20 text-violet-300'],
                  ['Purge h sessions', 'Remove overlapping labels at the boundary', 'bg-warn/15 text-warn'],
                  ['Validation 20%', 'Select model + interval calibration', 'bg-cyanx/10 text-cyanx'],
                  ['Purge h sessions', 'Embargo before the final block', 'bg-warn/15 text-warn'],
                  ['Test 20%', 'Scored exactly once; never used to select', 'bg-gain/10 text-gain'],
                ].map(([label, note, className]) => (
                  <div key={label} className="flex items-start gap-3">
                    <span className={cn('mt-0.5 rounded px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wider', className)}>{label}</span>
                    <span className="text-[10.5px] leading-relaxed text-dimx">{note}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 border-t border-white/[0.06] pt-3 font-mono text-[9px] leading-relaxed text-dimx">
                sklearn · {catalog.data?.feature_version ?? 'feature version'} · {Object.keys(catalog.data?.features ?? {}).length} causal features
              </div>
            </section>

            <section className="panel p-5">
              <div className="eyebrow mb-2">Recent runs</div>
              <div className="space-y-1.5">
                {experiments.data?.experiments.slice(0, 5).map((experiment) => (
                  <Link key={experiment.id} to={`/app/experiments/${experiment.id}`} className="flex items-center justify-between rounded-md border border-white/[0.05] px-2.5 py-2 transition hover:border-white/15">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-white">{experiment.symbol}</span>
                      <span className="text-[9px] text-dimx">{String((experiment.config as { target?: string }).target)} · h{String((experiment.config as { horizon?: number }).horizon)}</span>
                    </span>
                    <span className="flex items-center gap-2"><StatusPill status={experiment.status} /><ChevronRight className="h-3 w-3 text-dimx" /></span>
                  </Link>
                ))}
                {!experiments.data?.experiments.length && <div className="text-[10.5px] text-dimx">No runs yet.</div>}
              </div>
              <button onClick={() => setTab('experiments')} className="mt-3 flex items-center gap-1 text-[10px] text-violet-400 hover:text-white">All experiments <ArrowRight className="h-3 w-3" /></button>
            </section>

            <section className="panel p-5">
              <div className="eyebrow mb-2">Honest limits</div>
              <ul className="space-y-2 text-[10.5px] leading-relaxed text-dimx">
                <li>· A single test window is weak evidence of a stable edge.</li>
                <li>· Low price error can simply reflect yesterday's price.</li>
                <li>· Classification probabilities are not actionable until calibration is assessed.</li>
                <li>· Deep-learning models and 1,000-config sweeps are not exposed in this build.</li>
                <li>· No forecast is sent to a broker; live execution is hard-disabled.</li>
              </ul>
            </section>

            <section className="panel p-5">
              <div className="eyebrow mb-2">Data provider</div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white">{catalog.data?.data_provider ?? '—'}</span>
                <Badge tone={catalog.data?.data_provider === 'sample' ? 'warn' : 'neutral'}>{catalog.data?.data_provider === 'sample' ? 'SIMULATED' : 'DELAYED'}</Badge>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-dimx">{catalog.data?.notes[2] ?? 'Provider data is delayed or end-of-day.'}</p>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
