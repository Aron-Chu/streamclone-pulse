import { describe, expect, it } from 'vitest'
import {
  barXPercent,
  barWidthPercent,
  rhythmLines,
  trailingBucketXPercent,
  barStackSegments,
  type BarDims,
} from '../src/lib/hubChartGeometry'

const domain = (start: number, end: number, bucketMs: number) => ({
  start,
  endExclusive: end,
  bucketDurationMs: bucketMs,
})

describe('hubChartGeometry', () => {
  it('barXPercent returns the bucket-start x as percent', () => {
    const d = domain(0, 1000 * 60 * 60, 60_000) // 1h, 1-min buckets
    expect(barXPercent(0, d)).toBe(0)
    expect(barXPercent(30 * 60_000, d)).toBeCloseTo(50, 5)
    expect(barXPercent(60 * 60_000, d)).toBeNull() // out of range
  })

  it('barWidthPercent returns bucket span as percent', () => {
    const d = domain(0, 1000 * 60 * 60, 60_000)
    expect(barWidthPercent(d)).toBeCloseTo(100 / 60, 5)
  })

  it('rhythmLines returns null for empty points', () => {
    expect(rhythmLines([], { dims: { height: 100, paddingBottom: 0 } })).toBeNull()
  })

  it('rhythmLines returns single avg value when points.length === 1', () => {
    const points = [{ t: 0, viewers: 500 }]
    const lines = rhythmLines(points, { dims: { height: 100, paddingBottom: 0 } })
    expect(lines).not.toBeNull()
    expect(lines!.avg).toBe(100) // 500 / 500 data-max — single point is its own baseline
    expect(lines!.loud).toBeNull()
  })

  it('rhythmLines returns avg (median) and loud (p90) for many points', () => {
    const points = Array.from({ length: 100 }, (_, i) => ({ t: i, viewers: i * 10 }))
    const lines = rhythmLines(points, { dims: { height: 100, paddingBottom: 0 } })
    expect(lines).not.toBeNull()
    expect(lines!.avg).toBe((500 / 990) * 100) // median 500 / data-max 990
    expect(lines!.loud).toBe((900 / 990) * 100) // 90th pct 900 / data-max 990
  })

  it('barStackSegments returns three segments when all values > 0', () => {
    const dims: BarDims = { height: 100, paddingBottom: 0 }
    const segments = barStackSegments(
      { t: 0, viewers: 600, chat: 200, emotes: 100 } as any,
      dims,
      { viewers: 1000, chat: 500, emotes: 200 },
    )
    expect(segments).toHaveLength(3)
    expect(segments[0].color).toBe('viewers')
    expect(segments[0].height).toBeCloseTo(60, 5)
    expect(segments[1].color).toBe('chat')
    expect(segments[2].color).toBe('emotes')
  })

  it('barStackSegments omits segments whose value is 0', () => {
    const dims: BarDims = { height: 100, paddingBottom: 0 }
    const segments = barStackSegments(
      { t: 0, viewers: 500, chat: 0, emotes: 0 } as any,
      dims,
      { viewers: 1000, chat: 0, emotes: 0 },
    )
    expect(segments).toHaveLength(1)
    expect(segments[0].color).toBe('viewers')
  })

  it('trailingBucketXPercent returns null when no time domain', () => {
    expect(trailingBucketXPercent(null)).toBeNull()
  })

  it('trailingBucketXPercent returns 100 when domain is present', () => {
    expect(trailingBucketXPercent(domain(0, 1000, 100))).toBe(100)
  })
})
