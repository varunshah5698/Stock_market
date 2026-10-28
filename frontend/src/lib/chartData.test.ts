import { describe, expect, it } from 'vitest'
import { chartTime, isIntraday, toChartRows } from './chartData'
import type { Bar } from './types'

const bar = (over: Partial<Bar>): Bar => ({
  date: '2026-10-27',
  open: 100,
  high: 101,
  low: 99,
  close: 100.5,
  adj_close: 100.5,
  volume: 10,
  ...over,
})

describe('chartTime', () => {
  it('uses UNIX seconds for intraday bars', () => {
    expect(chartTime(bar({ time: 1793000000 }))).toBe(1793000000)
  })

  it('falls back to the business-day string for daily bars', () => {
    expect(chartTime(bar({}))).toBe('2026-10-27')
  })
})

describe('isIntraday', () => {
  it('detects intraday payloads', () => {
    expect(isIntraday([bar({ time: 1 }), bar({ time: 60 })])).toBe(true)
  })

  it('treats daily payloads as not intraday', () => {
    expect(isIntraday([bar({}), bar({ date: '2026-10-28' })])).toBe(false)
    expect(isIntraday([])).toBe(false)
  })
})

describe('toChartRows', () => {
  it('keeps one row per timestamp so the series cannot throw on duplicates', () => {
    const rows = toChartRows([bar({ time: 60 }), bar({ time: 60, close: 111 })])
    expect(rows).toHaveLength(1)
    expect(rows[0].bar.close).toBe(111) // last write wins, as the library expects
  })

  it('orders rows ascending by time', () => {
    const rows = toChartRows([bar({ time: 120 }), bar({ time: 60 })])
    expect(rows.map((r) => r.time)).toEqual([60, 120])
  })

  it('drops rows with non-finite prices instead of feeding NaN to the chart', () => {
    const rows = toChartRows([
      bar({ time: 60, close: Number.NaN }),
      bar({ time: 120, high: Number.POSITIVE_INFINITY }),
      bar({ time: 180 }),
    ])
    expect(rows.map((r) => r.time)).toEqual([180])
  })
})
