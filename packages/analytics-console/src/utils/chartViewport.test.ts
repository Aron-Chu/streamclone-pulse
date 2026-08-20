import { describe, expect, it } from 'vitest'
import {
  fullChartViewport,
  normalizeChartViewport,
  wheelZoomChartViewport,
} from './chartViewport.ts'

describe('analytics chart viewport', () => {
  it('starts the full domain at the first attested offset', () => {
    expect(fullChartViewport(7200, 1800)).toEqual({
      startSeconds: 1800,
      endSeconds: 7200,
    })
  })

  it('keeps wheel zoom anchored and inside the attested domain', () => {
    const next = wheelZoomChartViewport(
      { startSeconds: 1800, endSeconds: 7200 },
      7200,
      -120,
      3600,
      1800,
    )
    expect(next.startSeconds).toBeGreaterThanOrEqual(1800)
    expect(next.endSeconds).toBeLessThanOrEqual(7200)
    expect((3600 - next.startSeconds) / (next.endSeconds - next.startSeconds)).toBeCloseTo(1 / 3, 2)
  })

  it('normalizes a stale viewport after the session duration changes', () => {
    expect(normalizeChartViewport(
      { startSeconds: 0, endSeconds: 99999 },
      3600,
      600,
    )).toEqual({ startSeconds: 600, endSeconds: 3600 })
  })
})
