import { describe, expect, it } from 'vitest'
import { viewerScaleBounds } from '../src/viewerScale'

describe('viewerScaleBounds', () => {
  it('keeps the full positive range instead of clipping a brief spike at p95', () => {
    const plateau = Array.from({ length: 40 }, (_, i) => 58_000 + (i % 5) * 400)
    const values: Array<number | null> = [100, 500, 2000, 8000, 20000, ...plateau, 120_000]
    const axis = viewerScaleBounds(values, 120_000, true)
    expect(axis.mode).toBe('fit')
    expect(axis.min).toBe(0)
    expect(axis.max).toBeGreaterThanOrEqual(120_000)
    expect(axis.max).toBeLessThanOrEqual(124_000)
  })

  it('keeps a small top pad (~2–4%) above a flat series', () => {
    const values = Array.from({ length: 30 }, () => 50_000)
    const axis = viewerScaleBounds(values, 50_000, true)
    const topPad = (axis.max - 50_000) / 50_000
    expect(topPad).toBeGreaterThanOrEqual(0.02)
    expect(topPad).toBeLessThanOrEqual(0.05)
  })

  it('peak mode still anchors at zero using stream peak', () => {
    const values = [10_000, 20_000, 30_000]
    const axis = viewerScaleBounds(values, 90_000, false)
    expect(axis).toEqual({ min: 0, max: 90_000, mode: 'peak' })
  })

  it('handles empty / all-null series', () => {
    expect(viewerScaleBounds([null, null], 12_000, true)).toEqual({
      min: 0,
      max: 12_000,
      mode: 'fit',
    })
  })
})
