import { describe, expect, it } from 'vitest'
import {
  chartActivityPoints,
  fillActivityPoints,
  maxConnectedGapMs,
} from '../src/lib/hubActivitySummary'
import {
  formatHubActivityServedLabel,
  hubActivityHonestyChipLabel,
  hubActivityHonestyDetail,
  hubActivityRegisteredGapCount,
  isAttestedActivityGap,
  isHubActivityFullyMeasured,
  isHubActivityHealthyHistoricalProjection,
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

function makePoints(count: number, endMs = Date.now(), stepMs = 60_000): HubActivityPoint[] {
  const end = Math.floor(endMs / 60_000) * 60_000
  return Array.from({ length: count }, (_, i) => ({
    t: end - (count - 1 - i) * stepMs,
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

  it('keeps the degraded path unchanged when measured/accounted fields are absent', () => {
    expect(hubActivityRegisteredGapCount(degraded)).toBe(0)
    expect(isHubActivityFullyMeasured(degraded)).toBe(false)
    expect(isHubActivityHealthyHistoricalProjection(degraded)).toBe(false)
    expect(resolveHubActivityChartWindowMinutes(degraded)).toBe(30)
    expect(hubActivityHonestyDetail(degraded)).toContain('live-pool activity only')
  })

  it('accepts only an explicit, served-window-consistent healthy projection as full history', () => {
    const healthy: HubActivity = {
      points: makePoints(60),
      windowMinutes: 1440,
      channelCount: 12,
      source: 'historical_projection',
      state: 'healthy',
      availableWindowMinutes: 1440,
    }
    expect(isHubActivityLivePoolFallback(healthy)).toBe(false)
    expect(isHubActivityHealthyHistoricalProjection(healthy)).toBe(true)
    expect(isHubActivityFullyMeasured(healthy)).toBe(true)
    expect(resolveHubActivityChartWindowMinutes(healthy)).toBe(1440)
    expect(formatHubActivityServedLabel(healthy)).toBe('1 day')
  })

  it('does not promote a mismatched historical payload to a full requested chart', () => {
    const incomplete: HubActivity = {
      points: makePoints(30),
      windowMinutes: 1440,
      channelCount: 12,
      source: 'historical_projection',
      state: 'healthy',
      availableWindowMinutes: 30,
    }

    expect(isHubActivityHealthyHistoricalProjection(incomplete)).toBe(false)
    expect(resolveHubActivityChartWindowMinutes(incomplete)).toBe(30)
    expect(fillActivityPoints(incomplete.points, resolveHubActivityChartWindowMinutes(incomplete))).toHaveLength(30)
  })

  it('does not expand legacy long-window payloads without honesty metadata', () => {
    const legacy: HubActivity = {
      points: makePoints(30),
      windowMinutes: 1440,
      channelCount: 12,
    }
    expect(isHubActivityHealthyHistoricalProjection(legacy)).toBe(false)
    expect(resolveHubActivityChartWindowMinutes(legacy)).toBe(30)
  })

  it('keeps a legacy point series that spans the requested long window', () => {
    const legacy: HubActivity = {
      points: makePoints(240, Date.now(), 6 * 60_000),
      windowMinutes: 1440,
      channelCount: 12,
    }

    expect(isHubActivityHealthyHistoricalProjection(legacy)).toBe(false)
    expect(resolveHubActivityChartWindowMinutes(legacy)).toBe(1440)
    expect(fillActivityPoints(legacy.points, resolveHubActivityChartWindowMinutes(legacy))).toHaveLength(240)
  })

  it('requires availableWindowMinutes on the healthy projection path', () => {
    const missingAvailable: HubActivity = {
      points: makePoints(60),
      windowMinutes: 1440,
      channelCount: 12,
      source: 'historical_projection',
      state: 'healthy',
    }
    expect(isHubActivityHealthyHistoricalProjection(missingAvailable)).toBe(false)
    expect(resolveHubActivityChartWindowMinutes(missingAvailable)).toBe(30)
  })
})

describe('hub activity honesty (attested known gaps)', () => {
  const end = Math.floor(Date.parse('2026-08-08T12:00:00Z') / 60_000) * 60_000
  const gapT = end - 60_000
  const pointsWithAttestedGap: HubActivityPoint[] = [
    {
      t: end - 2 * 60_000,
      chat: 40,
      seventv: 4,
      viewers: 2000,
      hasChatRollup: true,
      hasViewerRollup: true,
      bucketComplete: true,
    },
    {
      t: gapT,
      chat: 0,
      seventv: 0,
      viewers: 0,
      hasChatRollup: false,
      hasViewerRollup: false,
      gapKind: 'attested',
      bucketComplete: true,
    },
    {
      t: end,
      chat: 50,
      seventv: 5,
      viewers: 2100,
      hasChatRollup: true,
      hasViewerRollup: true,
      bucketComplete: true,
    },
  ]

  const withGaps: HubActivity = {
    points: pointsWithAttestedGap,
    windowMinutes: 1440,
    channelCount: 12,
    source: 'historical_projection',
    state: 'healthy',
    availableWindowMinutes: 1440,
    measuredWindowMinutes: 1439,
    accountedWindowMinutes: 1440,
    registeredGapCount: 1,
  }

  it('treats measured vs accounted windows honestly and never claims fully measured', () => {
    expect(isHubActivityHealthyHistoricalProjection(withGaps)).toBe(true)
    expect(isHubActivityFullyMeasured(withGaps)).toBe(false)
    expect(hubActivityRegisteredGapCount(withGaps)).toBe(1)
    expect(resolveHubActivityChartWindowMinutes(withGaps)).toBe(1440)
    expect(hubActivityHonestyChipLabel(withGaps)).toBe('1 attested gap')
    expect(hubActivityHonestyDetail(withGaps)).toContain('attested gap')
    expect(hubActivityHonestyDetail(withGaps)).toContain('measured')

    const hub = hubWithActivity(withGaps)
    expect(hub.activity.measuredWindowMinutes).toBe(1439)
    expect(hub.activity.accountedWindowMinutes).toBe(1440)
    expect(hub.activity.registeredGapCount).toBe(1)
    expect(selectHubChartActivityInputs(hub).windowMinutes).toBe(1440)
  })

  it('rejects dishonest measured==full-window claims when registered gaps exist', () => {
    const dishonest: HubActivity = {
      ...withGaps,
      measuredWindowMinutes: 1440,
      accountedWindowMinutes: 1440,
      registeredGapCount: 1,
    }
    expect(isHubActivityHealthyHistoricalProjection(dishonest)).toBe(false)
    expect(isHubActivityFullyMeasured(dishonest)).toBe(false)
  })

  it('does not interpolate across an attested gap as measured data', () => {
    const chartPoints = chartActivityPoints(pointsWithAttestedGap, 30, end + 60_000, 0)
    const gap = chartPoints.find((point) => point.t === gapT)
    expect(gap).toBeDefined()
    expect(isAttestedActivityGap(gap!)).toBe(true)
    expect(gap!.hasChatRollup).toBe(false)
    expect(gap!.chat).toBe(0)
    expect(gap!.viewers).toBe(0)

    const measuredNeighbors = chartPoints.filter(
      (point) => point.hasChatRollup === true && point.t !== gapT,
    )
    expect(measuredNeighbors.length).toBeGreaterThanOrEqual(2)

    // Contiguous grid timestamps must still treat the attested bucket as a break,
    // not as a measured zero that would stitch the line through invented data.
    const gapIndex = chartPoints.findIndex((point) => point.t === gapT)
    expect(gapIndex).toBeGreaterThan(0)
    expect(chartPoints[gapIndex - 1]?.hasChatRollup).toBe(true)
    expect(chartPoints[gapIndex + 1]?.hasChatRollup).toBe(true)
    expect(chartPoints[gapIndex]?.gapKind).toBe('attested')

    // Time delta across the single-minute attested hole stays under maxConnectedGapMs;
    // honesty therefore relies on gapKind / hasChatRollup, not only sparse timestamps.
    expect((chartPoints[gapIndex + 1]?.t ?? 0) - (chartPoints[gapIndex - 1]?.t ?? 0)).toBeLessThanOrEqual(
      maxConnectedGapMs(30),
    )
  })

  it('keeps degraded live-pool fallback behavior when gap fields are also present but unused', () => {
    const degradedWithNoise: HubActivity = {
      points: makePoints(30),
      windowMinutes: 1440,
      channelCount: 12,
      state: 'degraded',
      source: 'live_pool_fallback',
      reason: 'historical_projection_unavailable',
      availableWindowMinutes: 30,
      measuredWindowMinutes: 30,
      accountedWindowMinutes: 30,
      registeredGapCount: 0,
    }
    expect(isHubActivityLivePoolFallback(degradedWithNoise)).toBe(true)
    expect(isHubActivityHealthyHistoricalProjection(degradedWithNoise)).toBe(false)
    expect(resolveHubActivityChartWindowMinutes(degradedWithNoise)).toBe(30)
    expect(fillActivityPoints(degradedWithNoise.points, 30).length).toBeLessThanOrEqual(40)
  })
})
