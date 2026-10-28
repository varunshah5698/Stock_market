import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, createChart, type Time } from 'lightweight-charts'
import { useEffect, useId, useMemo, useRef } from 'react'
import { cn, fmtCompact, fmtNumber, fmtPct } from '../lib/format'
import { isIntraday, toChartRows } from '../lib/chartData'
import type { Bar as PriceBar, IndicatorSeries } from '../lib/types'

const GRID = 'rgba(255,255,255,0.055)'
const AXIS = '#74778c'

export function Sparkline({
  values,
  width = 96,
  height = 30,
  positive,
  className,
}: {
  values: (number | null)[]
  width?: number
  height?: number
  positive?: boolean
  className?: string
}) {
  const gradientId = useId().replace(/:/g, '')
  const series = values.filter((value): value is number => value !== null && Number.isFinite(value))
  if (series.length < 2) return <div className={cn('h-[30px] w-24', className)} />
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || 1
  const step = width / (series.length - 1)
  const points = series.map((value, index) => `${(index * step).toFixed(2)},${(height - 3 - ((value - min) / span) * (height - 6)).toFixed(2)}`).join(' ')
  const up = positive ?? series[series.length - 1] >= series[0]
  const color = up ? '#34e0a1' : '#ff6b8a'
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <defs>
        <linearGradient id={`spark-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.24" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#spark-${gradientId})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function TooltipBox({ active, payload, label, names, formatter }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-white/10 bg-ink-850/95 px-3 py-2 shadow-card backdrop-blur">
      <div className="mb-1 font-mono text-[10px] text-dimx">{label}</div>
      <div className="space-y-1">
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center justify-between gap-4 text-[11px]">
            <span className="flex items-center gap-1.5 text-mutedx">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: entry.color ?? entry.fill }} />
              {names?.[entry.dataKey] ?? entry.name}
            </span>
            <span className="num text-white">{formatter ? formatter(entry.value) : fmtNumber(entry.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- time series */

export interface ChartSeries {
  name: string
  color: string
  values: (number | null)[]
  dashed?: boolean
}

export function MarketLineChart({
  dates,
  series,
  height = 260,
  valueFormatter = (value: number) => fmtNumber(value),
  yDomain,
  reference,
  className,
}: {
  dates: string[]
  series: ChartSeries[]
  height?: number
  valueFormatter?: (value: number) => string
  yDomain?: [number | 'auto', number | 'auto']
  reference?: number
  className?: string
}) {
  const data = useMemo(
    () =>
      dates.map((date, index) => {
        const row: Record<string, string | number | null> = { date }
        series.forEach((entry, seriesIndex) => {
          row[`s${seriesIndex}`] = entry.values[index] ?? null
        })
        return row
      }),
    [dates, series],
  )
  const names = useMemo(() => Object.fromEntries(series.map((entry, index) => [`s${index}`, entry.name])), [series])

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {series.map((entry) => (
          <span key={entry.name} className="flex items-center gap-1.5 text-[10.5px] text-mutedx">
            <span className="h-[2px] w-4 rounded" style={{ background: entry.color }} />
            {entry.name}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: AXIS, fontSize: 9 }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            minTickGap={48}
            tickFormatter={(value: string) => value.slice(0, 7)}
          />
          <YAxis
            tick={{ fill: AXIS, fontSize: 9 }}
            tickLine={false}
            axisLine={false}
            width={52}
            domain={yDomain ?? ['auto', 'auto']}
            tickFormatter={(value: number) => valueFormatter(value)}
          />
          <Tooltip content={<TooltipBox names={names} formatter={valueFormatter} />} />
          {reference !== undefined && <ReferenceLine y={reference} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 4" />}
          {series.map((entry, index) => (
            <Line
              key={entry.name}
              type="monotone"
              dataKey={`s${index}`}
              stroke={entry.color}
              strokeWidth={1.6}
              strokeDasharray={entry.dashed ? '4 3' : undefined}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function AreaTrend({
  dates,
  values,
  height = 180,
  color = '#8b5cf6',
  valueFormatter = (value: number) => fmtNumber(value),
}: {
  dates: string[]
  values: (number | null)[]
  height?: number
  color?: string
  valueFormatter?: (value: number) => string
}) {
  const gradientId = useId().replace(/:/g, '')
  const data = dates.map((date, index) => ({ date, value: values[index] }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`area-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity={0.32} />
            <stop offset="1" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tick={{ fill: AXIS, fontSize: 9 }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={48} tickFormatter={(value: string) => value.slice(0, 7)} />
        <YAxis tick={{ fill: AXIS, fontSize: 9 }} tickLine={false} axisLine={false} width={52} tickFormatter={valueFormatter} domain={['auto', 'auto']} />
        <Tooltip content={<TooltipBox names={{ value: 'Value' }} formatter={valueFormatter} />} />
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.7} fill={`url(#area-${gradientId})`} isAnimationActive={false} connectNulls />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/* --------------------------------------------------------------------- bars */

export function SimpleBars({
  data,
  height = 220,
  colorFor,
  layout = 'horizontal',
  valueFormatter = (value: number) => fmtNumber(value),
}: {
  data: { label: string; value: number }[]
  height?: number
  colorFor?: (value: number) => string
  layout?: 'horizontal' | 'vertical'
  valueFormatter?: (value: number) => string
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={layout === 'vertical' ? 'vertical' : 'horizontal'}
        margin={{ top: 6, right: 12, left: layout === 'vertical' ? 22 : 0, bottom: layout === 'vertical' ? 4 : 18 }}
        barCategoryGap="24%"
      >
        <CartesianGrid stroke={GRID} vertical={layout === 'vertical'} horizontal={layout !== 'vertical'} />
        {layout === 'vertical' ? (
          <>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="label" tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false} width={66} />
          </>
        ) : (
          <>
            <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 9 }} tickLine={false} axisLine={{ stroke: GRID }} interval={0} angle={data.length > 7 ? -28 : 0} textAnchor={data.length > 7 ? 'end' : 'middle'} height={data.length > 7 ? 48 : 24} />
            <YAxis tick={{ fill: AXIS, fontSize: 9 }} tickLine={false} axisLine={false} width={52} tickFormatter={valueFormatter} />
          </>
        )}
        <Tooltip content={<TooltipBox names={{ value: 'Value' }} formatter={valueFormatter} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey="value" radius={[4, 4, 4, 4]} isAnimationActive={false}>
          {data.map((entry, index) => (
            <Cell key={index} fill={colorFor ? colorFor(entry.value) : '#8b5cf6'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function SignedBars({
  dates,
  values,
  height = 180,
  formatter = (value: number) => fmtPct(value * 100),
}: {
  dates: string[]
  values: number[]
  height?: number
  formatter?: (value: number) => string
}) {
  const data = dates.map((date, index) => ({ date, value: values[index] }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tick={{ fill: AXIS, fontSize: 9 }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={48} tickFormatter={(value: string) => value.slice(0, 7)} />
        <YAxis tick={{ fill: AXIS, fontSize: 9 }} tickLine={false} axisLine={false} width={54} tickFormatter={formatter} />
        <Tooltip content={<TooltipBox names={{ value: 'Residual' }} formatter={formatter} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
        <Bar dataKey="value" isAnimationActive={false} radius={[2, 2, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.value >= 0 ? '#34e0a1' : '#ff6b8a'} fillOpacity={0.75} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/* -------------------------------------------------------------------- donut */

export function Donut({
  data,
  height = 220,
  centerLabel,
  centerValue,
  formatter = (value: number) => fmtPct(value * 100),
}: {
  data: { name: string; value: number; color?: string }[]
  height?: number
  centerLabel?: string
  centerValue?: string
  formatter?: (value: number) => string
}) {
  const palette = ['#8b5cf6', '#22d3ee', '#34e0a1', '#fbbf24', '#ff6b8a', '#60a5fa', '#c084fc', '#2dd4bf']
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="88%" paddingAngle={2} stroke="none" isAnimationActive={false}>
            {data.map((entry, index) => (
              <Cell key={entry.name} fill={entry.color ?? palette[index % palette.length]} />
            ))}
          </Pie>
          <Tooltip content={<TooltipBox names={{ value: 'Weight' }} formatter={formatter} />} />
        </PieChart>
      </ResponsiveContainer>
      {centerValue && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="num text-lg text-white">{centerValue}</div>
          <div className="eyebrow mt-1">{centerLabel}</div>
        </div>
      )}
    </div>
  )
}

/* --------------------------------------------------------------- heat / grid */

function heatColor(value: number, invert = false): string {
  if (!Number.isFinite(value)) return 'rgba(255,255,255,0.03)'
  const magnitude = Math.min(1, Math.abs(value))
  if (value > 0) return `rgba(52, 224, 161, ${0.06 + magnitude * 0.55})`
  if (value < 0) return `rgba(255, 107, 138, ${0.06 + magnitude * 0.55})`
  return 'rgba(255,255,255,0.04)'
}

export function CorrelationHeatmap({
  symbols,
  matrix,
  size = 'md',
}: {
  symbols: string[]
  matrix: number[][]
  size?: 'sm' | 'md'
}) {
  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-[320px] gap-1"
        style={{ gridTemplateColumns: `minmax(52px, 1fr) repeat(${symbols.length}, minmax(38px, 1fr))` }}
      >
        <div />
        {symbols.map((symbol) => (
          <div key={`head-${symbol}`} className="truncate px-1 pb-1 text-center font-mono text-[9px] text-dimx" title={symbol}>
            {symbol.replace('.NS', '')}
          </div>
        ))}
        {symbols.map((rowSymbol, rowIndex) => (
          <div key={rowSymbol} className="contents">
            <div className="flex items-center truncate pr-1 font-mono text-[9px] text-dimx" title={rowSymbol}>
              {rowSymbol.replace('.NS', '')}
            </div>
            {symbols.map((columnSymbol, columnIndex) => {
              const value = matrix[rowIndex]?.[columnIndex] ?? 0
              return (
                <div
                  key={`${rowSymbol}-${columnSymbol}`}
                  title={`${rowSymbol} / ${columnSymbol}: ${value.toFixed(3)}`}
                  className={cn(
                    'flex items-center justify-center rounded-[4px] border border-white/[0.04] num text-[9.5px] text-white/80 transition hover:border-white/20',
                    size === 'sm' ? 'h-7' : 'h-9',
                  )}
                  style={{ background: heatColor(value) }}
                >
                  {value.toFixed(2)}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 font-mono text-[9px] text-dimx">
        <span className="inline-block h-2 w-6 rounded-sm" style={{ background: heatColor(-1) }} />
        −1
        <span className="inline-block h-2 w-6 rounded-sm" style={{ background: heatColor(0) }} />
        0
        <span className="inline-block h-2 w-6 rounded-sm" style={{ background: heatColor(1) }} />
        +1
      </div>
    </div>
  )
}

export function RiskScatter({
  points,
  height = 240,
}: {
  points: { x: number; y: number; label: string }[]
  height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 10, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={GRID} />
        <XAxis type="number" dataKey="x" name="Volatility" tick={{ fill: AXIS, fontSize: 9 }} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
        <YAxis type="number" dataKey="y" name="Return" tick={{ fill: AXIS, fontSize: 9 }} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
        <ZAxis range={[80, 80]} />
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" />
        <Tooltip content={<TooltipBox names={{ x: 'Volatility', y: 'Return', label: 'Symbol' }} formatter={(value: number) => `${value.toFixed(2)}%`} />} />
        <Scatter data={points} fill="#8b5cf6" isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  )
}

export function FeatureImportance({ items }: { items: { feature: string; importance: number; definition?: string }[] }) {
  const max = Math.max(...items.map((item) => Math.abs(item.importance)), 0.0001)
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.feature} className="group" title={item.definition}>
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="truncate font-mono text-[10px] text-mutedx">{item.feature}</span>
            <span className="num text-[10px] text-dimx">{(item.importance * 100).toFixed(1)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.04]">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyanx/70" style={{ width: `${(item.importance / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function MonthlyReturnGrid({ data }: { data: { month: string; return_pct: number }[] }) {
  const years = Array.from(new Set(data.map((item) => item.month.slice(0, 4)))).sort()
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const lookup = new Map(data.map((item) => [item.month, item.return_pct]))
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-1 text-right">
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-dimx">
            <th className="pr-2 text-left font-mono">Year</th>
            {months.map((month) => (
              <th key={month} className="px-1 font-normal">{month}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {years.map((year) => (
            <tr key={year}>
              <td className="pr-2 text-left font-mono text-[10px] text-mutedx">{year}</td>
              {months.map((month, index) => {
                const key = `${year}-${String(index + 1).padStart(2, '0')}`
                const value = lookup.get(key)
                return (
                  <td
                    key={key}
                    className="rounded-sm px-1.5 py-1.5 num text-[9.5px]"
                    style={{ background: value !== undefined ? heatColor(value / 10) : 'transparent', color: value !== undefined ? 'rgba(255,255,255,.8)' : '#62657a' }}
                    title={value !== undefined ? `${key}: ${value.toFixed(2)}%` : undefined}
                  >
                    {value !== undefined ? value.toFixed(1) : '·'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------------------------------------------------------------- price chart */

/**
 * Intraday bars carry UNIX seconds; daily bars use the business-day string the
 * API returns, which the chart library accepts directly. Passing a date-only
 * string for intraday data collapses a whole session into one candle.
 */
export function PriceChart({
  bars,
  height = 380,
  overlays = [],
  showVolume = true,
  currency = 'USD',
}: {
  bars: PriceBar[]
  height?: number
  overlays?: { label: string; color: string; series: IndicatorSeries }[]
  showVolume?: boolean
  currency?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = containerRef.current
    if (!element || bars.length === 0) return
    const chart = createChart(element, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0b0b14' },
        textColor: '#9295ab',
        fontSize: 10,
        fontFamily: 'JetBrains Mono, monospace',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.035)' },
        horzLines: { color: 'rgba(255,255,255,0.035)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(167,139,250,0.4)', labelBackgroundColor: '#2a2340' },
        horzLine: { color: 'rgba(167,139,250,0.4)', labelBackgroundColor: '#2a2340' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        scaleMargins: { top: 0.06, bottom: showVolume ? 0.26 : 0.06 },
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        rightOffset: 2,
        barSpacing: 5,
      },
      localization: {
        priceFormatter: (price: number) => price.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    })

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#34e0a1',
      downColor: '#ff6b8a',
      borderVisible: false,
      wickUpColor: 'rgba(52,224,161,0.65)',
      wickDownColor: 'rgba(255,107,138,0.65)',
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    })
    // The library requires ascending, unique times; helpers live in lib/chartData.
    const rows = toChartRows(bars)
    const intraday = isIntraday(bars)
    candles.setData(
      rows.map(({ bar, time }) => ({
        time: time as Time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    )

    if (showVolume) {
      const volume = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      })
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
      volume.setData(
        rows.map(({ bar, time }) => ({
          time: time as Time,
          value: bar.volume,
          color: bar.close >= bar.open ? 'rgba(52,224,161,0.28)' : 'rgba(255,107,138,0.25)',
        })),
      )
    }

    // Indicator overlays are computed on daily closes, so they only align with
    // daily bars; on an intraday timeframe they would repeat one timestamp per
    // session and are therefore not drawn.
    for (const overlay of intraday ? [] : overlays) {
      const lookup = new Map<string, number>()
      overlay.series.dates.forEach((date, index) => {
        const value = overlay.series.values[index]
        if (value !== null && Number.isFinite(value)) lookup.set(date, value as number)
      })
      if (lookup.size === 0) continue
      const line = chart.addSeries(LineSeries, {
        color: overlay.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      line.setData(
        bars
          .filter((bar) => lookup.has(bar.date))
          .map((bar) => ({ time: bar.date as Time, value: lookup.get(bar.date) as number })),
      )
    }

    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [bars, overlays, showVolume])

  return (
    <div>
      <div ref={containerRef} style={{ height }} className="w-full overflow-hidden rounded-lg border border-white/[0.05]" role="img" aria-label={`Candlestick price chart in ${currency}`} />
      <div className="mt-1.5 flex justify-between font-mono text-[9px] text-dimx">
        <span>Drag to pan · scroll to zoom · crosshair to inspect</span>
        <span>{currency} · adjusted OHLC basis</span>
      </div>
    </div>
  )
}

export { fmtCompact, fmtPct }
