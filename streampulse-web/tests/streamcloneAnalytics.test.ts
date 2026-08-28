import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAnalyticsApi } from '@streampulse/analytics-console'
import type { AnalyticsStreamDetail, GameSegment, PulseStreamRecap } from '@streampulse/analytics-console'

const apiClientMock = vi.fn()
const getBackendUrlMock = vi.fn(() => 'http://127.0.0.1:8081')

vi.mock('../src/lib/apiClient', () => ({
  apiClient: (...args: unknown[]) => apiClientMock(...args),
  getBackendUrl: () => getBackendUrlMock(),
}))

describe('streamcloneAnalytics adapter', () => {
  const minute = (index: number) => ({
    minuteTs: new Date(Date.now() + index * 60_000).toISOString(),
    viewerAvg: 0,
    viewerMax: 0,
    viewerLatest: 0,
    viewerSamples: 0,
    chatCount: 1,
    totalEmoteCount: 0,
    seventvEmoteCount: 0,
    emotes: {},
  })

  beforeEach(() => {
    apiClientMock.mockReset()
    getBackendUrlMock.mockReset().mockReturnValue('http://127.0.0.1:8081')
    vi.resetModules()
  })

  it('deriveClientGameSegments skips placeholder categories', async () => {
    const { deriveClientGameSegments } = await import('../src/lib/streamcloneAnalytics')
    const detail: Pick<AnalyticsStreamDetail, 'stream' | 'rollups'> = {
      stream: {
        streamId: '123',
        login: 'eliasn97',
        startedAt: new Date().toISOString(),
        category: 'Live',
      },
      rollups: [minute(0)],
    }
    expect(deriveClientGameSegments('123', detail)).toEqual([])
  })

  it('deriveClientGameSegments builds one segment from category and rollups', async () => {
    const { deriveClientGameSegments } = await import('../src/lib/streamcloneAnalytics')
    const detail: Pick<AnalyticsStreamDetail, 'stream' | 'rollups'> = {
      stream: {
        streamId: '123',
        login: 'eliasn97',
        startedAt: new Date().toISOString(),
        category: 'Just Chatting',
      },
      rollups: [minute(0), minute(1), minute(2)],
    }
    expect(deriveClientGameSegments('123', detail)).toEqual([
      {
        id: 0,
        streamId: '123',
        gameName: 'Just Chatting',
        boxArtUrl: '',
        offsetSeconds: 0,
        durationSeconds: 180,
        createdAt: new Date(0).toISOString(),
      },
    ])
  })

  it('deriveClientGameSegments prefers momentRollups span over downsampled chart rollups', async () => {
    const { deriveClientGameSegments } = await import('../src/lib/streamcloneAnalytics')
    const start = Date.parse('2026-07-04T10:00:00Z')
    const momentRollups = Array.from({ length: 480 }, (_, i) => ({
      ...minute(i),
      minuteTs: new Date(start + i * 60_000).toISOString(),
    }))
    const chartRollups = [momentRollups[0], momentRollups[239]]
    const detail: Pick<AnalyticsStreamDetail, 'stream' | 'rollups' | 'momentRollups'> = {
      stream: {
        streamId: '123',
        login: 'eliasn97',
        startedAt: new Date(start).toISOString(),
        category: 'Just Chatting',
      },
      rollups: chartRollups,
      momentRollups,
    }
    const segments = deriveClientGameSegments('123', detail)
    expect(segments).toHaveLength(1)
    // 480 minutes inclusive span = 479 * 60 + 60 = 28800s (8h), not 240 * 60 from chart point count.
    expect(segments[0]?.durationSeconds).toBe(28_800)
  })

  it('getAnalyticsStream + getPulseStreamRecap pass through remapped portal streamId (no rewrite to request id)', async () => {
    getBackendUrlMock.mockReturnValue('https://api.streampulse.stream')
    const requestId = 'alias-stream-A'
    const remappedId = 'canonical-stream-B'
    const startedAt = '2026-07-11T18:00:00.000Z'
    apiClientMock.mockImplementation((path: string) => {
      if (path.includes('/channels/') && path.includes('/emotes')) {
        return Promise.resolve({ data: { topEmotes: [] } })
      }
      expect(path).toContain(`/streams/${encodeURIComponent(requestId)}`)
      if (path.endsWith('/minutes')) {
        return Promise.resolve({
          data: {
            streamId: remappedId,
            channel: 'denims',
            startedAt,
            minutes: [{ offsetSeconds: 0, chatCount: 1 }],
            updatedAt: Date.now(),
          },
        })
      }
      if (path.endsWith('/summary')) {
        return Promise.resolve({
          data: {
            channel: 'denims',
            stream: { streamId: remappedId, login: 'denims', startedAt },
            topEmotes: [],
            updatedAt: Date.now(),
          },
        })
      }
      if (path.endsWith('/recap')) {
        return Promise.resolve({
          data: {
            streamId: remappedId,
            login: 'denims',
            topMoments: [],
            topEmotes: [],
          },
        })
      }
      return Promise.resolve({
        data: {
          channel: 'denims',
          state: 'historical',
          stream: {
            streamId: remappedId,
            login: 'denims',
            startedAt,
          },
          sources: [],
          updatedAt: Date.now(),
        },
      })
    })

    const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
    const detail = (await portalAnalyticsApi.getAnalyticsStream(requestId)) as AnalyticsStreamDetail
    const recap = (await portalAnalyticsApi.getPulseStreamRecap(requestId)) as PulseStreamRecap | null

    expect(detail.stream?.streamId).toBe(remappedId)
    expect(detail.stream?.streamId).not.toBe(requestId)
    expect(recap?.streamId).toBe(remappedId)
    expect(recap?.streamId).not.toBe(requestId)
  })

  it('uses the live payload when a current stream detail is incorrectly canonicalized', async () => {
    getBackendUrlMock.mockReturnValue('https://api.streampulse.stream')
    const requestedId = '319980544860'
    const staleCanonicalId = '317250898295'
    const currentStartedAt = '2026-08-20T02:02:49Z'
    const staleStartedAt = '2026-08-17T02:03:38Z'

    apiClientMock.mockImplementation((path: string) => {
      if (path === '/v1/portal/analytics/channels/caseoh_/live') {
        return Promise.resolve({
          data: {
            channel: 'caseoh_',
            state: 'live',
            stream: {
              streamId: requestedId,
              login: 'caseoh_',
              startedAt: currentStartedAt,
              category: 'Mile 27',
              currentViewers: 58_000,
            },
            rollups: [],
            topEmotes: [],
            sources: [],
            updatedAt: Date.now(),
          },
        })
      }
      if (path.includes('/channels/caseoh_/emotes')) {
        return Promise.resolve({ data: { topEmotes: [] } })
      }
      if (path.endsWith('/minutes')) {
        return Promise.resolve({
          data: {
            streamId: staleCanonicalId,
            channel: 'caseoh_',
            startedAt: staleStartedAt,
            minutes: [{ offsetSeconds: 0, chatCount: 1 }],
            updatedAt: Date.now(),
          },
        })
      }
      if (path.endsWith('/summary')) {
        return Promise.resolve({
          data: {
            channel: 'caseoh_',
            stream: { streamId: staleCanonicalId, login: 'caseoh_', startedAt: staleStartedAt },
            topEmotes: [],
            updatedAt: Date.now(),
          },
        })
      }
      if (path === `/v1/portal/analytics/streams/${requestedId}`) {
        return Promise.resolve({
          data: {
            channel: 'caseoh_',
            state: 'live',
            stream: { streamId: staleCanonicalId, login: 'caseoh_', startedAt: staleStartedAt },
            sources: [],
            updatedAt: Date.now(),
          },
        })
      }
      return Promise.reject(new Error(`unexpected path ${path}`))
    })

    const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
    const detail = (await portalAnalyticsApi.getAnalyticsStream(requestedId, {
      sparse: false,
      channel: 'caseoh_',
    })) as AnalyticsStreamDetail

    expect(detail.stream?.streamId).toBe(requestedId)
    expect(detail.stream?.startedAt).toBe(currentStartedAt)
    expect(detail.stream?.category).toBe('Mile 27')
    expect(apiClientMock).toHaveBeenCalledWith('/v1/portal/analytics/channels/caseoh_/live')
  })

  it('getAnalyticsLive maps viewerSamples and chatMessages from portal stream record', async () => {
    getBackendUrlMock.mockReturnValue('https://api.streampulse.stream')
    apiClientMock.mockImplementation((path: string) => {
      if (path.includes('/live')) {
        return Promise.resolve({
          data: {
            channel: 'eliasn97',
            state: 'live',
            stream: {
              streamId: '999',
              login: 'eliasn97',
              startedAt: new Date().toISOString(),
              category: 'Just Chatting',
              viewerSamples: 42,
              chatMessages: 12_345,
            },
            rollups: [],
            topEmotes: [],
            sources: [],
            updatedAt: Date.now(),
          },
        })
      }
      if (path.includes('/emotes')) {
        return Promise.resolve({ data: { items: [] } })
      }
      return Promise.reject(new Error(`unexpected path ${path}`))
    })

    const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
    const detail = (await portalAnalyticsApi.getAnalyticsLive('eliasn97')) as AnalyticsStreamDetail
    expect(detail.stream?.viewerSamples).toBe(42)
    expect(detail.stream?.chatMessages).toBe(12_345)
  })

  it('passes validated signal provenance through detail, full rollups, chart rollups, and recap moments', async () => {
    getBackendUrlMock.mockReturnValue('https://api.streampulse.stream')
    const measuredZero = {
      state: 'measured',
      observedAt: '2026-07-11T18:00:00.000Z',
      source: 'live',
      value: 0,
    }
    const partial = {
      state: 'partial',
      observedAt: '2026-07-11T18:00:00.000Z',
      coveragePct: 70,
      source: 'ivr',
    }
    const staleWatermark = {
      state: 'stale',
      observedThrough: '2026-07-11T18:05:00.000Z',
      coveragePct: 82,
      source: 'live',
    }
    const confirmedPeak = {
      state: 'measured',
      observedAt: '2026-07-11T18:04:00.000Z',
      confirmed: true,
      detector: 'heatmap:chat_spike',
      value: 88,
    }
    const minutes = Array.from({ length: 300 }, (_, index) => ({
      offsetSeconds: index * 60,
      viewerAvg: 0,
      viewerLatest: 0,
      viewerSamples: 0,
      chatCount: index,
      signalObservations: { chat: measuredZero, emotes: partial },
    }))
    apiClientMock.mockImplementation((path: string) => {
      if (path.endsWith('/minutes')) {
        return Promise.resolve({
          data: {
            streamId: 'provenance-stream',
            channel: 'denims',
            startedAt: '2026-07-11T18:00:00.000Z',
            minutes,
            updatedAt: Date.now(),
          },
        })
      }
      if (path.endsWith('/summary')) {
        return Promise.resolve({ data: { channel: 'denims', topEmotes: [], updatedAt: Date.now() } })
      }
      if (path.endsWith('/recap')) {
        return Promise.resolve({
          data: {
            streamId: 'provenance-stream',
            login: 'denims',
            topMoments: [
              { offsetSeconds: 240, score: 88, peakObservation: confirmedPeak },
              {
                offsetSeconds: 300,
                score: 50,
                peakObservation: { ...confirmedPeak, value: undefined },
              },
            ],
          },
        })
      }
      return Promise.resolve({
        data: {
          channel: 'denims',
          state: 'historical',
          stream: {
            streamId: 'provenance-stream',
            login: 'denims',
            startedAt: '2026-07-11T18:00:00.000Z',
          },
          signalWatermarks: { chat: staleWatermark },
          sources: [],
          updatedAt: Date.now(),
        },
      })
    })

    const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
    const detail = await portalAnalyticsApi.getAnalyticsStream('provenance-stream') as AnalyticsStreamDetail & {
      signalWatermarks?: { chat?: typeof staleWatermark }
      rollups: Array<AnalyticsStreamDetail['rollups'][number] & {
        signalObservations?: { chat?: typeof measuredZero; emotes?: typeof partial }
      }>
      momentRollups?: Array<AnalyticsStreamDetail['rollups'][number] & {
        signalObservations?: { chat?: typeof measuredZero; emotes?: typeof partial }
      }>
    }
    const recap = await portalAnalyticsApi.getPulseStreamRecap('provenance-stream') as {
      topMoments?: Array<{ peakObservation?: typeof confirmedPeak }>
    }

    expect(detail.signalWatermarks?.chat).toEqual(staleWatermark)
    expect(detail.rollups[0]?.viewerSamples).toBe(0)
    expect(detail.rollups[0]?.signalObservations).toEqual({ chat: measuredZero, emotes: partial })
    expect(detail.momentRollups).toHaveLength(300)
    expect(detail.momentRollups?.[0]?.signalObservations).toEqual({ chat: measuredZero, emotes: partial })
    expect(recap.topMoments?.[0]?.peakObservation).toEqual(confirmedPeak)
    expect(recap.topMoments?.[1]?.peakObservation).toBeUndefined()
  })

  it('getAnalyticsStream resolves per-minute emote images from sanitized BucketEmote.imageUrl, not a fabricated id', async () => {
    getBackendUrlMock.mockReturnValue('https://api.streampulse.stream')
    apiClientMock.mockImplementation((path: string) => {
      if (path.endsWith('/minutes')) {
        return Promise.resolve({
          data: {
            streamId: '317839735654',
            channel: 'eliasn97',
            startedAt: new Date(0).toISOString(),
            minutes: [
              {
                offsetSeconds: 60,
                chatCount: 5,
                topEmotes: [
                  { name: 'LUL', provider: 'twitch', imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/425618/default/dark/1.0', count: 3 },
                ],
              },
            ],
            updatedAt: Date.now(),
          },
        })
      }
      if (path.endsWith('/summary')) {
        return Promise.resolve({ data: { channel: 'eliasn97', topEmotes: [], updatedAt: Date.now() } })
      }
      return Promise.resolve({
        data: {
          channel: 'eliasn97',
          state: 'historical',
          stream: { streamId: '317839735654', login: 'eliasn97', startedAt: new Date(0).toISOString() },
          sources: [],
          updatedAt: Date.now(),
        },
      })
    })

    const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
    configureAnalyticsApi(portalAnalyticsApi)
    const detail = (await portalAnalyticsApi.getAnalyticsStream('317839735654')) as AnalyticsStreamDetail

    expect(detail.rollups).toHaveLength(1)
    const [key] = Object.keys(detail.rollups[0].emotes ?? {})
    const catalogEntry = detail.topEmotes.find((e) => e.key === key)
    expect(catalogEntry?.imageUrl).toBe('https://static-cdn.jtvnw.net/emoticons/v2/425618/default/dark/1.0')
    // The synthetic id must never be treated as the real Twitch numeric emote id.
    expect(catalogEntry?.id).not.toBe('425618')
  })

  it('getAnalyticsStream leaves summary totals to the staged layer-2 query', async () => {
    getBackendUrlMock.mockReturnValue('https://api.streampulse.stream')
    apiClientMock.mockImplementation((path: string) => {
      if (path.endsWith('/minutes')) {
        return Promise.resolve({
          data: {
            streamId: '317839735654',
            channel: 'alanzoka',
            startedAt: new Date(0).toISOString(),
            minutes: [
              {
                offsetSeconds: 60,
                chatCount: 5,
                topEmotes: [{ name: 'Sapo', provider: 'seventv', count: 115 }],
              },
            ],
            updatedAt: Date.now(),
          },
        })
      }
      if (path.endsWith('/summary')) {
        return Promise.resolve({
          data: {
            channel: 'alanzoka',
            topEmotes: [{ key: 'seventv:real-id:Sapo', name: 'Sapo', provider: 'seventv', count: 10400 }],
            updatedAt: Date.now(),
          },
        })
      }
      return Promise.resolve({
        data: {
          channel: 'alanzoka',
          state: 'historical',
          stream: { streamId: '317839735654', login: 'alanzoka', startedAt: new Date(0).toISOString() },
          sources: [],
          updatedAt: Date.now(),
        },
      })
    })

    const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
    configureAnalyticsApi(portalAnalyticsApi)
    const detail = (await portalAnalyticsApi.getAnalyticsStream('317839735654')) as AnalyticsStreamDetail

    expect(detail.topEmotes[0]?.name).toBe('Sapo')
    expect(detail.topEmotes[0]?.count).toBe(115)
    expect(apiClientMock).not.toHaveBeenCalledWith('/v1/portal/analytics/streams/317839735654/summary')
  })

  it('getAnalyticsStream uses portal totalEmoteCount when topEmotes only expose top three', async () => {
    getBackendUrlMock.mockReturnValue('https://api.streampulse.stream')
    apiClientMock.mockImplementation((path: string) => {
      if (path.endsWith('/minutes')) {
        return Promise.resolve({
          data: {
            streamId: '317839735654',
            channel: 'xqc',
            startedAt: new Date(0).toISOString(),
            minutes: [
              {
                offsetSeconds: 60,
                chatCount: 200,
                totalEmoteCount: 200,
                topEmotes: [
                  { name: 'LUL', provider: 'twitch', count: 80 },
                  { name: 'BabyRage', provider: 'twitch', count: 60 },
                  { name: 'Clap', provider: 'twitch', count: 40 },
                ],
              },
            ],
            updatedAt: Date.now(),
          },
        })
      }
      if (path.endsWith('/summary')) {
        return Promise.resolve({ data: { channel: 'xqc', topEmotes: [], updatedAt: Date.now() } })
      }
      return Promise.resolve({
        data: {
          channel: 'xqc',
          state: 'historical',
          stream: { streamId: '317839735654', login: 'xqc', startedAt: new Date(0).toISOString() },
          sources: [],
          updatedAt: Date.now(),
        },
      })
    })

    const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
    configureAnalyticsApi(portalAnalyticsApi)
    const detail = (await portalAnalyticsApi.getAnalyticsStream('317839735654')) as AnalyticsStreamDetail

    expect(detail.rollups[0]?.totalEmoteCount).toBe(200)
  })

  it('getAnalyticsStream maps three minute topEmotes into momentRollups for moment ranking', async () => {
    getBackendUrlMock.mockReturnValue('https://api.streampulse.stream')
    apiClientMock.mockImplementation((path: string) => {
      if (path.endsWith('/minutes')) {
        return Promise.resolve({
          data: {
            streamId: '317548790616',
            channel: 'zackrawrr',
            startedAt: new Date(0).toISOString(),
            minutes: [
              {
                offsetSeconds: 120,
                chatCount: 420,
                viewerLatest: 18000,
                totalEmoteCount: 95,
                topEmotes: [
                  { name: 'o7', provider: 'seventv', imageUrl: 'https://cdn.example/o7.webp', count: 40 },
                  { name: 'LUL', provider: 'twitch', imageUrl: 'https://cdn.example/lul.webp', count: 35 },
                  { name: 'KEKW', provider: 'twitch', imageUrl: 'https://cdn.example/kekw.webp', count: 20 },
                ],
              },
            ],
            updatedAt: Date.now(),
          },
        })
      }
      if (path.endsWith('/summary')) {
        return Promise.resolve({ data: { channel: 'zackrawrr', topEmotes: [], updatedAt: Date.now() } })
      }
      return Promise.resolve({
        data: {
          channel: 'zackrawrr',
          state: 'historical',
          stream: { streamId: '317548790616', login: 'zackrawrr', startedAt: new Date(0).toISOString() },
          sources: [{ source: 'analytics_db', state: 'ready' }],
          dataSourceBadges: [{ source: 'analytics_db', state: 'ready', label: 'Analytics Db' }],
          updatedAt: Date.now(),
        },
      })
    })

    const { topEmotesFromRollup } = await import('@streampulse/pulse-core')
    const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
    configureAnalyticsApi(portalAnalyticsApi)
    const detail = (await portalAnalyticsApi.getAnalyticsStream('317548790616')) as AnalyticsStreamDetail

    expect(detail.sources).toHaveLength(1)
    const momentRollup = detail.momentRollups?.[0]
    expect(Object.keys(momentRollup?.emotes ?? {})).toHaveLength(3)
    const hits = topEmotesFromRollup(momentRollup!, 3, detail.topEmotes)
    expect(hits).toHaveLength(3)
    expect(hits.map((hit) => hit.name)).toEqual(['o7', 'LUL', 'KEKW'])
    expect(hits[0]?.image_url).toContain('o7.webp')
  })

  it('getAnalyticsStream exposes full momentRollups alongside downsampled chart rollups', async () => {
    getBackendUrlMock.mockReturnValue('https://api.streampulse.stream')
    const minutes = Array.from({ length: 300 }, (_, i) => ({
      offsetSeconds: (i + 1) * 60,
      chatCount: 10 + i,
      topEmotes: [{ name: 'LUL', provider: 'twitch', count: 5 }],
    }))
    apiClientMock.mockImplementation((path: string) => {
      if (path.endsWith('/minutes')) {
        return Promise.resolve({
          data: {
            streamId: '317839735654',
            channel: 'xqc',
            startedAt: new Date(0).toISOString(),
            minutes,
            updatedAt: Date.now(),
          },
        })
      }
      if (path.endsWith('/summary')) {
        return Promise.resolve({ data: { channel: 'xqc', topEmotes: [], updatedAt: Date.now() } })
      }
      if (path.includes('/channels/') && path.endsWith('/emotes')) {
        return Promise.resolve({ data: { topEmotes: [] } })
      }
      return Promise.resolve({
        data: {
          channel: 'xqc',
          state: 'historical',
          stream: { streamId: '317839735654', login: 'xqc', startedAt: new Date(0).toISOString() },
          sources: [],
          updatedAt: Date.now(),
        },
      })
    })

    const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
    configureAnalyticsApi(portalAnalyticsApi)
    const detail = (await portalAnalyticsApi.getAnalyticsStream('317839735654')) as AnalyticsStreamDetail

    expect(detail.momentRollups?.length).toBe(300)
    expect(detail.rollups.length).toBeLessThan(300)
  })

  it('getStreamGameSegments returns empty when games API returns none', async () => {
    apiClientMock.mockResolvedValueOnce({ data: [] })

    const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
    configureAnalyticsApi(portalAnalyticsApi)
    const segments = await portalAnalyticsApi.getStreamGameSegments('317839735654')

    expect(apiClientMock.mock.calls[0]?.[0]).toBe('/v1/analytics/streams/317839735654/games')
    expect(segments).toEqual([])
    expect(apiClientMock).toHaveBeenCalledTimes(1)
  })

  it('getStreamGameSegments preserves hydrated category art fields', async () => {
    apiClientMock.mockResolvedValueOnce({
      data: [
        {
          id: 1,
          streamId: '317250898295',
          gameName: 'Just Chatting',
          categoryId: '509658',
          boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658-210x280.jpg',
          offsetSeconds: 0,
          durationSeconds: 600,
          source: 'snapshot',
          createdAt: new Date(0).toISOString(),
        },
      ],
    })

    const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
    configureAnalyticsApi(portalAnalyticsApi)
    const segments = await portalAnalyticsApi.getStreamGameSegments('317250898295')

    expect(segments).toHaveLength(1)
    if (!Array.isArray(segments) || segments.length !== 1) {
      throw new Error('expected one game segment')
    }
    const [segment] = segments as GameSegment[]
    expect(segment).toMatchObject({
      categoryId: '509658',
      boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658-210x280.jpg',
    })
  })

  describe('mergePortalTopEmotes', () => {
    it('keeps minute-only emotes when summary exists', async () => {
      const { mergePortalTopEmotes } = await import('../src/lib/streamcloneAnalytics')
      getBackendUrlMock.mockReturnValue('https://api.streampulse.stream')

      const catalog = [
        {
          key: 'bttv:KAYAYA:KAYAYA',
          name: 'KAYAYA',
          provider: 'bttv',
          imageUrl: '/emotes/abc/1x.webp',
          count: 12,
        },
      ]
      const summary = [
        {
          key: 'seventv:BasedGod:BasedGod',
          name: 'BasedGod',
          provider: 'seventv',
          imageUrl: 'https://cdn.7tv.app/emote/01/4x.webp',
          count: 500,
        },
      ]

      const merged = mergePortalTopEmotes(catalog, summary)
      expect(merged).toHaveLength(2)
      expect(merged.find((e) => e.name === 'KAYAYA')).toMatchObject({
        count: 12,
        imageUrl: 'https://api.streampulse.stream/emotes/abc/1x.webp',
      })
    })

    it('summary count overrides minute count for the same emote', async () => {
      const { mergePortalTopEmotes } = await import('../src/lib/streamcloneAnalytics')

      const catalog = [
        {
          key: 'bttv:YEP:YEP',
          name: 'YEP',
          provider: 'bttv',
          imageUrl: 'https://cdn.betterttv.net/emote/123/3x',
          count: 5,
        },
      ]
      const summary = [
        {
          key: 'bttv:YEP:YEP',
          name: 'YEP',
          provider: 'bttv',
          count: 99,
        },
      ]

      const merged = mergePortalTopEmotes(catalog, summary)
      expect(merged).toHaveLength(1)
      expect(merged[0]).toMatchObject({
        name: 'YEP',
        count: 99,
        imageUrl: 'https://cdn.betterttv.net/emote/123/3x',
      })
    })

    it('absolutizes imageUrl from minute catalog when summary lacks one', async () => {
      const { mergePortalTopEmotes } = await import('../src/lib/streamcloneAnalytics')
      getBackendUrlMock.mockReturnValue('https://api.streampulse.stream')

      const catalog = [
        {
          key: 'seventv:PETPET:PETPET',
          name: 'PETPET',
          provider: 'seventv',
          imageUrl: '/emotes/uuid-pet/1x.webp',
          count: 8,
        },
      ]
      const summary = [
        {
          key: 'seventv:PETPET:PETPET',
          name: 'PETPET',
          provider: 'seventv',
          count: 40,
        },
      ]

      const merged = mergePortalTopEmotes(catalog, summary)
      expect(merged[0]?.imageUrl).toBe('https://api.streampulse.stream/emotes/uuid-pet/1x.webp')
    })

    it('fills recap-only 7TV identity from channel emotes catalog', async () => {
      const { mergePortalTopEmotes } = await import('../src/lib/streamcloneAnalytics')
      getBackendUrlMock.mockReturnValue('https://api.streampulse.stream')

      const summary = [
        {
          key: 'ffz:390924:KEKW',
          name: 'KEKW',
          provider: 'ffz',
          imageUrl: 'https://cdn.frankerfacez.com/emoticon/390924/4',
          count: 900,
        },
      ]
      const channelEmotes = [
        {
          key: 'seventv:01ABC:EZ',
          name: 'EZ',
          id: '01ABC',
          provider: 'seventv',
          imageUrl: 'https://cdn.7tv.app/emote/01ABC/4x.webp',
          count: 50,
        },
        {
          key: 'seventv:01DEF:gg',
          name: 'gg',
          id: 'local-uuid',
          provider: 'seventv',
          imageUrl: '/emotes/local-uuid/1x.webp',
          count: 100,
        },
      ]

      const merged = mergePortalTopEmotes([], summary, channelEmotes)
      expect(merged.find((e) => e.name === 'EZ')).toMatchObject({
        imageUrl: 'https://cdn.7tv.app/emote/01ABC/4x.webp',
      })
      expect(merged.find((e) => e.name === 'gg')?.imageUrl).toBe(
        'https://api.streampulse.stream/emotes/local-uuid/1x.webp',
      )
    })
  })

  describe('alignRollupEmoteKeys', () => {
    it('rekeys minute bucket emotes to stream summary keys', async () => {
      const { alignRollupEmoteKeys } = await import('../src/lib/streamcloneAnalytics')
      const topEmotes = [
        {
          key: 'seventv:eece963b-2e60-4957-b358-98224ffc1ece:o7',
          name: 'o7',
          provider: 'seventv',
          count: 100,
        },
      ]
      const rollups = [
        {
          minuteTs: '2026-07-04T18:00:00.000Z',
          viewerAvg: 0,
          viewerMax: 0,
          viewerLatest: 0,
          viewerSamples: 0,
          chatCount: 10,
          totalEmoteCount: 3,
          seventvEmoteCount: 3,
          emotes: { 'seventv:o7:o7': 3 },
        },
      ]
      const aligned = alignRollupEmoteKeys(rollups, topEmotes)
      expect(aligned[0]?.emotes).toEqual({
        'seventv:eece963b-2e60-4957-b358-98224ffc1ece:o7': 3,
      })
    })
  })

  describe('portalMinutesToRollups plot series', () => {
    it('keeps mid-rank stream-top emotes plottable (EDM-style)', async () => {
      const { portalMinutesToRollups, alignRollupEmoteKeys } = await import(
        '../src/lib/streamcloneAnalytics'
      )
      const { buildChartSeries } = await import('@streampulse/pulse-charts')
      const startedAt = '2026-07-13T18:00:00.000Z'
      const minutes = [
        {
          offsetSeconds: 0,
          chatCount: 200,
          totalEmoteCount: 290,
          topEmotes: [
            { name: 'LOL', provider: 'twitch', count: 100 },
            { name: 'GG', provider: 'twitch', count: 80 },
            { name: 'CTE', provider: 'twitch', count: 70 },
            { name: 'EDM', provider: 'twitch', count: 40 },
          ],
        },
        {
          offsetSeconds: 60,
          chatCount: 210,
          totalEmoteCount: 295,
          topEmotes: [
            { name: 'LOL', provider: 'twitch', count: 105 },
            { name: 'GG', provider: 'twitch', count: 80 },
            { name: 'CTE', provider: 'twitch', count: 70 },
            { name: 'EDM', provider: 'twitch', count: 40 },
          ],
        },
      ]
      const { rollups } = portalMinutesToRollups(startedAt, minutes)
      const topEmotes = [
        { key: 'twitch:1:LOL', name: 'LOL', provider: 'twitch', count: 205 },
        { key: 'twitch:4:EDM', name: 'EDM', provider: 'twitch', count: 80 },
      ]
      const aligned = alignRollupEmoteKeys(rollups, topEmotes)
      const series = buildChartSeries(
        aligned,
        new Set(['twitch:4:EDM']),
        0,
        0,
        false,
      )
      const edm = series.find(item => item.key === 'twitch:4:EDM' || item.label === 'EDM')
      expect(edm).toBeTruthy()
      expect(edm!.max).toBeGreaterThan(0)
    })

    it('dedupes corrupted duplicate offset-0 minutes (does not stack a fake spike at minute 0)', async () => {
      const { portalMinutesToRollups } = await import('../src/lib/streamcloneAnalytics')
      const startedAt = '2026-08-20T21:12:29Z'
      // Reproduces the real stableronaldo /minutes corruption: a block of rows
      // whose offsetSeconds were all collapsed to 0, plus a few real minutes.
      const minutes = [
        ...Array.from({ length: 1122 }, (_, index) => ({
          offsetSeconds: 0,
          chatCount: 500 + index,
          totalEmoteCount: 200 + index,
        })),
        { offsetSeconds: 60, chatCount: 767, totalEmoteCount: 222 },
        { offsetSeconds: 120, chatCount: 810, totalEmoteCount: 240 },
      ]
      const { rollups } = portalMinutesToRollups(startedAt, minutes)
      expect(rollups).toHaveLength(3)
      // The single surviving offset-0 row keeps the values of the LAST duplicate
      // (backend consolidate-by-minute last-wins semantics).
      expect(rollups[0]!.chatCount).toBe(500 + 1121)
      expect(rollups[0]!.totalEmoteCount).toBe(200 + 1121)
      // Real minutes land on their true wall-clock timestamps.
      expect(rollups[1]!.minuteTs).toBe('2026-08-20T21:13:29.000Z')
      expect(rollups[2]!.minuteTs).toBe('2026-08-20T21:14:29.000Z')
    })
  })

  describe('portal history + live honesty', () => {
    it('getChannelStreamHistory uses portal /channels streams on hosted (period ignored)', async () => {
      getBackendUrlMock.mockReturnValue('https://api.streampulse.stream')
      apiClientMock.mockResolvedValue({
        data: {
          channel: 'xqc',
          items: [
            {
              streamId: 's1',
              login: 'xqc',
              displayName: 'xQc',
              title: 'test',
              category: 'Just Chatting',
              startedAt: '2026-07-05T19:00:00.000Z',
              endedAt: null,
              peakViewers: 1000,
              viewerSamples: 50,
              chatMessages: 200,
            },
          ],
          updatedAt: Date.now(),
        },
      })

      const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
      configureAnalyticsApi(portalAnalyticsApi)
      const history = (await portalAnalyticsApi.getChannelStreamHistory('xqc', 'all')) as {
        items: Array<{ streamId?: string; id?: string }>
      }

      expect(apiClientMock).toHaveBeenCalledWith('/v1/portal/analytics/channels/xqc/streams?limit=100')
      expect(history.items[0]?.streamId ?? history.items[0]?.id).toBe('s1')
    })

    it('getAnalyticsLive maps coverageStartOffsetSeconds and viewerSource', async () => {
      getBackendUrlMock.mockReturnValue('https://api.streampulse.stream')
      apiClientMock.mockResolvedValue({
        data: {
          channel: 'xqc',
          state: 'live',
          stream: {
            streamId: 's1',
            login: 'xqc',
            displayName: 'xQc',
            category: 'Just Chatting',
            startedAt: '2026-07-05T19:00:00.000Z',
          },
          rollups: [{ offsetSeconds: 180, chatCount: 5, viewerAvg: 1000 }],
          topEmotes: [],
          sources: [],
           updatedAt: Date.now(),
           coverageStartOffsetSeconds: 180,
           viewerSource: 'live',
           chatCoverage: {
             chatSpanMinutes: 45,
             streamSpanMinutes: 120,
             coveragePct: 37.5,
             partial: true,
           },
           availability: {
             missingRanges: [{ fromOffsetSeconds: 900, toOffsetSeconds: 1800 }],
           },
        },
      })

      const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
      configureAnalyticsApi(portalAnalyticsApi)
      const detail = (await portalAnalyticsApi.getAnalyticsLive('xqc')) as AnalyticsStreamDetail

       expect(detail.coverageStartOffsetSeconds).toBe(180)
       expect(detail.viewerSource).toBe('live')
       expect(detail.chatCoverage).toEqual({
         chatSpanMinutes: 45,
         streamSpanMinutes: 120,
         coveragePct: 37.5,
         partial: true,
         vodDurationSec: undefined,
       })
     })

    it('rejects operator historical sync on hosted portal routes', async () => {
      getBackendUrlMock.mockReturnValue('https://api.streampulse.stream')
      const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
      await expect(portalAnalyticsApi.startHistoricalSync('s1', 'xqc')).rejects.toThrow(
        /not available on the public StreamPulse portal/i,
      )
    })

    it('getAnalyticsStream does not block the first frame on the channel emote catalog', async () => {
      getBackendUrlMock.mockReturnValue('https://api.streampulse.stream')
      apiClientMock.mockImplementation((path: string) => {
        if (path.includes('/streams/s1') && !path.includes('/minutes') && !path.includes('/summary')) {
          return Promise.resolve({
            data: {
              channel: 'jynxzi',
              state: 'ended',
              stream: {
                streamId: 's1',
                login: 'jynxzi',
                startedAt: '2026-07-08T18:52:41Z',
              },
              sources: [],
              updatedAt: Date.now(),
            },
          })
        }
        if (path.includes('/minutes')) {
          return Promise.resolve({ data: { minutes: [] } })
        }
        if (path.includes('/summary')) {
          return Promise.resolve({ data: { topEmotes: [] } })
        }
        if (path.includes('/channels/jynxzi/emotes')) {
          return Promise.resolve({
            data: {
              topEmotes: [
                {
                  provider: 'seventv',
                  providerEmoteId: '01ABC',
                  name: '67',
                  imageUrl: 'https://cdn.7tv.app/emote/01ABC/4x.webp',
                  useCount: 100,
                },
              ],
            },
          })
        }
        return Promise.reject(new Error(`unexpected ${path}`))
      })

      const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
      configureAnalyticsApi(portalAnalyticsApi)
      const detail = (await portalAnalyticsApi.getAnalyticsStream('s1', {
        sparse: false,
        channel: 'jynxzi',
      })) as AnalyticsStreamDetail

      expect(apiClientMock).not.toHaveBeenCalledWith('/v1/portal/analytics/channels/jynxzi/emotes?range=30d')
      expect(detail.topEmotes).toEqual([])
    })
  })
})
