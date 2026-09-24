import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizePublicHub } from '../src/lib/publicHub'
import { PUBLIC_HUB_CACHE_MAX_CHARS, readPublicHubCache, writePublicHubCache, publicHubCacheKey } from '../src/lib/publicHubCache'

const origin = 'https://api.streampulse.stream'
describe('bounded public hub persistence', () => {
  beforeEach(() => localStorage.clear())
  it('retains at most two projections without removing unrelated preferences', () => {
    localStorage.setItem('preference', 'keep')
    const data = normalizePublicHub({})
    for (const window of ['30m', '24h', '7d'] as const) writePublicHubCache(origin, window, data)
    expect(localStorage.length).toBe(3)
    expect(localStorage.getItem('preference')).toBe('keep')
  })
  it('does not rewrite unchanged snapshots', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem')
    const data = normalizePublicHub({})
    writePublicHubCache(origin, '30m', data)
    writePublicHubCache(origin, '30m', structuredClone(data))
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('rejects oversized or future-dated cached input', () => {
    const key = publicHubCacheKey(origin, '30m')
    localStorage.setItem(key, 'x'.repeat(PUBLIC_HUB_CACHE_MAX_CHARS + 1))
    expect(readPublicHubCache(origin, '30m')).toBeNull()
    writePublicHubCache(origin, '30m', normalizePublicHub({}))
    const entry = JSON.parse(localStorage.getItem(key)!)
    entry.cachedAt = Date.now() + 10 * 60_000
    localStorage.setItem(key, JSON.stringify(entry))
    expect(readPublicHubCache(origin, '30m')).toBeNull()
  })

  it('projects a full hub body before persisting a projected snapshot', () => {
    const generatedAt = new Date().toISOString()
    const liveChannels = Array.from({ length: 1500 }, (_, i) => ({
      login: `channel${i}`, displayName: `Channel ${i}`, viewers: 100 + i, title: `A long live title ${'x'.repeat(80)} ${i}`,
    }))
    const full = normalizePublicHub({
      generatedAt,
      corpusPipeline: { generatedAt, state: 'healthy' },
      activity: { windowMinutes: 30, channelCount: 1500, points: [{ t: Date.now() - 60_000, viewers: 1, chat: 1, emotes: 1 }] },
      liveChannels,
      topEmotes: [{ name: 'KEKW', count: 10, sharePct: 1 }],
      livePulseMoments: [{ login: 'channel1', streamId: 's1', offsetSeconds: 60, at: Date.now() - 60_000, score: 50, label: 'Chat spike' }],
    } as never)
    expect(JSON.stringify(full).length).toBeGreaterThan(100_000)

    writePublicHubCache(origin, '30m', full, 'moments')
    const cached = readPublicHubCache(origin, '30m', 'moments')
    expect(cached).not.toBeNull()
    expect(cached!.data.livePulseMoments.map(moment => moment.streamId)).toEqual(['s1'])
    expect(cached!.data.liveChannels).toEqual([])
    expect(cached!.data.topEmotes).toEqual([])
    expect(cached!.data.activity.points).toEqual([])
    expect(cached!.data.activity.windowMinutes).toBe(30)
    // The full-hub key is untouched by a projected write.
    expect(localStorage.getItem(publicHubCacheKey(origin, '30m'))).toBeNull()
  })

  it('keeps fallback inputs when a projected hub has no network peaks', () => {
    const generatedAt = new Date().toISOString()
    const full = normalizePublicHub({
      generatedAt,
      corpusPipeline: { generatedAt, state: 'healthy' },
      liveChannels: [{ login: 'Featured', displayName: 'Featured', viewers: 5 }, { login: 'other', displayName: 'Other', viewers: 3 }],
      featuredSession: { login: 'featured', streamId: 's9' },
      moments: [{ login: 'featured', streamId: 's9', offsetSeconds: 120, label: 'Peak' }],
    } as never)
    writePublicHubCache(origin, '30m', full, 'moments')
    const cached = readPublicHubCache(origin, '30m', 'moments')!.data
    expect(cached.featuredSession.login).toBe('featured')
    expect(cached.moments).toHaveLength(1)
    expect(cached.liveChannels.map(channel => channel.login)).toEqual(['Featured'])
  })

  it('keeps only ticker lanes for the tickers projection', () => {
    const generatedAt = new Date().toISOString()
    const full = normalizePublicHub({
      generatedAt,
      corpusPipeline: { generatedAt, state: 'healthy' },
      topEmotes: [{ name: 'KEKW', count: 10, sharePct: 1 }],
      topMovers: [{ login: 'riser', seventvPerMin: 5 }],
      livePulseMoments: [{ login: 'channel1', streamId: 's1', offsetSeconds: 60, at: Date.now(), score: 50, label: 'Chat spike' }],
    } as never)
    writePublicHubCache(origin, '30m', full, 'tickers')
    const cached = readPublicHubCache(origin, '30m', 'tickers')!.data
    expect(cached.topEmotes.map(emote => emote.name)).toEqual(['KEKW'])
    expect(cached.topMovers).toHaveLength(1)
    expect(cached.livePulseMoments).toEqual([])
  })

  it('does not resurrect a normalized stats fallback as a healthy hub read', () => {
    const generatedAt = new Date().toISOString()
    const statsFallback = normalizePublicHub({ generatedAt, corpus: {
      streamsTracked: 10, momentsDetected: 0, chatMessagesProcessed: 0, emotesIndexed: 0, vodsAnalyzed: 0,
    } })
    writePublicHubCache(origin, '30m', statsFallback)
    expect(readPublicHubCache(origin, '30m')).toBeNull()

    const fullHub = normalizePublicHub({ generatedAt, corpusPipeline: { generatedAt, state: 'healthy' } })
    writePublicHubCache(origin, '30m', fullHub)
    expect(readPublicHubCache(origin, '30m')?.data.corpusPipeline.available).toBe(true)
  })
})
