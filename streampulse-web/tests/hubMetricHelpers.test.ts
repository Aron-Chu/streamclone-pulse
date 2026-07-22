import { describe, expect, it } from 'vitest'
import {
  activityViewersBelowLivePool,
  hubMetricLegend,
  livePoolViewerSum,
} from '../src/lib/hubMetricHelpers'
import type { PublicHub } from '../src/lib/publicHub'
import { hubCorpusPipelineFixture, normalizePublicHub } from '../src/lib/publicHub'

function baseHub(overrides: Partial<PublicHub> = {}): PublicHub {
  return normalizePublicHub({
    generatedAt: new Date().toISOString(),
    poolSize: 100,
    corpus: { streamsTracked: 14000, momentsDetected: 0, chatMessagesProcessed: 0, emotesIndexed: 0, vodsAnalyzed: 0 },
    coverage: { liveChannels: 120, trackingMax: 250, backfillActive: 0, backfillMax: 0, syncActive: 0, emotesIndexed: 0, databaseOk: true, state: 'operational' },
    corpusPipeline: hubCorpusPipelineFixture({
      state: 'healthy',
      collectorActive: 80,
      collectorMax: 250,
      liveAdmissionTopN: 250,
      maxActiveIrcChannels: 250,
      roster: { live: 120 },
    }),
    activity: {
      windowMinutes: 7 * 24 * 60,
      channelCount: 100,
      points: [
        {
          t: Date.now() - 7 * 24 * 60 * 60 * 1000,
          viewers: 40000,
          chat: 1000,
          emotes: 500,
          seventv: 200,
          bucketComplete: true,
        },
      ],
      livePoolViewerSum: 55000,
    },
    emoteIntel: { emotesPerMin: 100, topEmoteSharePct: 10, uniqueEmotes: 50, biggestPeakPerMin: 200, seventvSharePct: 40, providerShares: [] },
    liveChannels: [
      { login: 'a', viewers: 30000, chatPerMin: 100, seventvPerMin: 50, coverageState: 'collecting', trendPct: 0 },
      { login: 'b', viewers: 25000, chatPerMin: 80, seventvPerMin: 40, coverageState: 'collecting', trendPct: 0 },
    ],
    ...overrides,
  })
}

describe('hubMetricHelpers', () => {
  it('prefers backend livePoolViewerSum when present', () => {
    const hub = baseHub()
    expect(livePoolViewerSum(hub)).toBe(55000)
  })

  it('sums live channel viewers when backend field missing', () => {
    const hub = baseHub()
    hub.activity.livePoolViewerSum = undefined
    expect(livePoolViewerSum(hub)).toBe(55000)
  })

  it('builds honest metric legend', () => {
    const legend = hubMetricLegend(baseHub())
    expect(legend).toContain('100 tracked in pool')
    expect(legend).toContain('80/250 IRC collectors')
    expect(legend).toContain('120 roster live')
    expect(legend).not.toMatch(/corpus/i)
  })

  it('flags activity viewers below live pool sum', () => {
    const hub = baseHub()
    hub.activity.livePoolViewerSum = undefined
    hub.activity.points = [
      {
        t: Date.now() - 7 * 24 * 60 * 60 * 1000,
        viewers: 10000,
        chat: 100,
        emotes: 50,
        seventv: 20,
        bucketComplete: true,
      },
    ]
    expect(activityViewersBelowLivePool(hub)).toBe(true)
  })

  it('does not flag when peak is healthy vs pool sum', () => {
    const hub = baseHub()
    hub.activity.points = [
      {
        t: Date.now() - 7 * 24 * 60 * 60 * 1000,
        viewers: 50000,
        chat: 100,
        emotes: 50,
        seventv: 20,
        bucketComplete: true,
      },
    ]
    expect(activityViewersBelowLivePool(hub)).toBe(false)
  })
})
