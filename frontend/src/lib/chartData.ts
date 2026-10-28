import type { Bar } from './types'

/**
 * lightweight-charts needs UNIX seconds for intraday bars and a business-day
 * string for daily bars. Passing a date-only string for intraday data collapses
 * a whole session into a single candle, so the choice is made per bar.
 */
export type ChartTime = number | string

export function chartTime(bar: Bar): ChartTime {
  return typeof bar.time === 'number' ? bar.time : bar.date
}

export function isIntraday(bars: Bar[]): boolean {
  return bars.some((bar) => typeof bar.time === 'number')
}

/**
 * Rows for the candle and volume series: finite prices only, ascending order,
 * and one row per timestamp (the library throws on duplicate times). A repeated
 * timestamp keeps the last update, matching the server's own normalisation.
 */
export function toChartRows(bars: Bar[]): { bar: Bar; time: ChartTime }[] {
  const byTime = new Map<ChartTime, Bar>()
  for (const bar of bars) {
    if (
      !Number.isFinite(bar.open) ||
      !Number.isFinite(bar.high) ||
      !Number.isFinite(bar.low) ||
      !Number.isFinite(bar.close)
    ) {
      continue
    }
    byTime.set(chartTime(bar), bar)
  }
  return [...byTime.entries()]
    .map(([time, bar]) => ({ bar, time }))
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
}
