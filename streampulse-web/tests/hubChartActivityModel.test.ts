import { describe, expect, it, vi } from 'vitest'
import {
  deriveHubChartActivityModel,
  selectHubChartActivityInputs,
} from '../src/lib/hubChartActivityModel'
import { normalizePublicHub } from '../src/lib/publicHub'
import type { HubActivityPoint } from '../src/lib/publicHub'
import type { HubActivityMomentMarker } from '../src/ui/components/hub/HubActivityChart'
import * as hubActivitySummary from '../src/lib/hubActivitySummary'

function fixtureHub(points: HubActivityPoint[]) {
  return normalizePublicHub({
    poolSize: 12,
    liveChannels: [
      { login: 'a', viewers: 1000, chatPerMin: 10, seventvPerMin: 1, coverageState: 'synced', trendPct: 0 },
      { login: 'b', viewers: 2000, chatPerMin: 20, seventvPerMin: 2, coverageState: 'synced', trendPct: 0 },
    ],
    corpusPipeline: { collectorActive: 10, collectorMax: 300, roster: { live: 12 } },
    activity: {
      windowMinutes: 30,
      channelCount: 2,
      points,
      livePoolViewerSum: 3000,
    },
  })
}

const fixtureMarkers: HubActivityMomentMarker[] = [
  { key: 'a', bucketT: 0, kind: 'chat_spike' },
  { key: 'b', bucketT: 60_000, kind: 'lifecycle' },
]

describe('hubChartActivityModel', () => {
  const nowMs = Date.parse('2026-07-11T18:00:00Z')
  const points: HubActivityPoint[] = [
    {
      t: Date.parse('2026-07-11T17:58:00Z'),
      chat: 100,
      seventv: 10,
      viewers: 2500,
      hasChatRollup: true,
      bucketComplete: true,
    },
    {
      t: Date.parse('2026-07-11T17:59:00Z'),
      chat: 120,
      seventv: 12,
      viewers: 2600,
      hasChatRollup: true,
      bucketComplete: true,
    },
  ]

  it('selects only chart-relevant inputs (ignores trust/refresh metadata)', () => {
    const hub = fixtureHub(points)
    const a = selectHubChartActivityInputs(hub)
    const b = selectHubChartActivityInputs({
      ...hub,
      // Unrelated identity noise that must not change chart inputs.
      generatedAt: (hub.generatedAt ?? 0) + 1,
      poolSize: hub.poolSize,
    })
    expect(a.points).toBe(hub.activity.points)
    expect(a.windowMinutes).toBe(30)
    expect(a.livePoolViewerSum).toBe(3000)
    expect(b.points).toBe(a.points)
    expect(b.windowMinutes).toBe(a.windowMinutes)
    expect(b.livePoolViewerSum).toBe(a.livePoolViewerSum)
  })

  it('derives identical chart points and peaks for the same inputs', () => {
    const inputs = selectHubChartActivityInputs(fixtureHub(points))
    const first = deriveHubChartActivityModel(inputs, nowMs)
    const second = deriveHubChartActivityModel(inputs, nowMs)
    expect(second.chartPoints).toEqual(first.chartPoints)
    expect(second.peakViewers).toBe(first.peakViewers)
    expect(second.peakChatPerMin).toBe(first.peakChatPerMin)
    expect(second.peakEmotesPerMin).toBe(first.peakEmotesPerMin)
    expect(first.chartPoints.length).toBeGreaterThan(0)
    expect(first.chartState).toBe('ready')
    expect(first.measuredPointCount).toBeGreaterThan(0)
    expect(first.signalPointCount).toBeGreaterThan(0)
  })

  it('keeps healthy 24h projection and degraded 30m fallback on separate domains', () => {
    const healthyHub = normalizePublicHub({
      activity: {
        points: Array.from({ length: 60 }, (_, i) => ({
          t: i * 60_000,
          chat: 20 + i,
          seventv: 2,
          viewers: 100 + i,
          hasChatRollup: true,
          hasViewerRollup: true,
          bucketComplete: true,
        })),
        windowMinutes: 1440,
        channelCount: 2,
        state: 'healthy',
        source: 'historical_projection',
        availableWindowMinutes: 1440,
      },
    })
    const degradedHub = normalizePublicHub({
      activity: {
        points: Array.from({ length: 30 }, (_, i) => ({
          t: i * 60_000,
          chat: 20 + i,
          seventv: 2,
          viewers: 100 + i,
          hasChatRollup: true,
          hasViewerRollup: true,
          bucketComplete: true,
        })),
        windowMinutes: 1440,
        channelCount: 2,
        state: 'degraded',
        source: 'live_pool_fallback',
        reason: 'historical_projection_unavailable',
        availableWindowMinutes: 30,
      },
    })

    const healthyInputs = selectHubChartActivityInputs(healthyHub)
    const degradedInputs = selectHubChartActivityInputs(degradedHub)
    expect(healthyInputs.windowMinutes).toBe(1440)
    expect(degradedInputs.windowMinutes).toBe(30)
    expect(deriveHubChartActivityModel(healthyInputs).chartState).toBe('ready')
    expect(deriveHubChartActivityModel(degradedInputs).chartState).toBe('ready')
  })

  it('does not re-enter chartActivityPoints when only a trust-line clock changes', () => {
    const inputs = selectHubChartActivityInputs(fixtureHub(points))
    const spy = vi.spyOn(hubActivitySummary, 'chartActivityPoints')
    const model = deriveHubChartActivityModel(inputs, nowMs)
    // Peaks must come from the single derived series — not three extra chartActivityPoints calls.
    expect(spy).toHaveBeenCalledTimes(1)
    expect(model.peakViewers).toBe(Math.max(...model.chartPoints.map((p) => p.viewers)))
    spy.mockRestore()
  })

  it('returns rhythmLines when points are present', () => {
    const pts: HubActivityPoint[] = Array.from({ length: 10 }, (_, i) => ({
      t: i * 60_000,
      chat: i,
      seventv: i,
      viewers: 100 + i * 10,
    }))
    const out = deriveHubChartActivityModel(
      { points: pts, windowMinutes: 60, livePoolViewerSum: 0 },
      600_000,
    )
    expect(out.rhythmLines).not.toBeNull()
    if (out.rhythmLines) {
      expect(out.rhythmLines.avg).not.toBeNull()
    }
  })

  it('returns annotations when markers are provided', () => {
    const pts: HubActivityPoint[] = [
      { t: 0, chat: 50, seventv: 0, viewers: 100 },
      { t: 60_000, chat: 100, seventv: 0, viewers: 200 },
    ]
    const out = deriveHubChartActivityModel(
      {
        points: pts,
        windowMinutes: 60,
        livePoolViewerSum: 0,
        markers: fixtureMarkers,
      },
      120_000,
    )
    expect(out.annotations).toHaveLength(2)
    expect(out.annotations[0].kind).toBe('spike')
    expect(out.annotations[1].kind).toBe('moment')
  })

  it('keeps prior model invariants with markers present (single derive pass, peaks from derived series)', () => {
    const inputs = selectHubChartActivityInputs(fixtureHub(points))
    const spy = vi.spyOn(hubActivitySummary, 'chartActivityPoints')
    const model = deriveHubChartActivityModel(
      { ...inputs, markers: fixtureMarkers },
      nowMs,
    )
    expect(spy).toHaveBeenCalledTimes(1)
    expect(model.annotations).toHaveLength(2)
    expect(model.rhythmLines).not.toBeNull()
    expect(model.peakViewers).toBe(Math.max(...model.chartPoints.map((p) => p.viewers)))
    spy.mockRestore()
  })
})
