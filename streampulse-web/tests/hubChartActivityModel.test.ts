import { describe, expect, it, vi } from 'vitest'
import {
  deriveHubChartActivityModel,
  selectHubChartActivityInputs,
} from '../src/lib/hubChartActivityModel'
import { normalizePublicHub } from '../src/lib/publicHub'
import type { HubActivityPoint } from '../src/lib/publicHub'
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
})
