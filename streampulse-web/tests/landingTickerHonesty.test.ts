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
        mover('xqc', 30, 12, 'xQc'),
        mover('ludwig', 20, 8),
        mover('tarik', 12, 4),
      ],
    })
    const emotes = buildEmoteTicker(hub)
    const movers = buildMoverTicker(hub)
    expect(emotes).toHaveLength(1)
    expect(emotes[0]?.label).toBe('KEKW')
    expect(emotes[0]?.value).toBe('900')
    expect(movers.map((item) => item.label)).toEqual(['xQc', 'ludwig', 'tarik'])
    expect(movers[0]?.value).toBe('30/min')
    expect(movers.every((item) => item.tone === 'up')).toBe(true)
  })

  it('leaves out channels with no current activity and channels that are falling', () => {
    // Shapes seen on the live hub on 2026-10-09: 0/min with a big percentage on a
    // near-zero base, and busy channels whose rate is dropping.
    const hub = stubHub({
      topMovers: [
        mover('silvervale', 0, 376),
        mover('pangi', 0.4, 218),
        mover('xqc', 780, -11),
        mover('komplettno', 0, -3),
        mover('redshell', 121, 247),
        mover('kaicenat', 640, 38),
        mover('flat', 300, 1),
        mover('jynxzi', 220, 21),
      ],
    })
    const movers = buildMoverTicker(hub)
    expect(movers.map((item) => item.label)).toEqual(['redshell', 'kaicenat', 'jynxzi'])
    expect(movers.some((item) => item.value === '0/min')).toBe(false)
    expect(movers.some((item) => item.delta?.startsWith('-'))).toBe(false)
  })

  it('hides the channel strip when too few channels are trending', () => {
    const audit = stubHub({
      topMovers: [
        mover('ewroon', 385, -35),
        mover('sleduck', 0, -53),
        mover('ohnepixel', 210, -47),
        mover('silvervale', 0, -49),
        mover('sam1268', 0, -59),
        mover('komplettno', 0, -3),
      ],
    })
    expect(buildMoverTicker(audit)).toEqual([])
    const two = stubHub({ topMovers: [mover('a', 50, 10), mover('b', 40, 9), mover('c', 0, 80)] })
    expect(buildMoverTicker(two)).toEqual([])
  })
})

function mover(login: string, seventvPerMin: number, trendPct: number, displayName?: string): PublicHub['topMovers'][number] {
  return { login, displayName, seventvPerMin, chatPerMin: 40, viewers: 1000, trendPct } as PublicHub['topMovers'][number]
}
