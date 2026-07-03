import { describe, expect, it } from 'vitest'
import { normalizePublicHub, validatePublicHubInvariants } from '../src/lib/publicHub'

describe('validatePublicHubInvariants', () => {
  it('warns when roster live count exceeds bounded hub rows', () => {
    const hub = normalizePublicHub({
      poolSize: 50,
      liveChannels: [{ login: 'xqc', viewers: 1000, chatPerMin: 10, seventvPerMin: 2, coverageState: 'synced', trendPct: 0 }],
      corpusPipeline: {
        topN: 500,
        state: 'degraded',
        generatedAt: new Date().toISOString(),
        collectorActive: 40,
        collectorMax: 63,
        roster: {
          live: 82,
          collectorTracking: 42,
          expectedCollectorRows: 63,
          liveCollectorDeficitRows: 21,
          metadataOnly: 14,
          metadataStale: 0,
          admissionDisabled: 0,
          capacityBlocked: 0,
          warming: 2,
          collecting: 49,
          viewerOnly: 17,
          zeroChatAfterAge: 0,
        },
      },
      activity: {
        windowMinutes: 60 * 24 * 7,
        channelCount: 39,
        points: [
          { t: 1, chat: 10, seventv: 5, viewers: 100 },
          { t: 61_001, chat: 12, seventv: 6, viewers: 110 },
        ],
      },
    })

    const issues = validatePublicHubInvariants(hub)
    expect(issues.some((issue) => issue.code === 'live_roster_vs_hub_rows')).toBe(true)
    expect(issues.some((issue) => issue.severity === 'error')).toBe(false)
  })

  it('flags unsorted activity timestamps', () => {
    const hub = normalizePublicHub({
      activity: {
        windowMinutes: 60,
        channelCount: 1,
        points: [
          { t: 1000, chat: 1, seventv: 0, viewers: 1 },
          { t: 500, chat: 1, seventv: 0, viewers: 1 },
        ],
      },
    })

    expect(validatePublicHubInvariants(hub).some((issue) => issue.code === 'activity_points_unsorted')).toBe(true)
  })
})
