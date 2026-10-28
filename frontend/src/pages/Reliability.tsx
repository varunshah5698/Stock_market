import { useQuery } from '@tanstack/react-query'
import { Activity, ArrowRight, BrainCircuit, CircleAlert, FlaskConical, Gauge, RefreshCw, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge, Button, Callout, DataStatus, EmptyState, ErrorState, LoadingPanel, Metric, PageHeader, SectionTitle, StatusPill, WarningList } from '../components/ui'
import { api } from '../lib/api'
import { cn, fmtDateTime, fmtNumber, fmtPct, pctClass } from '../lib/format'
import { useDocumentTitle } from '../lib/hooks'
import type { MetricRecord } from '../lib/types'

interface ModelHealth {
  status: string
  approved_models: {
    model_version_id: string
    experiment_id: string
    name: string
    target: string
    horizon: number
    approved_at: string | null
    validation: MetricRecord
    test: MetricRecord
  }[]
  recent_candidates: {
    experiment_id: string
    symbol: string
    n_models_compared: number
    selected: string | null
    validation: MetricRecord | null
    test: MetricRecord | null
    warnings: string[]
  }[]
  prediction_outcomes: {
    summary: { matured: number; direction_hit_rate: number | null; mean_abs_error: number | null; note: string }
    recent: {
      prediction_id: string
      symbol: string
      as_of: string
      horizon: number
      predicted: number
      realized_return: number
      abs_error: number | null
      direction_hit: boolean
    }[]
  }
  drift: Record<string, string>
  warnings: string[]
  generated_at: string
}

interface SystemStatus {
  provider: { name: string; data_status: string; notes: string }
  jobs: { experiments: Record<string, number>; backtests: Record<string, number> }
  recent_failures: { kind: string; id: string; symbol: string; error: string; at: string }[]
  capabilities: Record<string, boolean | string>
}

function val(record: MetricRecord | null | undefined, key: string) {
  const value = record?.[key]
  return typeof value === 'number' ? value : null
}

export default function Reliability() {
  useDocumentTitle('Model reliability')
  const health = useQuery<ModelHealth>({
    queryKey: ['model-health'],
    queryFn: () => api('/api/v1/model-health'),
  })
  const system = useQuery<SystemStatus>({
    queryKey: ['system-status'],
    queryFn: () => api('/api/v1/system/status'),
    staleTime: 60_000,
  })

  if (health.isLoading) {
    return <div className="space-y-5"><PageHeader eyebrow="Model risk" title="Model reliability" /><LoadingPanel rows={7} /></div>
  }

  if (health.isError || !health.data) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Model risk" title="Model reliability" />
        <ErrorState message={health.error instanceof Error ? health.error.message : 'Reliability data unavailable'} onRetry={() => void health.refetch()} />
      </div>
    )
  }

  const data = health.data
  const statusTone = data.status === 'validated_candidate' ? 'gain' : data.status === 'research_only' ? 'warn' : 'neutral'
  const selected = data.recent_candidates[0]
  const outcome = data.prediction_outcomes.summary

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Model risk & monitoring"
        title="Model reliability"
        description="Promotion state, matured forecast outcomes, and honest gaps. A green badge here never means the model is safe or profitable."
        actions={
          <>
            <Button size="sm" variant="outline" loading={health.isFetching} onClick={() => void health.refetch()} icon={<RefreshCw className="h-3.5 w-3.5" />}>Refresh</Button>
            <Link to="/app/prediction" className="btn btn-primary btn-sm"><BrainCircuit className="h-3.5 w-3.5" /> Prediction lab</Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="panel p-4">
          <div className="eyebrow mb-2">Model status</div>
          <Badge tone={statusTone as 'gain' | 'warn' | 'neutral'}>{data.status.replace(/_/g, ' ')}</Badge>
          <p className="mt-2 text-[10px] leading-relaxed text-dimx">
            {data.status === 'validated_candidate'
              ? 'At least one model passed the research promotion gate. This is not a production trading approval.'
              : data.status === 'research_only'
                ? 'Experiments exist, but no model passed the promotion gate.'
                : 'No completed experiments are available.'}
          </p>
        </div>
        <MetricCard label="Approved research models" value={String(data.approved_models.length)} sub="validation-gated" />
        <MetricCard label="Matured forecasts" value={String(outcome.matured)} sub="outcomes with enough later bars" />
        <MetricCard label="Directional hit rate" value={outcome.direction_hit_rate !== null ? fmtPct(outcome.direction_hit_rate * 100, 1, false) : '—'} sub={outcome.note} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <section className="panel overflow-hidden">
          <div className="border-b border-white/[0.06] px-4 py-3">
            <div className="eyebrow mb-0.5">Promotion gate</div>
            <div className="text-[13px] text-white">Approved research models</div>
          </div>
          {!data.approved_models.length ? (
            <EmptyState
              title="No model has passed promotion"
              description="The promotion policy uses validation evidence only: sample size, baseline-relative RMSE improvement, directional accuracy and calibration. A rejected model is a normal research outcome."
              icon={<ShieldCheck className="h-5 w-5" />}
              action={<Link to="/app/prediction" className="btn btn-outline btn-sm">Run a comparison</Link>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[680px]">
                <thead><tr><th>Model</th><th>Target</th><th className="text-right">Validation</th><th className="text-right">Test audit</th><th>Approved</th><th /></tr></thead>
                <tbody>
                  {data.approved_models.map((model) => (
                    <tr key={model.model_version_id}>
                      <td><div className="text-[11px] text-white">{model.name}</div><div className="font-mono text-[8px] text-dimx">{model.experiment_id.slice(0, 8)}</div></td>
                      <td className="text-[10px] text-mutedx">{model.target} · h{model.horizon}</td>
                      <td className="num text-right text-white">{model.target === 'direction' ? fmtPct((val(model.validation, 'balanced_accuracy') ?? 0) * 100, 1, false) : `${((val(model.validation, 'rmse') ?? 0) * 100).toFixed(3)}%`}</td>
                      <td className="num text-right text-mutedx">{model.target === 'direction' ? fmtPct((val(model.test, 'balanced_accuracy') ?? 0) * 100, 1, false) : `${((val(model.test, 'rmse') ?? 0) * 100).toFixed(3)}%`}</td>
                      <td className="font-mono text-[8.5px] text-dimx">{model.approved_at ? fmtDateTime(model.approved_at) : '—'}</td>
                      <td className="text-right"><Link to={`/app/experiments/${model.experiment_id}`} className="text-dimx hover:text-white" aria-label="Open experiment"><ArrowRight className="h-3.5 w-3.5" /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-white/[0.05] px-4 py-2 text-[9px] text-dimx">Approval is a research gate. No approved model is connected to an autonomous execution path.</div>
        </section>

        <section className="panel p-4">
          <SectionTitle eyebrow="Latest candidate" title={selected ? `${selected.symbol} · ${selected.n_models_compared} compared` : 'No completed experiments'} />
          {selected ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Selected model" value={selected.selected ?? '—'} />
                <Metric label="Validation RMSE" value={val(selected.validation, 'rmse') !== null ? `${((val(selected.validation, 'rmse') as number) * 100).toFixed(3)}%` : '—'} />
                <Metric label="Test RMSE" value={val(selected.test, 'rmse') !== null ? `${((val(selected.test, 'rmse') as number) * 100).toFixed(3)}%` : '—'} tone="violet" />
                <Metric label="Test direction" value={val(selected.test, 'directional_accuracy') !== null ? fmtPct((val(selected.test, 'directional_accuracy') as number) * 100, 1, false) : '—'} />
              </div>
              <WarningList warnings={selected.warnings.slice(0, 3)} title="Candidate warnings" />
              <Link to={`/app/experiments/${selected.experiment_id}`} className="text-[10px] text-violet-400 hover:text-white">Open full experiment report →</Link>
            </div>
          ) : (
            <div className="text-[10.5px] leading-relaxed text-dimx">Run a model comparison to populate candidate evidence.</div>
          )}
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <div>
              <div className="eyebrow mb-0.5">Delayed-label evaluation</div>
              <div className="text-[13px] text-white">Matured forecast outcomes</div>
            </div>
            <Badge tone={outcome.matured ? 'cyan' : 'neutral'}>{outcome.matured} matured</Badge>
          </div>
          {!data.prediction_outcomes.recent.length ? (
            <EmptyState title="No matured forecasts" description="Predictions need enough later bars before their realized direction or return can be measured. Generated forecasts appear here once labels mature." icon={<Activity className="h-5 w-5" />} />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[720px]">
                <thead><tr><th>Symbol</th><th>As of</th><th className="text-right">Predicted</th><th className="text-right">Realized</th><th className="text-right">Abs error</th><th>Direction</th></tr></thead>
                <tbody>
                  {data.prediction_outcomes.recent.map((row) => (
                    <tr key={row.prediction_id}>
                      <td className="font-mono text-[10.5px] text-white">{row.symbol}</td>
                      <td className="font-mono text-[9px] text-dimx">{row.as_of} · h{row.horizon}</td>
                      <td className={cn('num text-right', pctClass(row.predicted))}>{fmtPct(row.predicted * 100, 3)}</td>
                      <td className={cn('num text-right', pctClass(row.realized_return))}>{fmtPct(row.realized_return * 100, 3)}</td>
                      <td className="num text-right text-dimx">{row.abs_error !== null ? fmtNumber(row.abs_error * 100, 3) + '%' : '—'}</td>
                      <td><Badge tone={row.direction_hit ? 'gain' : 'loss'}>{row.direction_hit ? 'hit' : 'miss'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-white/[0.05] px-4 py-2 text-[9px] leading-relaxed text-dimx">
            Mean absolute error {outcome.mean_abs_error !== null ? `${(outcome.mean_abs_error * 100).toFixed(3)}%` : '—'} · small samples are not evidence of reliability.
          </div>
        </section>

        <div className="space-y-4">
          <section className="panel p-4">
            <SectionTitle eyebrow="Monitoring coverage" title="What is not measured" />
            <div className="space-y-2">
              {[
                ['Input drift', data.drift.input_drift],
                ['Prediction drift', data.drift.prediction_drift],
                ['Calibration drift', data.drift.calibration_drift],
              ].map(([label, value]) => (
                <div key={label as string} className="flex items-center justify-between border-b border-white/[0.05] pb-2 text-[10.5px] last:border-0 last:pb-0">
                  <span className="text-dimx">{label as string}</span>
                  <Badge tone="warn">{(value as string).replace(/_/g, ' ')}</Badge>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[9.5px] leading-relaxed text-dimx">{data.drift.reason}</p>
          </section>

          <section className="panel p-4">
            <SectionTitle eyebrow="Operational context" title="Data & jobs" />
            <div className="space-y-2 text-[10px]">
              <div className="flex items-center justify-between"><span className="text-dimx">Provider</span><DataStatus provider={system.data?.provider.name} status={system.data?.provider.data_status} compact /></div>
              <div className="flex items-center justify-between"><span className="text-dimx">Failed experiments</span><span className="num text-mutedx">{system.data?.jobs.experiments.failed ?? 0}</span></div>
              <div className="flex items-center justify-between"><span className="text-dimx">Running experiments</span><span className="num text-mutedx">{system.data?.jobs.experiments.running ?? 0}</span></div>
              <div className="flex items-center justify-between"><span className="text-dimx">Failed backtests</span><span className="num text-mutedx">{system.data?.jobs.backtests.failed ?? 0}</span></div>
            </div>
            {system.data?.recent_failures.length ? (
              <div className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-2">
                {system.data.recent_failures.slice(0, 4).map((failure) => (
                  <div key={failure.id} className="text-[9px] leading-relaxed text-loss/80"><CircleAlert className="mr-1 inline h-2.5 w-2.5" />{failure.kind} {failure.symbol}: {failure.error?.slice(0, 120)}</div>
                ))}
              </div>
            ) : (
              <div className="mt-3 text-[9px] text-dimx">No recent job failures recorded.</div>
            )}
            <Link to="/app/settings" className="mt-3 inline-flex items-center gap-1 text-[10px] text-violet-400 hover:text-white">System integrations <ArrowRight className="h-3 w-3" /></Link>
          </section>
        </div>
      </div>

      <div className="grid gap-3">
        <WarningList warnings={data.warnings} title="Reliability warnings" />
        <Callout tone="warn" title="No production claim">
          This page reports the evidence the system has, and names what it lacks. It does not certify the model, guarantee calibration, or
          recommend trading. Revalidation and rollback procedures are required before any live use — which this build does not enable.
        </Callout>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[8.5px] text-dimx">
          <span>generated {fmtDateTime(data.generated_at)}</span>
          <span>approved models are research candidates only</span>
          <span>drift detection: not implemented</span>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="panel p-4">
      <div className="eyebrow mb-1.5">{label}</div>
      <div className="num text-[22px] leading-none text-white">{value}</div>
      <div className="mt-1.5 font-mono text-[8.5px] text-dimx">{sub}</div>
    </div>
  )
}
