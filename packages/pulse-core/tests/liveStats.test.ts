import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  TREND_STABLE_RATIO,
  SYNCED_ROLLUP_THRESHOLD,
  computeTrend,
  liveConfidenceState,
  splitEmoteProviderRates,
  buildSparkline,
  deriveLiveStats,
  resolveViewerDataState,
  trendArrowGlyph,
  type LiveStatsInput,
  type LiveStatsRollup,
} from '../src/liveStats.ts'

const MINUTE_MS = 60_000

function makeRollups(
  count: number,
  shape: (i: number) => Partial<LiveStatsRollup> = () => ({}),
): LiveStatsRollup[] {
  const base = Date.parse('2026-06-11T12:00:00.000Z')
  return Array.from({ length: count }, (_, i) => ({
    minuteTs: new Date(base + i * MINUTE_MS).toISOString(),
    viewerSamples: 1,
    viewerLatest: 100,
    chatCount: 10,
    totalEmoteCount: 4,
    seventvEmoteCount: 2,
    emotes: {},
    ...shape(i),
  }))
}

describe('computeTrend', () => {
  it('reports stable within 10% tolerance', () => {
    assert.equal(computeTrend(105, 100), 'stable')
    assert.equal(computeTrend(110, 100), 'stable')
    assert.equal(computeTrend(120, 100), 'up')
    assert.equal(computeTrend(80, 100), 'down')
  })

  it('honors custom tolerance ratio', () => {
    assert.equal(computeTrend(140, 100, 0.5), 'stable')
    assert.equal(computeTrend(140, 100, TREND_STABLE_RATIO), 'up')
  })
})

describe('liveConfidenceState', () => {
  it('returns Collecting for live stream below synced threshold', () => {
    assert.equal(liveConfidenceState({ state: 'live', rollups: makeRollups(3) }), 'Collecting')
  })

  it('returns Synced once enough chat-bearing minutes exist', () => {
    assert.equal(
      liveConfidenceState({ state: 'live', rollups: makeRollups(SYNCED_ROLLUP_THRESHOLD) }),
      'Synced',
    )
  })
})

describe('deriveLiveStats', () => {
  it('is pure and deterministic', () => {
    const input: LiveStatsInput = { state: 'live', rollups: makeRollups(12) }
    assert.deepEqual(deriveLiveStats(input), deriveLiveStats(input))
  })

  it('builds sparkline from completed minutes only', () => {
    const rollups = makeRollups(8, i => ({ chatCount: i }))
    assert.deepEqual(buildSparkline(rollups, 3), [5, 6, 7])
  })

  it('falls back to safe zeros when empty', () => {
    const stats = deriveLiveStats({ state: 'live', rollups: [] })
    assert.equal(stats.confidence, 'Waiting for first minute')
    assert.deepEqual(stats.sparkline, [])
  })

  it('carries forward last known viewers across Helix trailing gaps', () => {
    const rollups = makeRollups(8, i => ({
      chatCount: 100 + i,
      viewerLatest: i < 5 ? 20_000 + i * 100 : 0,
      viewerAvg: i < 5 ? 20_000 + i * 100 : 0,
      viewerSamples: i < 5 ? 1 : 0,
    }))
    const stats = deriveLiveStats({ state: 'live', rollups })
    assert.equal(stats.currentViewers, 20_400)
    assert.equal(stats.viewersStale, true)
    assert.equal(stats.viewerDelta5m, null)
  })

  it('marks a fresh viewer sample as current', () => {
    const stats = deriveLiveStats({ state: 'live', rollups: makeRollups(8) })
    assert.equal(stats.viewersStale, false)
    assert.equal(stats.currentViewers, 100)
  })

  it('uses live metadata with explicit fresh, stale, and unknown states', () => {
    const fresh = deriveLiveStats({
      state: 'live',
      rollups: [],
      liveMetadata: { available: true, isLive: true, viewerCount: 812, freshnessSeconds: 12 },
    })
    const stale = deriveLiveStats({
      state: 'live',
      rollups: [],
      liveMetadata: { available: true, isLive: true, viewerCount: 812, freshnessSeconds: 240 },
    })
    const unknown = deriveLiveStats({
      state: 'live',
      rollups: [],
      liveMetadata: { available: true, isLive: true },
    })

    assert.equal(fresh.currentViewers, 812)
    assert.equal(fresh.viewerSource, 'liveMetadata')
    assert.equal(fresh.viewerState, 'fresh')
    assert.equal(stale.viewerState, 'stale')
    assert.equal(stale.viewersStale, true)
    assert.equal(unknown.currentViewers, null)
    assert.equal(unknown.viewerState, 'unknown')
    assert.equal(resolveViewerDataState(null), 'unknown')
  })

  it('does not turn an unobserved viewer field into zero', () => {
    const stats = deriveLiveStats({
      state: 'live',
      rollups: [{ chatCount: 12, viewerSamples: 0 }],
    })
    assert.equal(stats.currentViewers, null)
    assert.equal(stats.viewerState, 'unknown')
  })

  it('does not surface stale live metadata on an offline recap surface', () => {
    const stats = deriveLiveStats({
      state: 'historical',
      rollups: [{ chatCount: 12, viewerSamples: 1, viewerLatest: 4_200 }],
      liveMetadata: {
        available: true,
        isLive: true,
        viewerCount: 18_809,
        freshnessSeconds: 180_000,
      },
    })
    assert.equal(stats.currentViewers, 4_200)
    assert.equal(stats.viewerSource, 'rollup')
    assert.equal(stats.viewerState, 'fresh')
  })
})

describe('trendArrowGlyph', () => {
  it('maps directions', () => {
    assert.equal(trendArrowGlyph('up'), '▲')
    assert.equal(trendArrowGlyph('down'), '▼')
    assert.equal(trendArrowGlyph('stable'), '▬')
  })
})

describe('splitEmoteProviderRates', () => {
  it('splits 7TV and Other', () => {
    assert.deepEqual(splitEmoteProviderRates({ totalEmoteCount: 10, seventvEmoteCount: 4 }), [
      { provider: '7TV', perMinute: 4 },
      { provider: 'Other', perMinute: 6 },
    ])
  })
})
