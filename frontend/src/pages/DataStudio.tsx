import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Download, FileSpreadsheet, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import { useState } from 'react'
import { CorrelationHeatmap, SimpleBars } from '../components/charts'
import { Badge, Button, Callout, EmptyState, ErrorState, Field, LoadingPanel, Modal, PageHeader, SectionTitle, Select, StatusPill } from '../components/ui'
import { api, del, errorMessage, upload } from '../lib/api'
import { cn, fmtDateTime, fmtNumber } from '../lib/format'
import { useDocumentTitle } from '../lib/hooks'
import { useToasts } from '../store/ui'
import type { DatasetRecord } from '../lib/types'

interface PreviewResponse {
  filename: string
  rows: number
  columns: string[]
  inferred_mapping: Record<string, string | null>
  numeric_candidates: string[]
  sample: Record<string, string>[]
  limits: { max_mb: number; max_rows: number; format: string }
  warnings: string[]
}

interface StatsResponse {
  dataset_id: string
  rows: number
  date_range: { start: string | null; end: string | null }
  describe: Record<string, { count: number; mean: number; std: number; min: number; q25: number; median: number; q75: number; max: number }>
  missing_pct: Record<string, number>
  correlation: { columns: string[]; matrix: number[][] } | null
  close_return_histogram: { counts: number[]; edges: number[]; unit: string } | null
  validation: Record<string, unknown>
  note: string
}

const MAPPING_FIELDS = [
  ['timestamp', 'Timestamp *'],
  ['close', 'Close *'],
  ['open', 'Open'],
  ['high', 'High'],
  ['low', 'Low'],
  ['volume', 'Volume'],
  ['symbol', 'Symbol'],
  ['target', 'Target (optional)'],
] as const

export default function DataStudio() {
  useDocumentTitle('Data studio')
  const queryClient = useQueryClient()
  const toast = useToasts((state) => state.push)
  const [importOpen, setImportOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [datasetName, setDatasetName] = useState('')
  const [dateFormat, setDateFormat] = useState('')
  const [dropInvalid, setDropInvalid] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [step, setStep] = useState<1 | 2>(1)

  const datasets = useQuery<{ datasets: DatasetRecord[] }>({
    queryKey: ['datasets'],
    queryFn: () => api('/api/v1/datasets'),
  })

  const stats = useQuery<StatsResponse>({
    queryKey: ['dataset-stats', selectedId],
    queryFn: () => api(`/api/v1/datasets/${selectedId}/stats`),
    enabled: Boolean(selectedId),
  })

  const validate = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a CSV file first')
      const form = new FormData()
      form.append('file', file)
      return upload<PreviewResponse>('/api/v1/datasets/preview', form)
    },
    onSuccess: (data) => {
      setPreview(data)
      setMapping(Object.fromEntries(Object.entries(data.inferred_mapping).filter(([, value]) => Boolean(value))) as Record<string, string>)
      setDatasetName(data.filename.replace(/\.csv$/i, ''))
      setStep(2)
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const importDataset = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a CSV file first')
      if (!mapping.timestamp || !mapping.close) throw new Error('Timestamp and close mappings are required')
      const form = new FormData()
      form.append('file', file)
      form.append('mapping', JSON.stringify(mapping))
      form.append('name', datasetName)
      form.append('date_format', dateFormat)
      form.append('drop_ohlc_violations', String(dropInvalid))
      return upload<{ dataset: DatasetRecord; validation: Record<string, unknown> }>('/api/v1/datasets', form)
    },
    onSuccess: (data) => {
      toast('Dataset imported and validated', 'success', `${data.dataset.rows.toLocaleString()} clean rows stored.`)
      setImportOpen(false)
      setFile(null)
      setPreview(null)
      setStep(1)
      setSelectedId(data.dataset.id)
      void queryClient.invalidateQueries({ queryKey: ['datasets'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/v1/datasets/${id}`),
    onSuccess: () => {
      toast('Dataset deleted', 'success')
      setSelectedId(null)
      void queryClient.invalidateQueries({ queryKey: ['datasets'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const selected = datasets.data?.datasets.find((dataset) => dataset.id === selectedId) ?? null
  const validation = (stats.data?.validation ?? selected?.validation ?? {}) as {
    rows_in?: number
    rows_out?: number
    duplicate_rows?: number
    ohlc_violations?: number
    approx_missing_business_days?: number
    dropped?: Record<string, number>
    warnings?: string[]
    date_range?: { start: string; end: string }
    symbols?: number
  }

  const histogram = stats.data?.close_return_histogram
  const histogramData = histogram
    ? histogram.counts.map((count, index) => ({
        label: `${(histogram.edges[index] * 100).toFixed(2)}`,
        value: count,
      }))
    : []

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Data studio"
        title="Your data, validated"
        description="Upload CSV history, map columns, inspect quality, and keep the cleaned file scoped to your account. User data is never presented as a live feed."
        actions={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => void datasets.refetch()} disabled={datasets.isFetching}><RefreshCw className={cn('h-3.5 w-3.5', datasets.isFetching && 'animate-spin')} /> Refresh</button>
            <button className="btn btn-primary btn-sm" onClick={() => { setImportOpen(true); setStep(1); setPreview(null); setFile(null) }}><Upload className="h-3.5 w-3.5" /> Import CSV</button>
          </>
        }
      />

      {datasets.isLoading ? (
        <LoadingPanel rows={6} />
      ) : datasets.isError ? (
        <ErrorState message={datasets.error instanceof Error ? datasets.error.message : 'Datasets unavailable'} onRetry={() => void datasets.refetch()} />
      ) : !datasets.data?.datasets.length ? (
        <div className="panel">
          <EmptyState
            title="No uploaded datasets"
            description="Import a historic OHLCV CSV to validate dates, duplicates, prices and missingness. Uploaded data stays separate from live provider research."
            icon={<Database className="h-5 w-5" />}
            action={<Button size="sm" variant="primary" onClick={() => setImportOpen(true)}>Import CSV</Button>}
          />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="panel h-fit overflow-hidden">
            <div className="border-b border-white/[0.06] px-3 py-2.5"><div className="eyebrow">Datasets</div></div>
            <div className="max-h-[65vh] overflow-y-auto p-2">
              {datasets.data.datasets.map((dataset) => (
                <button
                  key={dataset.id}
                  onClick={() => setSelectedId(dataset.id)}
                  className={cn('mb-1 w-full rounded-lg border p-2.5 text-left transition', selectedId === dataset.id ? 'border-violet-400/30 bg-violet-500/[0.06]' : 'border-transparent hover:border-white/10 hover:bg-white/[0.03]')}
                >
                  <div className="truncate text-[11px] text-white">{dataset.name}</div>
                  <div className="mt-1 flex items-center justify-between font-mono text-[8px] text-dimx">
                    <span>{dataset.rows.toLocaleString()} rows · v{dataset.version}</span>
                    <span>{dataset.created_at.slice(0, 10)}</span>
                  </div>
                  <div className="mt-1"><StatusPill status={dataset.status} /></div>
                </button>
              ))}
            </div>
          </aside>

          {!selected ? (
            <div className="panel"><EmptyState title="Select a dataset" description="Pick a stored dataset to inspect its statistics and validation report." icon={<FileSpreadsheet className="h-5 w-5" />} /></div>
          ) : (
            <div className="min-w-0 space-y-4">
              <div className="panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="eyebrow mb-1">Dataset · v{selected.version}</div>
                    <div className="display text-[18px] text-white">{selected.name}</div>
                    <div className="mt-1 font-mono text-[9px] text-dimx">{selected.original_filename} · {selected.rows.toLocaleString()} rows · {selected.columns.length} columns · {fmtDateTime(selected.created_at)}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <a className="btn btn-outline btn-sm" href={`/api/v1/datasets/${selected.id}/export.csv`} download><Download className="h-3.5 w-3.5" /> Export</a>
                    <button className="btn btn-ghost btn-sm text-dimx hover:text-loss" onClick={() => { if (window.confirm(`Delete "${selected.name}" and its stored file?`)) remove.mutate(selected.id) }} aria-label="Delete dataset"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  {[
                    ['Rows in', validation.rows_in ?? '—'],
                    ['Rows kept', validation.rows_out ?? selected.rows],
                    ['Duplicates', validation.duplicate_rows ?? 0],
                    ['OHLC flags', validation.ohlc_violations ?? 0],
                  ].map(([label, value]) => (
                    <div key={label as string} className="rounded border border-white/[0.05] bg-white/[0.015] p-2">
                      <div className="eyebrow">{label as string}</div>
                      <div className="num mt-1 text-[13px] text-white">{String(value)}</div>
                    </div>
                  ))}
                </div>
                {validation.warnings?.length ? (
                  <div className="mt-3 space-y-1">
                    {validation.warnings.map((warning) => <div key={warning} className="flex gap-2 text-[10px] leading-relaxed text-warn/80"><span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-warn/60" />{warning}</div>)}
                  </div>
                ) : null}
              </div>

              {stats.isLoading ? (
                <LoadingPanel rows={6} />
              ) : stats.isError ? (
                <ErrorState message={stats.error instanceof Error ? stats.error.message : 'Statistics unavailable'} onRetry={() => void stats.refetch()} />
              ) : stats.data ? (
                <>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <section className="panel min-w-0 p-4">
                      <SectionTitle eyebrow="Quality" title="Missingness by column" />
                      <div className="space-y-2">
                        {Object.entries(stats.data.missing_pct).map(([column, pct]) => (
                          <div key={column}>
                            <div className="mb-1 flex justify-between font-mono text-[9px]"><span className="text-mutedx">{column}</span><span className={pct > 0 ? 'text-warn' : 'text-gain'}>{pct.toFixed(2)}%</span></div>
                            <div className="h-1 overflow-hidden rounded-full bg-white/[0.05]"><div className={cn('h-full rounded-full', pct > 0 ? 'bg-warn/70' : 'bg-gain/60')} style={{ width: `${Math.min(100, Math.max(1, pct))}%` }} /></div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 font-mono text-[8.5px] text-dimx">Date range {String(stats.data.date_range.start)} → {String(stats.data.date_range.end)} · approx. missing business days {validation.approx_missing_business_days ?? '—'}</div>
                    </section>

                    <section className="panel min-w-0 p-4">
                      <SectionTitle eyebrow="Distribution" title="Close-to-close returns" action={<span className="font-mono text-[8.5px] text-dimx">{histogram?.unit ?? ''}</span>} />
                      {histogramData.length ? (
                        <SimpleBars data={histogramData} height={200} valueFormatter={(value) => fmtNumber(value, 0)} colorFor={() => '#8b5cf6'} />
                      ) : (
                        <div className="py-10 text-center text-[11px] text-dimx">Not enough valid closes.</div>
                      )}
                      <div className="mt-1 font-mono text-[8.5px] text-dimx">Bins are labelled in percent return (%). This describes the uploaded sample only.</div>
                    </section>
                  </div>

                  <section className="panel min-w-0 p-4">
                    <SectionTitle eyebrow="Summary statistics" title="Numeric columns" />
                    <div className="overflow-x-auto">
                      <table className="data-table min-w-[720px]">
                        <thead><tr><th>Column</th><th className="text-right">Count</th><th className="text-right">Mean</th><th className="text-right">Std</th><th className="text-right">Min</th><th className="text-right">Q25</th><th className="text-right">Median</th><th className="text-right">Q75</th><th className="text-right">Max</th></tr></thead>
                        <tbody>
                          {Object.entries(stats.data.describe).map(([column, values]) => (
                            <tr key={column}>
                              <td className="font-mono text-[10px] text-white">{column}</td>
                              <td className="num text-right text-mutedx">{values.count}</td>
                              <td className="num text-right text-mutedx">{fmtNumber(values.mean, 3)}</td>
                              <td className="num text-right text-dimx">{fmtNumber(values.std, 3)}</td>
                              <td className="num text-right text-mutedx">{fmtNumber(values.min, 3)}</td>
                              <td className="num text-right text-dimx">{fmtNumber(values.q25, 3)}</td>
                              <td className="num text-right text-white">{fmtNumber(values.median, 3)}</td>
                              <td className="num text-right text-dimx">{fmtNumber(values.q75, 3)}</td>
                              <td className="num text-right text-mutedx">{fmtNumber(values.max, 3)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {stats.data.correlation && (
                    <section className="panel p-4">
                      <SectionTitle eyebrow="Relationships" title="Correlation of numeric columns" />
                      <CorrelationHeatmap symbols={stats.data.correlation.columns} matrix={stats.data.correlation.matrix} size="sm" />
                      <div className="mt-2 text-[9px] text-dimx">Computed on complete rows only. Uploaded column semantics are not inferred beyond the mapping.</div>
                    </section>
                  )}

                  <Callout tone="info" title="Analysis boundary">
                    {stats.data.note} This build validates and describes uploaded files but does not launch the live-stock experiment runner on them. No macros, scripts or formulas are executed.
                  </Callout>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}

      <Modal
        open={importOpen}
        onClose={() => { setImportOpen(false); setStep(1); setPreview(null); setFile(null) }}
        title="Import a CSV dataset"
        description="Step 1 validates structure. Step 2 maps columns and applies a documented cleaning policy."
        wide
        footer={
          step === 1 ? (
            <>
              <button className="btn btn-ghost" onClick={() => setImportOpen(false)}>Cancel</button>
              <Button variant="primary" disabled={!file || validate.isPending} loading={validate.isPending} onClick={() => validate.mutate()}>Validate file</Button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => setStep(1)}>Back</button>
              <Button variant="primary" disabled={!mapping.timestamp || !mapping.close || importDataset.isPending} loading={importDataset.isPending} onClick={() => importDataset.mutate()}>Confirm import</Button>
            </>
          )
        }
      >
        <div className="mb-4 flex items-center gap-2">
          {[1, 2].map((number) => (
            <div key={number} className="flex items-center gap-2">
              <span className={cn('flex h-5 w-5 items-center justify-center rounded-full font-mono text-[9px]', step >= number ? 'bg-violet-500 text-white' : 'bg-white/[0.06] text-dimx')}>{number}</span>
              <span className={cn('text-[10px]', step >= number ? 'text-white' : 'text-dimx')}>{number === 1 ? 'Validate' : 'Map & clean'}</span>
              {number === 1 && <span className="h-px w-8 bg-white/10" />}
            </div>
          ))}
        </div>

        {step === 1 ? (
          <div className="space-y-4">
            <label className="flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/[0.015] p-6 text-center transition hover:border-violet-400/40 hover:bg-violet-500/[0.03]">
              <Upload className="mb-2 h-5 w-5 text-violet-400" />
              <span className="text-[12px] text-white">{file ? file.name : 'Choose a CSV file'}</span>
              <span className="mt-1 text-[10px] text-dimx">{file ? `${(file.size / 1024).toFixed(1)} KB` : 'UTF-8 or Latin-1 · up to 8 MB · 200,000 rows'}</span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null) }} />
            </label>
            {file && <button className="flex items-center gap-1 text-[10px] text-dimx hover:text-loss" onClick={() => setFile(null)}><X className="h-3 w-3" /> Remove file</button>}
            <Callout tone="warn" title="Upload boundary">
              Only CSV text is accepted. The server validates size, structure, dates and OHLC consistency. It never executes uploaded content, and the file is stored under a generated name.
            </Callout>
          </div>
        ) : preview ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-4">
              {[['Rows', preview.rows.toLocaleString()], ['Columns', preview.columns.length], ['Size limit', `${preview.limits.max_mb} MB`], ['Format', 'CSV']].map(([label, value]) => (
                <div key={label as string} className="rounded border border-white/[0.06] p-2"><div className="eyebrow">{label as string}</div><div className="mt-1 text-[11px] text-white">{value}</div></div>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {MAPPING_FIELDS.map(([field, label]) => (
                <Field key={field} label={label}>
                  <Select value={mapping[field] ?? ''} onChange={(event) => setMapping({ ...mapping, [field]: event.target.value })}>
                    <option value="">— not mapped —</option>
                    {preview.columns.map((column) => <option key={column} value={column}>{column}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Dataset name"><input className="input" value={datasetName} onChange={(event) => setDatasetName(event.target.value)} maxLength={120} /></Field>
              <Field label="Date format (optional)" hint="Example: %Y-%m-%d. Leave blank for automatic parsing."><input className="input font-mono text-[11px]" value={dateFormat} onChange={(event) => setDateFormat(event.target.value)} placeholder="%Y-%m-%d" /></Field>
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-[10.5px] leading-relaxed text-mutedx">
              <input type="checkbox" className="mt-0.5 accent-violet-500" checked={dropInvalid} onChange={(event) => setDropInvalid(event.target.checked)} />
              Drop rows with inconsistent OHLC relationships. Otherwise they are retained and counted in the validation report.
            </label>

            <div>
              <div className="eyebrow mb-1.5">Preview · first {Math.min(5, preview.sample.length)} rows</div>
              <div className="max-h-40 overflow-auto rounded-lg border border-white/[0.06]">
                <table className="data-table">
                  <thead><tr>{preview.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                  <tbody>
                    {preview.sample.slice(0, 5).map((row, index) => (
                      <tr key={index}>{preview.columns.map((column) => <td key={column} className="max-w-[140px] truncate font-mono text-[9px] text-mutedx">{row[column]}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <Callout tone="info" title="Cleaning policy">
              Dates parse to UTC. Invalid timestamps or non-positive closes are dropped and counted. Duplicate timestamp+symbol rows keep the last.
              Adjusted close equals close; the uploader does not infer corporate actions. Gaps are reported, not filled.
            </Callout>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
