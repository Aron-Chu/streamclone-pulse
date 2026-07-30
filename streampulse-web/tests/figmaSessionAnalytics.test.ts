import { describe, expect, it } from 'vitest'
import { DEFAULT_BACKEND_URL, DEFAULT_PRODUCTION_BACKEND_URL } from '../src/lib/auth'
import {
  chatPerMinuteRange,
  chartPointsFromMinutes,
  featuredSessionFromPublicHub,
  isValidPeakOffsetSeconds,
  livePulseMomentsFromPublicHub,
  nearestMomentForOffset,
  resolveLivePulseMoments,
} from '../src/lib/figmaSessionAnalytics'
import type { PublicHub } from '../src/lib/publicHub'
import { hubCorpusPipelineFixture } from '../src/lib/publicHub'

function samplePublicHub(): PublicHub {
  return {
    generatedAt: new Date().toISOString(),
    poolSize: 1,
    corpus: {
      streamsTracked: 1,
      momentsDetected: 0,
      chatMessagesProcessed: 0,
      emotesIndexed: 0,
      vodsAnalyzed: 0,
    },
    coverage: {
      liveChannels: 1,
      trackingMax: 100,
      backfillActive: 0,
      backfillMax: 0,
      syncActive: 0,
      emotesIndexed: 0,
      databaseOk: true,
      state: 'operational',
    },
    corpusPipeline: hubCorpusPipelineFixture({
      generatedAt: new Date().toISOString(),
      state: 'healthy',
      topN: 500,
      collectorActive: 10,
      collectorMax: 100,
      roster: {
        live: 1,
        collectorTracking: 1,
        expectedCollectorRows: 1,
        liveCollectorDeficitRows: 0,
        metadataOnly: 0,
        metadataStale: 0,
        admissionDisabled: 0,
        capacityBlocked: 0,
        warming: 0,
        collecting: 1,
        viewerOnly: 0,
        zeroChatAfterAge: 0,
      },
    }),
    activity: { points: [], windowMinutes: 60, channelCount: 0 },
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
  }
}

describe('past-stream chart minute truth', () => {
  const minutes = [
    { offsetSeconds: 0, chatCount: 8, seventvEmoteCount: 3, viewerLatest: 900 },
    { offsetSeconds: 60, chatCount: 42, seventvEmoteCount: 16, viewerLatest: 950 },
    { offsetSeconds: 120, chatCount: 0, seventvEmoteCount: 0, viewerLatest: 980, missing: true },
  ]

  it('derives an honest chat min-max range while excluding missing buckets', () => {
    expect(chatPerMinuteRange(minutes)).toEqual({ min: 8, max: 42 })
  })

  it('keeps raw chat and emote counts alongside normalized chart lanes', () => {
    const points = chartPointsFromMinutes(minutes)
    expect(points[0]).toMatchObject({ chatCount: 8, emoteCount: 3, viewerCount: 900 })
    expect(points[1]).toMatchObject({ chatCount: 42, emoteCount: 16, viewerCount: 950 })
  })
})

describe('nearestMomentForOffset', () => {
  const peaks = [
    { offsetSeconds: 60, score: 70, label: 'A' },
    { offsetSeconds: 300, score: 90, label: 'B' },
    { offsetSeconds: 600, score: 80, label: 'C' },
  ]

  it('returns null for empty moments or non-finite offset', () => {
    expect(nearestMomentForOffset([], 120)).toBeNull()
    expect(nearestMomentForOffset(peaks, Number.NaN)).toBeNull()
  })

  it('snaps chart offset to the nearest peak row', () => {
    expect(nearestMomentForOffset(peaks, 280)?.offsetSeconds).toBe(300)
    expect(nearestMomentForOffset(peaks, 50)?.offsetSeconds).toBe(60)
  })

  it('prefers the earlier moment when distances tie', () => {
    const tied = [
      { offsetSeconds: 100, score: 50, label: 'early' },
      { offsetSeconds: 200, score: 99, label: 'late' },
    ]
    expect(nearestMomentForOffset(tied, 150)?.label).toBe('early')
  })

  it('accepts peakOffsetSeconds of 0 as valid', () => {
    expect(isValidPeakOffsetSeconds(0)).toBe(true)
    expect(isValidPeakOffsetSeconds(undefined)).toBe(false)
    expect(nearestMomentForOffset([{ offsetSeconds: 0, score: 1, label: 'start' }], 5)?.offsetSeconds).toBe(0)
  })
})

describe('backend URL defaults', () => {
  it('defaults to hosted API when VITE_BACKEND_URL is unset', () => {
    expect(DEFAULT_BACKEND_URL).toBe(DEFAULT_PRODUCTION_BACKEND_URL)
    expect(DEFAULT_PRODUCTION_BACKEND_URL).toBe('https://api.streampulse.stream')
  })
})

describe('featuredSessionFromPublicHub', () => {
  const baseHub = samplePublicHub

  it('maps ready featured session without client scoring', () => {
    const hub = samplePublicHub()
    hub.featuredSession = {
      state: 'ready',
      login: 'xqc',
      displayName: 'xQc',
      streamId: 'stream-1',
      category: 'Just Chatting',
      viewers: 12000,
      chatPerMin: 420,
      peakCount: 3,
      topMoments: [
        { offsetSeconds: 120, score: 88, label: 'Chat spike', chatPerMin: 200, topEmoteCode: 'KEKW' },
      ],
      chartPoints: [{ offsetSeconds: 60, chatNorm: 40, viewersNorm: 30, emotesNorm: 50, heat: 70 }],
      topEmoteBursts: [{ code: 'KEKW', count: 42, peakOffset: '02:00', peakOffsetSeconds: 120 }],
      coverageTruth: [{ label: 'VOD available', value: 'Yes', ok: true }],
    }
    const model = featuredSessionFromPublicHub(hub)
    expect(model.state).toBe('ready')
    expect(model.moments[0].score).toBe(88)
    expect(model.sessionHref).toBe('/analytics/xqc/stream-1')
    expect(model.moments[0].href).toContain('#t=120')
    expect(model.bursts[0].peakOffsetSeconds).toBe(120)
  })

  it('returns honest empty state when hub has no qualifying session', () => {
    const model = featuredSessionFromPublicHub(baseHub())
    expect(model.state).toBe('empty')
    expect(model.moments).toHaveLength(0)
  })
})

describe('livePulseMomentsFromPublicHub', () => {
  it('prefers livePulseMoments over featured session rows', () => {
    const hub = samplePublicHub()
    hub.livePulseMoments = [
      {
        login: 'xqc',
        displayName: 'xQc',
        streamId: 's1',
        offsetSeconds: 60,
        score: 90,
        label: 'Chat spike',
      },
      {
        login: 'jynxzi',
        displayName: 'Jynxzi',
        streamId: 's2',
        offsetSeconds: 120,
        score: 85,
        label: '7TV emote spike',
      },
    ]
    hub.featuredSession = { state: 'ready', login: 'xqc', streamId: 's1', topMoments: [] }
    const result = resolveLivePulseMoments(hub)
    expect(result.source).toBe('network')
    expect(result.moments).toHaveLength(2)
    expect(result.moments.map((r) => r.login)).toEqual(['xqc', 'jynxzi'])
    expect(livePulseMomentsFromPublicHub(hub)).toHaveLength(2)
  })
})

describe('resolveLivePulseMoments legacy hub.moments fallback', () => {
  it('uses chat_spike rows when livePulseMoments and featured session are empty', () => {
    const hub = samplePublicHub()
    hub.livePulseMoments = []
    hub.featuredSession = { state: 'empty', reason: 'no_qualifying_session' }
    hub.moments = [
      {
        kind: 'chat_spike',
        login: 'eliasn97',
        displayName: 'eliasn97',
        streamId: '317839735654',
        label: 'eliasn97 chat surging',
        magnitude: 86,
        at: Date.now(),
      },
    ]
    const result = resolveLivePulseMoments(hub)
    expect(result.source).toBe('legacy_fallback')
    expect(result.banner).toContain('Legacy hub moments fallback')
    expect(result.moments).toHaveLength(1)
    expect(result.moments[0]?.login).toBe('eliasn97')
    // magnitude must never become a Pulse / reaction score
    expect(result.moments[0]?.score).toBeUndefined()
  })
})

describe('resolveLivePulseMoments featured fallback banner', () => {
  it('uses deploy-focused copy when network livePulseMoments is absent', () => {
    const hub = samplePublicHub()
    hub.featuredSession = {
      state: 'ready',
      login: 'xqc',
      streamId: 's1',
      topMoments: [{ offsetSeconds: 60, score: 80, label: 'Chat spike' }],
    }
    const result = resolveLivePulseMoments(hub)
    expect(result.source).toBe('featured_fallback')
    expect(result.banner).toContain('Hosted API has not deployed network live moments yet')
    expect(result.moments).toHaveLength(1)
  })

  it('uses no_peaks copy when backend status says no peaks', () => {
    const hub = samplePublicHub()
    hub.livePulseMomentsStatus = 'no_peaks'
    hub.featuredSession = {
      state: 'ready',
      login: 'xqc',
      streamId: 's1',
      topMoments: [{ offsetSeconds: 60, score: 80, label: 'Chat spike' }],
    }
    const result = resolveLivePulseMoments(hub)
    expect(result.banner).toContain('No network IRC peaks in the tracking pool yet')
  })
})
