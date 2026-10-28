import { describe, expect, it } from 'vitest'
import { fmtCompact, fmtMoney, fmtPct, labelize, pctClass, signedQuantity, toneFor } from './format'

describe('format helpers', () => {
  it('formats percentages with an explicit sign only when asked', () => {
    expect(fmtPct(12.345)).toBe('+12.35%')
    expect(fmtPct(-3.2, 1)).toBe('-3.2%')
    expect(fmtPct(92.8, 1, false)).toBe('92.8%')
    expect(fmtPct(null)).toBe('—')
  })

  it('formats compact numbers and money safely', () => {
    expect(fmtCompact(1_250_000)).toBe('1.25M')
    expect(fmtCompact(null)).toBe('—')
    expect(fmtMoney(343.9, 'USD')).toBe('$343.90')
    expect(fmtMoney(null, 'USD')).toBe('—')
  })

  it('classifies market tones without treating zero as a loss', () => {
    expect(toneFor(0)).toBe('neutral')
    expect(toneFor(0.1)).toBe('gain')
    expect(toneFor(-0.1)).toBe('loss')
    expect(pctClass(null)).toContain('text-mutedx')
    expect(signedQuantity(10)).toBe('+10.00')
  })

  it('labels snake case fields for display', () => {
    expect(labelize('max_drawdown')).toBe('Max Drawdown')
  })
})
