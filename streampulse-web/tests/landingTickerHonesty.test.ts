import { describe, expect, it } from 'vitest'
import { buildEmoteTicker, buildMoverTicker } from '../src/ui/components/landing/landingData'
import type { PublicHub } from '../src/lib/publicHub'

function stubHub(overrides: Partial<PublicHub> = {}): PublicHub {
  return {
    generatedAt: new Date().toISOString(),
    poolSize: 0,
    corpus: {
      streamsTracked: 0,
      momentsDetected: 0,
      chatMessagesProcessed: 0,
      emotesIndexed: 0,
      vodsAnalyzed: 0,
    },
    coverage: {
      liveChannels: 0,
      trackingMax: 300,
      backfillActive: 0,
      backfillMax: 4,
      syncActive: 0,
      emotesIndexed: 0,
      databaseOk: true,
      state: 'operational',
    },
    corpusPipeline: {
      generatedAt: new Date().toISOString(),
      state: 'idle',
      topN: 0,
      collectorActive: 0,
      collectorMax: 96,
    },
    activity: {
      points: [],
      windowMinutes: 1440,
      channelCount: 0,
      livePoolViewerSum: 0,
    },
    emoteIntel: {
      emotesPerMin: 0,
      topEmoteSharePct: 0,
      uniqueEmotes: 0,
      biggestPeakPerMin: 0,
      seventvSharePct: 0,
      providerShares: [],
    },
    topEmotes: [],
    topMovers: [],
    liveChannels: [],
    moments: [],
    livePulseMoments: [],
    featuredSession: { state: 'empty', reason: 'no_qualifying_session' },
    ...overrides,
  } as PublicHub
}

describe('landing ticker honesty', () => {
  it('returns no invented emote or mover counts when hub is empty', () => {
    const hub = stubHub()
    expect(buildEmoteTicker(hub)).toEqual([])
    expect(buildMoverTicker(hub)).toEqual([])
    expect(buildEmoteTicker(null)).toEqual([])
    expect(buildMoverTicker(null)).toEqual([])
  })

  it('maps real hub emotes when present', () => {
    const hub = stubHub({
      topEmotes: [{ name: 'KEKW', provider: '7tv', count: 900, sharePct: 22 }],
      topMovers: [
        {
          login: 'xqc',
          displayName: 'xQc',
          seventvPerMin: 30,
          chatPerMin: 40,
          viewers: 1000,
          trendPct: 12,
        },
      ],
    })
    const emotes = buildEmoteTicker(hub)
    const movers = buildMoverTicker(hub)
    expect(emotes).toHaveLength(1)
    expect(emotes[0]?.label).toBe('KEKW')
    expect(emotes[0]?.value).toBe('900')
    expect(movers[0]?.label).toBe('xQc')
    expect(movers[0]?.value).toBe('30/min')
  })
})
