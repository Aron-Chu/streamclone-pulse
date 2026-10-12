import { describe, expect, it } from 'vitest'
import { normalizePublicHub, type HubActivityPoint } from '../src/lib/publicHub'
import { deriveHubChartActivityModel, selectHubChartActivityInputs } from '../src/lib/hubChartActivityModel'
import {
  hubSampledViewerExtremes,
  hubViewerScopes,
  sampledRosterLabel,
  watchingNowDefinition,
} from '../src/lib/hubViewerScopes'

const bucketMs = 6 * 60_000
const end = Math.floor((Date.now() - 2 * bucketMs) / bucketMs) * bucketMs

// Shape of the hosted 24h projection: complete sampling passes over a 500
// channel roster with 41-75 of them live, a few corpus buckets without a
// sampling pass, and a live list of 500 channels that adds up to far more.
function sampled(i: number, viewers: number, live: number): HubActivityPoint {
  return {
    t: end - (19 - i) * bucketMs,
    chat: 50_000 + i,
    emotes: 30_000,
    seventv: 8_000,
    viewers,
    hasChatRollup: true,
    hasViewerRollup: true,
    bucketComplete: true,
    viewerCoverage: 'complete',
    viewerContributors: live,
    viewerExpectedContributors: 500,
  }
}

function hubFixture() {
  const points: HubActivityPoint[] = Array.from({ length: 20 }, (_, i) =>
    sampled(i, i === 6 ? 730_036 : 300_000 + i * 1_000, i === 6 ? 75 : 41),
  )
  // A corpus bucket without a complete pass: higher, but a different population.
  points[3] = { ...points[3], viewers: 2_132_848, viewerCoverage: 'partial', viewerContributors: undefined, viewerExpectedContributors: undefined }
  const liveChannels = Array.from({ length: 500 }, (_, i) => ({
    login: `channel${i}`,
    viewers: i < 10 ? 100_000 : 1_700,
    chatPerMin: 1,
    seventvPerMin: 0,
    coverageState: 'synced',
    trendPct: 0,
  }))
  return normalizePublicHub({
    poolSize: 999,
    liveChannels,
    activity: {
      windowMinutes: 1440,
      requestedWindowMinutes: 1440,
      servedWindowMinutes: 1440,
      availableWindowMinutes: 1440,
      source: 'historical_projection',
      projectionGeneration: 'hub_activity_scalar',
      channelCount: 999,
      points,
      livePoolViewerSum: 1_000_000 + 490 * 1_700,
    },
  } as unknown as Parameters<typeof normalizePublicHub>[0])
}

describe('hub viewer scopes', () => {
  it('reads the peak and the newest value from the same fully sampled series', () => {
    const hub = hubFixture()
    const model = deriveHubChartActivityModel(selectHubChartActivityInputs(hub))
    const { peak, latest } = hubSampledViewerExtremes(model.chartPoints)
    expect(peak?.viewers).toBe(730_036)
    expect(latest).not.toBeNull()
    // Same series: the peak can never be below the newest value.
    expect(peak!.viewers).toBeGreaterThanOrEqual(latest!.viewers)
    // The headline model peak is the chart's own qualified peak, not the
    // partial corpus bucket.
    expect(model.peakViewers).toBe(peak!.viewers)
    expect(model.peakViewersAt).toBe(peak!.t)
  })

  it('keeps the peak at least the newest value for any fully sampled series', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const points = Array.from({ length: 30 }, (_, i) =>
        sampled(i % 20, Math.round(Math.abs(Math.sin(seed * (i + 1))) * 900_000), 40 + (i % 30)),
      ).map((p, i) => ({ ...p, t: end - (29 - i) * bucketMs }))
      const { peak, latest } = hubSampledViewerExtremes(points)
      expect(peak!.viewers).toBeGreaterThanOrEqual(latest!.viewers)
    }
  })

  it('keeps watching-now on its own population and scope', () => {
    const hub = hubFixture()
    const model = deriveHubChartActivityModel(selectHubChartActivityInputs(hub))
    const scopes = hubViewerScopes(hub, model.chartPoints)
    expect(scopes.watchingNow).toEqual({ viewers: 1_833_000, liveChannels: 500 })
    // The two populations legitimately disagree; they are never one strip.
    expect(scopes.watchingNow.viewers).toBeGreaterThan(scopes.sampledPeak!.viewers)
    expect(watchingNowDefinition(500)).toMatch(/500 tracked channels live in this snapshot/)
    expect(watchingNowDefinition(500)).toMatch(/not comparable/)
  })

  it('names the sampled roster only when the backend gave its counts', () => {
    expect(sampledRosterLabel({ liveChannels: 75, rosterChannels: 500 })).toBe('75 live of 500 sampled channels')
    expect(sampledRosterLabel({ liveChannels: undefined, rosterChannels: 500 })).toBeNull()
    expect(sampledRosterLabel(null)).toBeNull()
  })
})
