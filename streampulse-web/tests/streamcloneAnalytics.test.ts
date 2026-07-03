import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAnalyticsApi } from '@streamclone/analytics-console'
import type { AnalyticsStreamDetail } from '@streamclone/analytics-console'

const apiClientMock = vi.fn()
const getBackendUrlMock = vi.fn(() => 'http://127.0.0.1:8090')

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
    getBackendUrlMock.mockReset().mockReturnValue('http://127.0.0.1:8090')
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

  it('getAnalyticsStream resolves per-minute emote images from sanitized BucketEmote.imageUrl, not a fabricated id', async () => {
    // Hosted/custom backends use the sanitized /v1/portal/analytics/* bundle path.
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
    const [key] = Object.keys(detail.rollups[0].emotes)
    const catalogEntry = detail.topEmotes.find((e) => e.key === key)
    expect(catalogEntry?.imageUrl).toBe('https://static-cdn.jtvnw.net/emoticons/v2/425618/default/dark/1.0')
    // The synthetic id must never be treated as the real Twitch numeric emote id.
    expect(catalogEntry?.id).not.toBe('425618')
  })

  it('getAnalyticsStream prefers stream summary topEmote totals over minute bucket sums', async () => {
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
    expect(detail.topEmotes[0]?.count).toBe(10400)
  })

  it('getStreamGameSegments uses local analytics games route and falls back to detail', async () => {
    apiClientMock
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: {
          channel: 'eliasn97',
          state: 'historical',
          stream: {
            streamId: '317839735654',
            login: 'eliasn97',
            startedAt: new Date().toISOString(),
            category: 'VALORANT',
          },
          rollups: [minute(0)],
          topEmotes: [],
          sources: [],
          updatedAt: Date.now(),
        } satisfies AnalyticsStreamDetail,
      })

    const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
    configureAnalyticsApi(portalAnalyticsApi)
    const segments = await portalAnalyticsApi.getStreamGameSegments('317839735654')

    expect(apiClientMock.mock.calls[0]?.[0]).toBe('/v1/analytics/streams/317839735654/games')
    expect(segments).toEqual([
      {
        id: 0,
        streamId: '317839735654',
        gameName: 'VALORANT',
        boxArtUrl: '',
        offsetSeconds: 0,
        durationSeconds: 60,
        createdAt: new Date(0).toISOString(),
      },
    ])
  })
})
