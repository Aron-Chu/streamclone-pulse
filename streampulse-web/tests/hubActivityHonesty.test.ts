import { describe, expect, it } from 'vitest'
import {
  chartActivityPoints,
  fillActivityPoints,
} from '../src/lib/hubActivitySummary'
import {
  formatHubActivityServedLabel,
  hubActivityHonestyChipLabel,
  isHubActivityLivePoolFallback,
  resolveHubActivityChartWindowMinutes,
} from '../src/lib/hubActivityHonesty'
import { selectHubChartActivityInputs } from '../src/lib/hubChartActivityModel'
import {
  normalizePublicHub,
  type HubActivity,
  type HubActivityPoint,
  type PublicHub,
} from '../src/lib/publicHub'

function makePoints(count: number, endMs = Date.now()): HubActivityPoint[] {
  const end = Math.floor(endMs / 60_000) * 60_000
  return Array.from({ length: count }, (_, i) => ({
    t: end - (count - 1 - i) * 60_000,
    chat: 10 + i,
    seventv: 5,
    viewers: 1000 + i,
    bucketComplete: true,
    hasChatRollup: true,
    hasViewerRollup: true,
  }))
}

function hubWithActivity(activity: PublicHub['activity']): PublicHub {
  return normalizePublicHub({
    generatedAt: new Date().toISOString(),
    poolSize: 12,
    activity,
    corpusPipeline: {
      collectorActive: 10,
      collectorMax: 12,
      roster: { live: 12, collectorTracking: 10, expectedCollectorRows: 12, liveCollectorDeficitRows: 0 },
    },
  })
}

describe('hub activity honesty (live_pool_fallback)', () => {
  const degraded: HubActivity = {
    points: makePoints(30),
    windowMinutes: 1440,
    channelCount: 12,
    state: 'degraded',
    source: 'live_pool_fallback',
    reason: 'historical_projection_unavailable',
    availableWindowMinutes: 30,
  }

  it('detects degraded live_pool_fallback contract', () => {
    expect(isHubActivityLivePoolFallback(degraded)).toBe(true)
    expect(hubActivityHonestyChipLabel(degraded)).toBe('Recent live activity only')
    expect(formatHubActivityServedLabel(degraded)).toBe('Recent live activity only')
  })

  it('preserves requested windowMinutes while charting availableWindowMinutes', () => {
    expect(resolveHubActivityChartWindowMinutes(degraded)).toBe(30)
    const hub = hubWithActivity(degraded)
    expect(hub.activity.windowMinutes).toBe(1440)
    expect(hub.activity.availableWindowMinutes).toBe(30)
    expect(hub.activity.state).toBe('degraded')
    expect(hub.activity.source).toBe('live_pool_fallback')
    const inputs = selectHubChartActivityInputs(hub)
    expect(inputs.windowMinutes).toBe(30)
  })

  it('does not fabricate a full 24h grid of empty historical points when degraded', () => {
    const chartWindow = resolveHubActivityChartWindowMinutes(degraded)
    const filled = fillActivityPoints(degraded.points, chartWindow)
    const dishonest = fillActivityPoints(degraded.points, degraded.windowMinutes)
    expect(filled.length).toBeLessThanOrEqual(40)
    expect(dishonest.length).toBeGreaterThan(filled.length)
    expect(dishonest.length).toBeGreaterThan(100)
    const chartPoints = chartActivityPoints(
      degraded.points,
      chartWindow,
      undefined,
      0,
    )
    expect(chartPoints.length).toBe(filled.length)
  })

  it('leaves healthy payloads on the requested window', () => {
    const healthy: HubActivity = {
      points: makePoints(60),
      windowMinutes: 1440,
      channelCount: 12,
    }
    expect(isHubActivityLivePoolFallback(healthy)).toBe(false)
    expect(resolveHubActivityChartWindowMinutes(healthy)).toBe(1440)
    expect(formatHubActivityServedLabel(healthy)).toBe('1 day')
  })
})
