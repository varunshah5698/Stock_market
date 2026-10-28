import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FlaskConical,
  Lock,
  Play,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { FeatureImportance, MarketLineChart, SignedBars } from '../components/charts'
import { Badge, Button, Callout, DataStatus, ErrorState, LoadingPanel, Metric, PageHeader, SectionTitle, Spinner, StatusPill, WarningList } from '../components/ui'
import { useQueryClient } from '@tanstack/react-query'
import { api, errorMessage, post } from '../lib/api'
import { cn, fmtDateTime, fmtNumber, fmtPct, pctClass } from '../lib/format'
import { useDocumentTitle } from '../lib/hooks'
import { useToasts } from '../store/ui'
import type { ExperimentDetail as ExperimentDetailType, MetricRecord, Prediction } from '../lib/types'

function asPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return fmtPct(value * 100, digits, false)
}

function asSignedPercent(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return fmtPct(value * 100, digits, true)
}

function score(record: MetricRecord | undefined | null, key: string): number | null {
  const value = record?.[key]
  return typeof value === 'number' ? value : null
}

interface ApproveResponse {
  approved: boolean
  reasons: string[]
  message: string
}

export default function ExperimentDetail() {
  const { id = '' } = useParams()
  useDocumentTitle('Experiment')
  const toast = useToasts((state) => state.push)
  const queryClient = useQueryClient()
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [approval, setApproval] = useState<ApproveResponse | null>(null)

  const query = useQuery<ExperimentDetailType>({
    queryKey: ['experiment', id],
    queryFn: () => api(`/api/v1/ml/experiments/${id}`),
    refetchInterval: (query) => {
      const data = query.state.data as ExperimentDetailType | undefined
      return data && (data.status === 'queued' || data.status === 'running') ? 3000 : false
    },
  })

  const runPrediction = useMutation({
    mutationFn: () => post<{ prediction: Prediction }>('/api/v1/ml/predictions', { experiment_id: id }),
    onSuccess: (data) => {
      setPrediction(data.prediction)
      toast('Forecast generated from the latest available bar', 'success')
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const approve = useMutation({
    mutationFn: (versionId: string) => post<ApproveResponse>(`/api/v1/ml/models/${versionId}/approve`),
    onSuccess: (response) => {
      setApproval(response)
      toast(response.approved ? 'Model approved as a research candidate' : 'Model did not pass the promotion policy', response.approved ? 'success' : 'warning')
      void queryClient.invalidateQueries({ queryKey: ['experiment', id] })
      void queryClient.invalidateQueries({ queryKey: ['model-health'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  if (query.isLoading) {
    return <div className="space-y-5"><PageHeader eyebrow="Prediction laboratory" title="Experiment" /><LoadingPanel rows={8} /></div>
  }

  if (query.isError || !query.data) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Prediction laboratory" title="Experiment" />
        <ErrorState message={query.error instanceof Error ? query.error.message : 'Experiment unavailable'} onRetry={() => void query.refetch()} />
        <Link to="/app/prediction" className="btn btn-outline"><ArrowLeft className="h-3.5 w-3.5" /> Back to lab</Link>
      </div>
    )
  }

  const detail = query.data
  const config = detail.config as { target?: string; horizon?: number; period?: string; models?: string[]; provider?: string }
  const metrics = detail.metrics
  const succeeded = detail.status === 'succeeded'
  const selected = succeeded ? metrics.selected : null
  const target = config.target ?? metrics.target ?? 'return'
  const isDirection = target === 'direction'
  const version = detail.model_version

  const downloadReport = () => {
    const blob = new Blob([JSON.stringify(detail, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `stockpulse-experiment-${detail.id}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const splitRows = succeeded
    ? [
        ['Train', metrics.split.train],
        ['Validation', metrics.split.validation],
        ['Test (untouched)', metrics.split.test],
      ]
    : []

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<span className="flex items-center gap-2"><Link to="/app/prediction" className="hover:text-white">Prediction lab</Link><span>/</span>Experiment</span>}
        title={`${detail.symbol} · ${isDirection ? 'direction' : 'return'} · h${config.horizon ?? metrics.horizon ?? '—'}`}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusPill status={detail.status} />
            <span className="font-mono text-[10px] text-dimx">{detail.id.slice(0, 12)}</span>
            {succeeded && <Badge tone="violet">{selected?.name}</Badge>}
            <span className="text-dimx">created {fmtDateTime(detail.created_at)}</span>
            {version?.approved && <Badge tone="gain">approved candidate</Badge>}
          </span>
        }
        actions={
          <>
            <button className="btn btn-outline btn-sm" onClick={downloadReport} disabled={!succeeded}><Download className="h-3.5 w-3.5" /> JSON report</button>
            {succeeded && <button className="btn btn-primary btn-sm" onClick={() => runPrediction.mutate()} disabled={runPrediction.isPending}><Sparkles className="h-3.5 w-3.5" /> {runPrediction.isPending ? 'Generating…' : 'Generate forecast'}</button>}
          </>
        }
      />

      {detail.status === 'failed' && (
        <div className="panel p-5">
          <div className="mb-2 flex items-center gap-2 text-[13px] text-loss"><TriangleAlert className="h-4 w-4" /> Experiment failed</div>
          <p className="text-[12px] leading-relaxed text-mutedx">{detail.error || 'Unknown failure. Check provider availability and sample size.'}</p>
          <Link to="/app/prediction" className="btn btn-outline btn-sm mt-4"><ArrowLeft className="h-3 w-3" /> Configure another run</Link>
        </div>
      )}

      {(detail.status === 'queued' || detail.status === 'running') && (
        <div className="panel p-6">
          <div className="flex items-center gap-3">
            <span className="relative flex h-10 w-10 items-center justify-center rounded-full border border-violet-400/30 bg-violet-500/10">
              <FlaskConical className="h-4 w-4 text-violet-400" />
              <span className="absolute inset-0 animate-ping rounded-full border border-violet-400/20" />
            </span>
            <div>
              <div className="text-[13px] text-white">{detail.status === 'queued' ? 'Queued for a worker' : 'Training in progress'}</div>
              <div className="mt-0.5 text-[11px] text-mutedx">Training runs outside the request cycle. This page refreshes every three seconds.</div>
            </div>
            <Spinner label="" />
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-4">
            {['Fetch history', 'Build causal features', 'Fit candidates', 'Select on validation'].map((step, index) => (
              <div key={step} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5">
                <div className="font-mono text-[8.5px] text-dimx">0{index + 1}</div>
                <div className="mt-1 text-[10.5px] text-mutedx">{step}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {succeeded && selected && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            <div className="panel p-4">
              <div className="eyebrow mb-1.5">Selected model</div>
              <div className="display text-[16px] leading-tight text-white">{selected.name}</div>
              <div className="mt-1.5 font-mono text-[8.5px] text-dimx">chosen on {selected.selection_metric}</div>
            </div>
            <MetricCard label={isDirection ? 'Validation balanced acc.' : 'Validation RMSE'} value={isDirection ? asPercent(score(selected.validation, 'balanced_accuracy'), 2) : asPercent(score(selected.validation, 'rmse'), 3)} sub={isDirection ? `ROC-AUC ${fmtNumber(score(selected.validation, 'roc_auc') ?? 0, 3)}` : `MAE ${asPercent(score(selected.validation, 'mae'), 3)}`} />
            <MetricCard label={isDirection ? 'Test balanced acc.' : 'Test RMSE'} value={isDirection ? asPercent(score(selected.test, 'balanced_accuracy'), 2) : asPercent(score(selected.test, 'rmse'), 3)} sub={`n = ${String(metrics.split.test.n)}`} tone="violet" />
            <MetricCard label="Directional accuracy" value={asPercent(score(selected.test, 'directional_accuracy') ?? score(selected.test, 'accuracy'), 2)} sub="test window" />
            <MetricCard label="90% interval coverage" value={metrics.interval_coverage ? asPercent(metrics.interval_coverage.coverage, 1) : '—'} sub={metrics.interval_coverage ? `mean width ${asPercent(metrics.interval_coverage.mean_width, 2)}` : 'regression only'} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
            <div className="space-y-4">
              <section className="panel p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <SectionTitle eyebrow="Out-of-sample" title={isDirection ? 'Predicted probability vs realized direction' : 'Actual vs predicted forward return'} />
                  <DataStatus provider={metrics.data.provider} status={metrics.data.data_status} fetchedAt={metrics.data.fetched_at} compact />
                </div>
                {metrics.series.dates.length ? (
                  <MarketLineChart
                    dates={metrics.series.dates}
                    series={
                      isDirection
                        ? [
                            { name: 'Predicted P(up)', color: '#8b5cf6', values: metrics.series.probability ?? [] },
                            { name: 'Realized (0/1)', color: '#34e0a1', values: metrics.series.actual, dashed: true },
                          ]
                        : [
                            { name: 'Actual return', color: '#22d3ee', values: metrics.series.actual },
                            { name: 'Predicted return', color: '#8b5cf6', values: metrics.series.predicted },
                          ]
                    }
                    height={280}
                    reference={isDirection ? 0.5 : 0}
                    valueFormatter={(value) => fmtPct(value * 100, 1)}
                  />
                ) : (
                  <div className="py-12 text-center text-[11px] text-dimx">Test series unavailable.</div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[8.5px] text-dimx">
                  <span>test window {String(metrics.split.test.start)} → {String(metrics.split.test.end)}</span>
                  <span>n = {String(metrics.split.test.n)}</span>
                  <span>RMSE in return units</span>
                  <span>horizon h{metrics.horizon}</span>
                </div>
              </section>

              {!isDirection && metrics.series.residual && (
                <section className="panel p-4">
                  <SectionTitle eyebrow="Error structure" title="Residuals over the test window" action={<span className="font-mono text-[8.5px] text-dimx">actual − predicted</span>} />
                  <SignedBars dates={metrics.series.dates} values={metrics.series.residual} height={190} />
                  <div className="mt-1 text-[9px] text-dimx">Residuals are not independent: overlapping h-day targets share observations. Do not read a t-statistic from this chart.</div>
                </section>
              )}

              <section className="panel overflow-hidden">
                <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                  <div>
                    <div className="eyebrow mb-0.5">Validation comparison</div>
                    <div className="text-[13px] text-white">Candidates and baselines</div>
                  </div>
                  <Badge>{metrics.models.length} models</Badge>
                </div>
                <div className="overflow-x-auto">
                  <table className="data-table min-w-[720px]">
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th className="text-right">{isDirection ? 'Bal. acc.' : 'RMSE'}</th>
                        <th className="text-right">{isDirection ? 'ROC-AUC' : 'MAE'}</th>
                        <th className="text-right">Dir. acc.</th>
                        <th className="text-right">R²</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.models.map((model) => {
                        const val = model.validation
                        const isSelected = model.key === selected.key
                        return (
                          <tr key={model.key} className={isSelected ? 'bg-violet-500/[0.05]' : undefined}>
                            <td>
                              <div className="flex items-center gap-2 text-[11px] text-white">
                                {model.name}
                                {isSelected && <span className="chip chip-violet">selected</span>}
                              </div>
                              <div className="font-mono text-[8.5px] text-dimx">{model.complexity} · {model.seconds ? `${model.seconds}s` : '—'}</div>
                            </td>
                            <td className="num text-right text-white">{isDirection ? asPercent(score(val, 'balanced_accuracy')) : asPercent(score(val, 'rmse'), 3)}</td>
                            <td className="num text-right text-mutedx">{isDirection ? fmtNumber(score(val, 'roc_auc') ?? 0, 3) : asPercent(score(val, 'mae'), 3)}</td>
                            <td className="num text-right text-mutedx">{asPercent(score(val, 'directional_accuracy') ?? score(val, 'accuracy'))}</td>
                            <td className="num text-right text-mutedx">{isDirection ? '—' : fmtNumber(score(val, 'r2') ?? 0, 3)}</td>
                            <td>{model.error ? <Badge tone="loss">failed</Badge> : <Badge tone={isSelected ? 'violet' : 'neutral'}>{isSelected ? 'test scored once' : 'validation only'}</Badge>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-white/[0.05] px-4 py-2 text-[9px] leading-relaxed text-dimx">
                  Only the selected model is refit and scored on the test window. Reporting test metrics for every candidate would multiply the selection bias.
                </div>
              </section>

              <section className="panel p-4">
                <SectionTitle eyebrow="Baselines" title="Did the model actually add value?" />
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(metrics.baselines ?? {}).map(([key, baseline]) => (
                    <div key={key} className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-3">
                      <div className="text-[11px] text-white">{key.replace(/_/g, ' ')}</div>
                      <div className="mt-1 text-[9.5px] leading-relaxed text-dimx">{baseline.description}</div>
                      <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[9px] text-mutedx">
                        <span>val {isDirection ? asPercent(score(baseline.validation, 'balanced_accuracy')) : asPercent(score(baseline.validation, 'rmse'), 3)}</span>
                        <span>test {isDirection ? asPercent(score(baseline.test, 'balanced_accuracy')) : asPercent(score(baseline.test, 'rmse'), 3)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {isDirection && metrics.selected.validation.calibration && (
                <section className="panel overflow-hidden">
                  <div className="border-b border-white/[0.06] px-4 py-3">
                    <div className="eyebrow mb-0.5">Calibration</div>
                    <div className="text-[13px] text-white">Validation probability buckets</div>
                  </div>
                  <table className="data-table">
                    <thead><tr><th>Bucket</th><th className="text-right">n</th><th className="text-right">Mean predicted</th><th className="text-right">Observed rate</th></tr></thead>
                    <tbody>
                      {(metrics.selected.validation.calibration as unknown as { bucket: string; n: number; mean_probability: number; observed_rate: number }[]).map((bin) => (
                        <tr key={bin.bucket}>
                          <td className="font-mono text-[10px] text-mutedx">{bin.bucket}</td>
                          <td className="num text-right text-mutedx">{bin.n}</td>
                          <td className="num text-right text-white">{asPercent(bin.mean_probability, 1)}</td>
                          <td className="num text-right text-cyanx">{asPercent(bin.observed_rate, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="border-t border-white/[0.05] px-4 py-2 text-[9px] text-dimx">Buckets with few observations are noisy. Calibration on validation does not guarantee calibration out of sample.</div>
                </section>
              )}
            </div>

            <div className="space-y-4">
              <section className="panel p-4">
                <SectionTitle eyebrow="Forecast" title="Next-horizon estimate" />
                {!prediction ? (
                  <div className="py-3">
                    <p className="text-[11px] leading-relaxed text-mutedx">Generate a forecast from the latest complete feature row. It is persisted with its data cutoff and model version.</p>
                    <Button className="mt-3 w-full" loading={runPrediction.isPending} onClick={() => runPrediction.mutate()} icon={<Play className="h-3.5 w-3.5" />}>Generate forecast</Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="eyebrow mb-1">{isDirection ? 'Probability of positive return' : `Expected return · h${prediction.horizon}`}</div>
                        <div className={cn('num text-[26px] leading-none', pctClass(prediction.target === 'direction' ? (prediction.probability ?? 0) - 0.5 : prediction.point))}>
                          {prediction.target === 'direction' ? asPercent(prediction.probability, 1) : asSignedPercent(prediction.point, 3)}
                        </div>
                      </div>
                      <Badge tone={prediction.approved ? 'gain' : 'warn'}>{prediction.approved ? 'approved' : 'research'}</Badge>
                    </div>
                    {prediction.scenario && (
                      <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
                        <div className="eyebrow mb-2">Price scenario</div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-dimx">Last close</span>
                          <span className="num text-[12px] text-white">{fmtNumber(prediction.scenario.last_close, 2)}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-[10px] text-dimx">Expected</span>
                          <span className="num text-[12px] text-violet-300">{fmtNumber(prediction.scenario.expected_price, 2)}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-[10px] text-dimx">{Math.round((prediction.interval?.level ?? 0.9) * 100)}% residual interval</span>
                          <span className="num text-[10px] text-mutedx">
                            {prediction.scenario.low_price !== null ? fmtNumber(prediction.scenario.low_price, 2) : '—'} – {prediction.scenario.high_price !== null ? fmtNumber(prediction.scenario.high_price, 2) : '—'}
                          </span>
                        </div>
                        <div className="mt-2 text-[8.5px] leading-relaxed text-dimx">{prediction.scenario.assumption}</div>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 font-mono text-[9px] text-dimx">
                      <span>as of {prediction.as_of}</span>
                      <span className="text-right">{prediction.data.data_status}</span>
                      <span>version {prediction.model_version_id.slice(0, 8)}</span>
                      <span className="text-right">{prediction.model_name}</span>
                    </div>
                    <WarningList warnings={prediction.warnings} title="Forecast warnings" />
                  </div>
                )}
              </section>

              <section className="panel p-4">
                <SectionTitle eyebrow="Promotion" title="Model approval" action={version?.approved ? <Badge tone="gain">approved</Badge> : <Badge tone="warn">not approved</Badge>} />
                <p className="text-[10.5px] leading-relaxed text-dimx">
                  Policy uses validation evidence only: minimum sample, baseline-relative RMSE improvement (≥5%), directional accuracy, and calibration where applicable.
                  Approval is a research gate, not a profitability claim.
                </p>
                {approval && !approval.approved && (
                  <div className="mt-3 rounded-md border border-warn/20 bg-warn/[0.04] p-2.5">
                    <div className="mb-1 text-[10px] font-medium text-warn">Rejected</div>
                    <ul className="space-y-1 text-[9.5px] leading-relaxed text-warn/80">
                      {approval.reasons.map((reason) => <li key={reason}>· {reason}</li>)}
                    </ul>
                  </div>
                )}
                {version && !version.approved && (
                  <Button
                    className="mt-3 w-full"
                    variant="outline"
                    loading={approve.isPending}
                    onClick={() => approve.mutate(version.id)}
                    icon={<ShieldCheck className="h-3.5 w-3.5" />}
                  >
                    Evaluate promotion
                  </Button>
                )}
                {version?.approved && (
                  <div className="mt-3 flex items-start gap-2 rounded-md border border-gain/15 bg-gain/[0.04] p-2.5 text-[9.5px] leading-relaxed text-gain/80">
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" /> Approved {version.approved_at ? fmtDateTime(version.approved_at) : ''}. This does not guarantee future performance.
                  </div>
                )}
              </section>

              {metrics.feature_importance?.length > 0 && (
                <section className="panel p-4">
                  <SectionTitle eyebrow="Explanation" title="Feature importance" action={<span className="font-mono text-[8.5px] text-dimx">top 10</span>} />
                  <FeatureImportance items={metrics.feature_importance.slice(0, 10)} />
                  <div className="mt-2 text-[8.5px] leading-relaxed text-dimx">Built-in importance is not causal. Correlated features share credit unpredictably.</div>
                </section>
              )}

              <section className="panel p-4">
                <SectionTitle eyebrow="Protocol" title="Split & provenance" />
                <div className="space-y-2">
                  {splitRows.map(([label, span]) => {
                    const value = span as { start: string; end: string; n: number }
                    return (
                      <div key={label as string} className="flex items-center justify-between border-b border-white/[0.04] pb-2 text-[10px] last:border-0 last:pb-0">
                        <span className={label === 'Test (untouched)' ? 'text-gain' : 'text-dimx'}>{label as string}</span>
                        <span className="num text-right text-mutedx">{value.start} → {value.end} · {value.n}</span>
                      </div>
                    )
                  })}
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-dimx">Purge</span>
                    <span className="font-mono text-mutedx">{metrics.split.purge_sessions} sessions</span>
                  </div>
                </div>
                <div className="mt-3 border-t border-white/[0.06] pt-3 font-mono text-[8.5px] leading-relaxed text-dimx">
                  <div>feature version {metrics.feature_version} · {metrics.feature_count} features</div>
                  <div>data {metrics.data.data_start} → {metrics.data.data_end}</div>
                  <div>provider {metrics.data.provider} · {metrics.data.data_status}</div>
                  <div>generated {fmtDateTime(metrics.generated_at)}</div>
                </div>
                {metrics.walk_forward && (
                  <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/20 p-3">
                    <div className="eyebrow mb-1.5">Walk-forward stability</div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="num text-[13px] text-white">
                          {isDirection
                            ? asPercent(score(metrics.walk_forward.metrics, 'balanced_accuracy'), 2)
                            : asPercent(score(metrics.walk_forward.metrics, 'rmse'), 3)}
                        </div>
                        <div className="mt-1 font-mono text-[8px] text-dimx">
                          {metrics.walk_forward.folds} expanding folds · validation only · not used for selection
                        </div>
                      </div>
                      <Lock className="h-3 w-3 shrink-0 text-violet-400" />
                    </div>
                    <div className="mt-1.5 text-[8px] leading-relaxed text-dimx">{metrics.walk_forward.warning}</div>
                  </div>
                )}
              </section>

              <section className="panel p-4">
                <SectionTitle eyebrow="Test isolation" title="Why this is not a promise" />
                <div className="space-y-2 text-[9.5px] leading-relaxed text-dimx">
                  <p><Lock className="mr-1 inline h-3 w-3 text-violet-400" /> The test block was not used to choose features, hyperparameters, or the model.</p>
                  <p><Lock className="mr-1 inline h-3 w-3 text-violet-400" /> A single frozen test window can still be lucky. Repeatedly rerunning until it looks good invalidates it.</p>
                  <p><Lock className="mr-1 inline h-3 w-3 text-violet-400" /> Forecast intervals are empirical residual quantiles, not guaranteed coverage.</p>
                </div>
              </section>
            </div>
          </div>

          <WarningList warnings={metrics.warnings} title="Experiment warnings" />
          <Callout tone="warn" title="No trading instruction">
            A forecast is an input to research. It is never routed to a broker, and the platform has no live execution path. Any strategy built on this signal must still clear cost-aware backtesting and risk limits.
          </Callout>
        </>
      )}

      {succeeded && !selected && (
        <ErrorState message="The experiment succeeded but contains no selected model report. This is an internal inconsistency; rerun the experiment." />
      )}
    </div>
  )
}

function MetricCard({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub: string; tone?: 'neutral' | 'violet' }) {
  return (
    <div className="panel p-4">
      <div className="eyebrow mb-1.5">{label}</div>
      <div className={cn('num text-[19px] leading-none', tone === 'violet' ? 'text-violet-300' : 'text-white')}>{value}</div>
      <div className="mt-1.5 font-mono text-[8.5px] text-dimx">{sub}</div>
    </div>
  )
}
