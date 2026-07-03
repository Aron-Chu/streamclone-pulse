import { describe, expect, it } from 'vitest'
import {
  activityPointRates,
  bucketMinutes,
  fillActivityPoints,
  normalizeActivityPointsForChart,
} from '../src/lib/hubActivitySummary'
import type { HubActivityPoint } from '../src/lib/publicHub'

describe('fillActivityPoints', () => {
  const bucketMs = 42 * 60_000
  const end = Date.parse('2026-06-30T12:00:00Z')
  const alignedEnd = Math.floor(end / bucketMs) * bucketMs

  it('builds an evenly spaced grid for sparse 7d data', () => {
    const sparse: HubActivityPoint[] = [
      { t: alignedEnd - bucketMs, chat: 120, seventv: 10, viewers: 40_000 },
      { t: alignedEnd, chat: 200, seventv: 20, viewers: 55_000 },
    ]
    const filled = fillActivityPoints(sparse, 7 * 24 * 60)
    expect(filled.length).toBeGreaterThan(2)
    expect(filled[filled.length - 1]?.t).toBe(alignedEnd)
    expect(filled[filled.length - 2]?.chat).toBe(120)
    expect(filled[0]?.chat).toBe(0)
  })
})

describe('normalizeActivityPointsForChart', () => {
  it('converts coarse bucket totals to per-minute rates', () => {
    const windowMinutes = 7 * 24 * 60
    const bucketMin = bucketMinutes(windowMinutes)
    const point: HubActivityPoint = { t: Date.now(), chat: 4200, seventv: 420, viewers: 50_000 }
    const normalized = activityPointRates(point, windowMinutes)
    expect(normalized.chat).toBe(Math.round(4200 / bucketMin))
    expect(normalized.seventv).toBe(Math.round(420 / bucketMin))
    expect(normalized.viewers).toBe(50_000)
  })

  it('normalizes 24h six-minute buckets to per-minute rates', () => {
    const bucketMs = 6 * 60_000
    const end = Math.floor(Date.now() / bucketMs) * bucketMs
    const point: HubActivityPoint = { t: end - bucketMs, chat: 42, seventv: 4, viewers: 1000 }
    const filled = normalizeActivityPointsForChart(
      [point, { ...point, t: end, chat: 50 }],
      24 * 60,
    )
    expect(filled.some((row) => row.chat === Math.round(42 / 6))).toBe(true)
    expect(filled.some((row) => row.chat === Math.round(50 / 6))).toBe(true)
    expect(filled.some((row) => row.viewers === 1000)).toBe(true)
  })
})
