import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildTopMoversFromLiveChannels,
  enrichTopMoversWithAvatars,
  fetchPublicHub,
  fetchPublicHubBase,
  fetchPublicHubStatsFallback,
  fetchHistoricalHubMoments,
  HUB_TOP_MOVERS_CAP,
  normalizePublicHub,
  normalizePublicHubMoments,
  resolveHubTopMovers,
} from '../src/lib/publicHub'
import { coverageMeta } from '../src/ui/components/analytics/hubFormat'

const apiClient = vi.fn()

vi.mock('../src/lib/apiClient', () => ({
  getBackendUrl: () => 'https://api.streampulse.stream',
  apiClient: (...args: unknown[]) => apiClient(...args),
  // Used by fetchPublicHubBase to rethrow typed 429/Retry-After errors.
  isApiError: (error: unknown) =>
    Boolean(error && typeof error === 'object' && 'kind' in (error as object)),
}))

vi.mock('../src/lib/backendSource', () => ({
  resolveBackendSource: () => 'hosted',
}))

describe('normalizePublicHub', () => {
  it('preserves true, false, and absent chat rollup states', () => {
    const hub = normalizePublicHub({
      activity: {
        windowMinutes: 30,
        channelCount: 1,
        points: [
          { t: 1, chat: 0, seventv: 0, viewers: 1000, hasChatRollup: true },
          { t: 2, chat: 0, seventv: 0, viewers: 1000, hasChatRollup: false },
          { t: 3, chat: 0, seventv: 0, viewers: 1000 },
        ],
      },
    })

    expect(hub.activity.points.map((point) => point.hasChatRollup)).toEqual([
      true,
      false,
      undefined,
    ])
  })

  it('preserves measured/accounted window honesty fields and attested gapKind', () => {
    const hub = normalizePublicHub({
      activity: {
        windowMinutes: 1440,
        channelCount: 1,
        measuredWindowMinutes: 1439,
        accountedWindowMinutes: 1440,
        registeredGapCount: 1,
        availableWindowMinutes: 1440,
        source: 'historical_projection',
        state: 'healthy',
        points: [
          {
            t: 1,
            chat: 0,
            seventv: 0,
            viewers: 0,
            hasChatRollup: false,
            gapKind: 'attested',
          },
        ],
      },
    })

    expect(hub.activity.measuredWindowMinutes).toBe(1439)
    expect(hub.activity.accountedWindowMinutes).toBe(1440)
    expect(hub.activity.registeredGapCount).toBe(1)
    expect(hub.activity.points[0]?.gapKind).toBe('attested')
  })

  it('keeps total emotes at least as high as 7TV activity', () => {
    const hub = normalizePublicHub({
      activity: {
        windowMinutes: 30,
        channelCount: 1,
        points: [{ t: 1, chat: 100, emotes: 0, seventv: 37, viewers: 1000 }],
      },
    })

    expect(hub.activity.points[0].emotes).toBe(37)
  })

  it('enrichTopMoversWithAvatars joins avatars from live channels', () => {
    const movers = enrichTopMoversWithAvatars(
      [{ login: 'xqc', displayName: 'xQc', viewers: 1, seventvPerMin: 1, chatPerMin: 1, trendPct: 0 }],
      [{
        login: 'xqc',
        displayName: 'xQc',
        viewers: 1,
        chatPerMin: 1,
        emotesPerMin: 1,
        seventvPerMin: 1,
        coverageState: 'synced',
        trendPct: 0,
        profileImageUrl: 'https://cdn.example/xqc.png',
      }],
    )
    expect(movers[0]?.profileImageUrl).toBe('https://cdn.example/xqc.png')
  })

  it('buildTopMoversFromLiveChannels returns up to the hub cap sorted by emote velocity', () => {
    const liveChannels = Array.from({ length: 14 }, (_, index) => ({
      login: `ch${index}`,
      displayName: `Ch ${index}`,
      viewers: 1000 - index,
      chatPerMin: 100 - index,
      emotesPerMin: 200 - index * 10,
      seventvPerMin: 50 - index,
      coverageState: 'synced' as const,
      trendPct: 0,
    }))
    const movers = buildTopMoversFromLiveChannels(liveChannels, HUB_TOP_MOVERS_CAP)
    expect(movers).toHaveLength(HUB_TOP_MOVERS_CAP)
    expect(movers[0]?.login).toBe('ch0')
    expect(movers[11]?.login).toBe('ch11')
  })

  it('resolveHubTopMovers prefers live-channel rows over legacy 8-row API payloads', () => {
    const liveChannels = Array.from({ length: 12 }, (_, index) => ({
      login: `ch${index}`,
      displayName: `Ch ${index}`,
      viewers: 1000,
      chatPerMin: 80,
      emotesPerMin: 150 - index * 5,
      seventvPerMin: 40,
      coverageState: 'synced' as const,
      trendPct: 0,
    }))
    const apiMovers = liveChannels.slice(0, 8).map((channel) => ({
      login: channel.login,
      displayName: channel.displayName,
      viewers: channel.viewers,
      emotesPerMin: channel.emotesPerMin,
      seventvPerMin: channel.seventvPerMin,
      chatPerMin: channel.chatPerMin,
      trendPct: channel.trendPct,
    }))
    const movers = resolveHubTopMovers(apiMovers, liveChannels)
    expect(movers).toHaveLength(HUB_TOP_MOVERS_CAP)
    expect(movers[8]?.login).toBe('ch8')
  })

  it('promotes critical collector state into coverage', () => {
    const hub = normalizePublicHub({
      coverage: {
        liveChannels: 95,
        trackingMax: 50,
        backfillActive: 0,
        backfillMax: 0,
        syncActive: 0,
        emotesIndexed: 0,
        databaseOk: true,
        state: 'operational',
      },
      corpusPipeline: {
        generatedAt: new Date().toISOString(),
        state: 'critical',
        topN: 500,
        collectorActive: 3,
        collectorMax: 50,
        roster: {
          live: 95,
          collectorTracking: 2,
          expectedCollectorRows: 50,
          liveCollectorDeficitRows: 48,
          metadataOnly: 13,
          metadataStale: 95,
          admissionDisabled: 95,
          capacityBlocked: 0,
          warming: 0,
          collecting: 2,
          viewerOnly: 80,
          zeroChatAfterAge: 0,
        },
      },
    })

    expect(hub.coverage.state).toBe('critical')
    expect(hub.corpusPipeline.roster.metadataStale).toBe(95)
    expect(hub.corpusPipeline.roster.liveCollectorDeficitRows).toBe(48)
  })

  it('uses authoritative roster liveness instead of tracked pool capacity', () => {
    const hub = normalizePublicHub({
      poolSize: 300,
      coverage: {
        liveChannels: 300,
        trackingMax: 300,
        backfillActive: 0,
        backfillMax: 0,
        syncActive: 0,
        emotesIndexed: 0,
        databaseOk: true,
        state: 'operational',
      },
      corpusPipeline: {
        collectorActive: 300,
        collectorMax: 300,
        roster: { live: 84 },
      },
    })

    expect(hub.poolSize).toBe(300)
    expect(hub.coverage.liveChannels).toBe(84)
  })

  it('keeps legacy coverage.liveChannels when roster.live is absent', () => {
    const hub = normalizePublicHub({
      poolSize: 300,
      coverage: {
        liveChannels: 84,
        trackingMax: 300,
        backfillActive: 0,
        backfillMax: 0,
        syncActive: 0,
        emotesIndexed: 0,
        databaseOk: true,
        state: 'operational',
      },
      corpusPipeline: {
        collectorActive: 80,
        collectorMax: 250,
      },
    })

    expect(hub.poolSize).toBe(300)
    expect(hub.corpusPipeline.roster.live).toBe(0)
    expect(hub.coverage.liveChannels).toBe(84)
  })
})

describe('coverageMeta', () => {
  it('maps collecting and chat-only states to distinct tones', () => {
    expect(coverageMeta('collecting').tone).toBe('collecting')
    expect(coverageMeta('chat_only').tone).toBe('chat')
    expect(coverageMeta('viewer_only').tone).toBe('viewer')
    expect(coverageMeta('synced').tone).toBe('synced')
  })
})

describe('fetchPublicHub performance', () => {
  beforeEach(() => {
    apiClient.mockReset()
  })

  it('returns base hub without readiness fan-out', async () => {
    apiClient.mockResolvedValueOnce({
      data: normalizePublicHub({
        poolSize: 12,
        liveChannels: [{ login: 'rubius', viewers: 1000, chatPerMin: 10, seventvPerMin: 2, coverageState: 'synced', trendPct: 0 }],
        corpusPipeline: {
          topN: 100,
          state: 'healthy',
          generatedAt: new Date().toISOString(),
          collectorActive: 1,
          collectorMax: 50,
          roster: { live: 12, collectorTracking: 1, expectedCollectorRows: 12, liveCollectorDeficitRows: 0, metadataOnly: 0, metadataStale: 0, admissionDisabled: 0, capacityBlocked: 0, warming: 0, collecting: 1, viewerOnly: 0, zeroChatAfterAge: 0 },
        },
      }),
      status: 200,
    })

    const result = await fetchPublicHub()
    expect(result.hubEndpointOk).toBe(true)
    expect(result.data.liveChannels).toHaveLength(1)
    expect(apiClient).toHaveBeenCalledTimes(1)
    expect(String(apiClient.mock.calls[0]?.[0])).toContain('/v1/public/hub')
  })

  it('fetchPublicHub never calls raw readiness endpoints', async () => {
    apiClient.mockRejectedValueOnce(new Error('hub down'))
    apiClient.mockResolvedValueOnce({
      data: { streamsTracked: 1, emotesIndexed: 1, updatedAt: new Date().toISOString() },
      status: 200,
    })
    apiClient.mockResolvedValueOnce({
      data: { status: 'operational', degraded: false, updatedAt: new Date().toISOString() },
      status: 200,
    })

    const result = await fetchPublicHub()
    expect(result.loadSource).toBe('stats-fallback')
    expect(apiClient.mock.calls.every((call) => !String(call[0]).includes('/readiness'))).toBe(true)
    const hubCalls = apiClient.mock.calls.filter((call) => String(call[0]).includes('/v1/public/hub'))
    expect(hubCalls).toHaveLength(1)
  })

  it('fetchPublicHubStatsFallback never re-fetches the full hub', async () => {
    apiClient.mockResolvedValueOnce({
      data: { streamsTracked: 1, emotesIndexed: 1, updatedAt: new Date().toISOString() },
      status: 200,
    })
    apiClient.mockResolvedValueOnce({
      data: { status: 'operational', degraded: false, updatedAt: new Date().toISOString() },
      status: 200,
    })

    const result = await fetchPublicHubStatsFallback()
    expect(result.loadSource).toBe('stats-fallback')
    expect(result.hubEndpointOk).toBe(false)
    expect(apiClient.mock.calls.every((call) => !String(call[0]).includes('/v1/public/hub'))).toBe(true)
  })

  it('stats fallback does not treat corpus-only degradation as database down', async () => {
    apiClient.mockResolvedValueOnce({
      data: { streamsTracked: 1, emotesIndexed: 1, updatedAt: new Date().toISOString() },
      status: 200,
    })
    apiClient.mockResolvedValueOnce({
      data: {
        status: 'degraded',
        api: 'up',
        degraded: true,
        components: { api: 'up', coverage: 'degraded', corpus: 'degraded' },
        updatedAt: new Date().toISOString(),
      },
      status: 200,
    })

    const result = await fetchPublicHubStatsFallback()
    expect(result.data.coverage.databaseOk).toBe(true)
    expect(result.data.coverage.state).toBe('degraded')
  })

  it('fetchPublicHubBase never calls readiness endpoints', async () => {
    apiClient.mockResolvedValueOnce({
      data: normalizePublicHub({ poolSize: 1, liveChannels: [{ login: 'xqc', viewers: 1, chatPerMin: 1, seventvPerMin: 0, coverageState: 'synced', trendPct: 0 }] }),
      status: 200,
    })

    const base = await fetchPublicHubBase()
    expect(base.hubEndpointOk).toBe(true)
    expect(apiClient).toHaveBeenCalledTimes(1)
    expect(String(apiClient.mock.calls[0]?.[0])).toContain('/v1/public/hub')
  })

  it('stats fallback uses only sanitized public endpoints', async () => {
    apiClient.mockRejectedValueOnce(new Error('hub down'))
    apiClient.mockResolvedValueOnce({
      data: { streamsTracked: 1, emotesIndexed: 1, updatedAt: new Date().toISOString() },
      status: 200,
    })
    apiClient.mockResolvedValueOnce({
      data: { status: 'operational', degraded: false, updatedAt: new Date().toISOString() },
      status: 200,
    })

    await fetchPublicHub()
    const paths = apiClient.mock.calls.map((call) => String(call[0]))
    expect(paths.some((path) => path.includes('/v1/public/stats'))).toBe(true)
    expect(paths.some((path) => path.includes('/v1/public/status'))).toBe(true)
    expect(paths.every((path) => !path.includes('/v1/analytics/'))).toBe(true)
  })
})

describe('public hub JSON safety', () => {
  it('normalizePublicHub omits forbidden top-level keys from partial payloads', () => {
    const hub = normalizePublicHub({
      livePulseMoments: [{ offsetSeconds: 60, score: 80, label: 'peak', login: 'rubius', streamId: '1' }],
    })
    const serialized = JSON.stringify(hub)
    expect(serialized).not.toMatch(/"principal"/)
    expect(serialized).not.toMatch(/"rawChat"/)
    expect(hub.livePulseMoments[0]?.login).toBe('rubius')
  })
})

describe('fetchHistoricalHubMoments', () => {
  beforeEach(() => {
    apiClient.mockReset()
  })

  it('requests bucket-scoped corpus peaks and absolutizes emote URLs', async () => {
    apiClient.mockResolvedValueOnce({
      data: {
        bucketT: 1_719_000_000_000,
        bucketStart: '2024-07-01T12:00:00.000Z',
        bucketEnd: '2024-07-01T12:42:00.000Z',
        hubGeneratedAt: '2026-07-02T12:00:00.000Z',
        source: 'corpus_historical',
        status: 'ready',
        activityWindowMinutes: 10_080,
        moments: [
          {
            offsetSeconds: 120,
            score: 88,
            label: 'Chat spike',
            login: 'xqc',
            streamId: 's1',
            source: 'corpus_historical',
            topEmotes: [{ name: 'Nope', provider: '7tv', count: 12, imageUrl: '/emotes/u/1x.webp' }],
          },
        ],
      },
      status: 200,
    })

    const result = await fetchHistoricalHubMoments(1_719_000_000_000, '7d')
    expect(String(apiClient.mock.calls[0]?.[0])).toContain('/v1/public/hub/moments')
    expect(String(apiClient.mock.calls[0]?.[0])).toContain('bucketT=1719000000000')
    expect(result.status).toBe('ready')
    expect(result.source).toBe('corpus_historical')
    expect(result.hubGeneratedAt).toBe('2026-07-02T12:00:00.000Z')
    expect(result.moments[0]?.topEmotes?.[0]?.imageUrl).toContain('https://api.streampulse.stream/emotes/')
  })

  it('normalizePublicHubMoments keeps hosted-safe shape', () => {
    const payload = normalizePublicHubMoments({
      status: 'empty',
      reason: 'no_corpus_peaks_in_bucket',
      moments: [],
    })
    expect(payload.source).toBe('corpus_historical')
    expect(payload.hubGeneratedAt).toBe('')
    expect(payload.moments).toEqual([])
  })
})
