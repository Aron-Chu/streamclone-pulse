import { describe, expect, it } from 'vitest'
import {
  activityPointRates,
  applyLivePoolViewerFloor,
  bucketMinutes,
  chartActivityPoints,
  dropTrailingOpenBucket,
  fillActivityPoints,
  isOpenActivityBucket,
  normalizeActivityPointsForChart,
  peakActivityChatPerMin,
  peakActivityViewers,
  resolveChartBucketSelection,
  summarizeActivity,
} from '../src/lib/hubActivitySummary'
import type { HubActivityPoint } from '../src/lib/publicHub'

describe('isOpenActivityBucket / dropTrailingOpenBucket', () => {
  const bucketMs = 6 * 60_000
  const nowMs = Date.parse('2026-07-04T10:07:00Z')
  const openStart = Date.parse('2026-07-04T10:06:00Z')
  const completeStart = Date.parse('2026-07-04T10:00:00Z')

  it('marks open bucket via API flag', () => {
    expect(isOpenActivityBucket({ t: completeStart, chat: 0, seventv: 0, viewers: 1, bucketComplete: false }, 24 * 60, nowMs)).toBe(true)
    expect(isOpenActivityBucket({ t: completeStart, chat: 0, seventv: 0, viewers: 1, bucketComplete: true }, 24 * 60, nowMs)).toBe(false)
  })

  it('detects open bucket when period end is after now', () => {
    expect(isOpenActivityBucket({ t: openStart, chat: 0, seventv: 0, viewers: 46_000 }, 24 * 60, nowMs)).toBe(true)
    expect(isOpenActivityBucket({ t: completeStart, chat: 0, seventv: 0, viewers: 450_000 }, 24 * 60, nowMs)).toBe(false)
  })

  it('drops trailing open bucket from chart series', () => {
    const points: HubActivityPoint[] = [
      { t: completeStart, chat: 100, seventv: 10, viewers: 450_000 },
      { t: openStart, chat: 0, seventv: 0, viewers: 46_000, bucketComplete: false },
    ]
    const trimmed = dropTrailingOpenBucket(points, 24 * 60, nowMs)
    expect(trimmed).toHaveLength(1)
    expect(trimmed[0]?.t).toBe(completeStart)
  })
})

describe('applyLivePoolViewerFloor', () => {
  it('boosts only the trailing open bucket with live pool sum', () => {
    const bucketMs = 6 * 60_000
    const nowMs = Date.parse('2026-07-05T01:10:00Z')
    const openStart = Date.parse('2026-07-05T01:06:00Z')
    const completeStart = Date.parse('2026-07-05T01:00:00Z')
    const points: HubActivityPoint[] = [
      { t: completeStart, chat: 50_000, seventv: 0, viewers: 43_000, hasChatRollup: true, bucketComplete: true },
      { t: openStart, chat: 70_000, seventv: 0, viewers: 45_000, hasChatRollup: true, bucketComplete: false },
    ]
    const boosted = applyLivePoolViewerFloor(points, 358_000, 24 * 60, nowMs)
    expect(boosted[0]?.viewers).toBe(43_000)
    expect(boosted[1]?.viewers).toBe(358_000)
    void bucketMs
  })
})

describe('chartActivityPoints', () => {
  it('omits open bucket before coarse-bucket rate normalization', () => {
    const bucketMs = 6 * 60_000
    const nowMs = Date.parse('2026-07-04T10:07:00Z')
    const completeStart = Date.parse('2026-07-04T10:00:00Z')
    const openStart = Date.parse('2026-07-04T10:06:00Z')
    const points: HubActivityPoint[] = [
      { t: completeStart, chat: 600, seventv: 60, viewers: 450_000 },
      { t: openStart, chat: 120, seventv: 0, viewers: 46_000, bucketComplete: false },
    ]
    const charted = chartActivityPoints(points, 24 * 60, nowMs)
    expect(charted.every((p) => p.t !== openStart)).toBe(true)
    expect(charted.some((p) => p.chat === Math.round(600 / 6))).toBe(true)
    expect(charted.some((p) => p.chat === Math.round(120 / 6))).toBe(false)
    void bucketMs
  })

  it('keeps peak viewers consistent when recent Top-500 totals match across windows', () => {
    const nowMs = Date.parse('2026-07-04T10:31:00Z')
    const recentT = Date.parse('2026-07-04T10:29:00Z')
    const top500Viewers = 454_195
    const points30: HubActivityPoint[] = [{ t: recentT, chat: 4000, seventv: 400, viewers: top500Viewers, bucketComplete: true }]
    const points60: HubActivityPoint[] = [
      { t: recentT - 60_000, chat: 3800, seventv: 380, viewers: top500Viewers, bucketComplete: true },
      { t: recentT, chat: 4000, seventv: 400, viewers: top500Viewers, bucketComplete: true },
    ]
    expect(peakActivityViewers(points30, 30)).toBe(top500Viewers)
    expect(peakActivityViewers(points60, 60)).toBe(top500Viewers)
  })
})

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

describe('peakActivityViewers / peakActivityChatPerMin', () => {
  it('uses normalized chart series for 24h peaks', () => {
    const bucketMs = 6 * 60_000
    const end = Math.floor(Date.now() / bucketMs) * bucketMs
    const points: HubActivityPoint[] = [
      { t: end - bucketMs * 2, chat: 60, seventv: 6, viewers: 400_000 },
      { t: end - bucketMs, chat: 72, seventv: 8, viewers: 1_100_000 },
      { t: end, chat: 48, seventv: 4, viewers: 520_000 },
    ]
    const windowMinutes = 24 * 60
    expect(peakActivityViewers(points, windowMinutes)).toBe(1_100_000)
    expect(peakActivityChatPerMin(points, windowMinutes)).toBe(Math.round(72 / 6))
  })
})

describe('resolveChartBucketSelection', () => {
  it('selects buckets older than 3h when they have chart signal', () => {
    const oldT = Date.now() - 10 * 60 * 60 * 1000
    const point: HubActivityPoint = { t: oldT, chat: 12, seventv: 1, viewers: 500_000 }
    expect(resolveChartBucketSelection(point, null)).toBe(oldT)
  })

  it('clears when clicking the selected bucket again', () => {
    const t = Date.now() - 60_000
    const point: HubActivityPoint = { t, chat: 5, seventv: 0, viewers: 1000 }
    expect(resolveChartBucketSelection(point, t)).toBe(null)
  })

  it('ignores inactive buckets', () => {
    const t = Date.now() - 5 * 60 * 60 * 1000
    const point: HubActivityPoint = { t, chat: 0, seventv: 0, viewers: 0 }
    expect(resolveChartBucketSelection(point, null)).toBeUndefined()
  })
})

describe('summarizeActivity', () => {
  it('footnote distinguishes corpus rollups from live pool size', () => {
    const summary = summarizeActivity(
      [{ t: Date.now(), chat: 10, seventv: 1, viewers: 1000 }],
      360,
      76,
    )
    expect(summary.footnote).toContain('corpus-wide rollups')
    expect(summary.footnote).toContain('76 channels in live pool')
  })
})
