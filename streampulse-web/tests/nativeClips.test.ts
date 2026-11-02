import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clipEmbedSrc, clipVodHref, clipsNotOn, loadNativeClips, lookupNativeClips, nativeClipsSearch, toNativeClip,
} from '../src/lib/nativeClips'
import { clipListKey, clipListQueryFromKey } from '../src/lib/nativeClipsList'
import { normalizeApiError } from '../src/lib/apiClient'
import { nativeClipsPage as page, rawNativeClip as rawClip, stubClipsFetch as stubFetch } from './fixtures/nativeClips'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('toNativeClip', () => {
  it('keeps a clip the backend vouched for', () => {
    const clip = toNativeClip(rawClip())
    expect(clip).toMatchObject({
      id: 'BraveClipSlug-abc_1', url: 'https://clips.twitch.tv/BraveClipSlug-abc_1', title: 'Chat loses it',
      createdAt: Date.parse('2026-11-01T12:00:00Z'), views: { count: 1234, checkedAt: Date.parse('2026-11-01T13:00:00Z') },
      vod: { videoId: '2100000000', offsetSeconds: 3725 }, available: true,
    })
  })

  it('accepts the channel clip link Twitch also uses', () => {
    expect(toNativeClip(rawClip({ url: 'https://www.twitch.tv/xqc/clip/BraveClipSlug-abc_1' }))?.url).toBe('https://www.twitch.tv/xqc/clip/BraveClipSlug-abc_1')
  })

  it.each([
    ['another host', { url: 'https://clips.twitch.tv.example.com/BraveClipSlug-abc_1' }],
    ['plain http', { url: 'http://clips.twitch.tv/BraveClipSlug-abc_1' }],
    ['a link to another clip', { url: 'https://clips.twitch.tv/OtherClip' }],
    ['a link with a query', { url: 'https://clips.twitch.tv/BraveClipSlug-abc_1?tt_medium=x' }],
    ['a bad id', { id: 'bad id', url: 'https://clips.twitch.tv/bad%20id' }],
    ['a control character in the title', { title: `Chat${String.fromCharCode(7)}` }],
    ['no length', { durationSeconds: 0 }],
    ['a length over two minutes', { durationSeconds: 121 }],
    ['a bad game', { game: { id: '', name: 'x' } }],
    ['a bad VOD id', { vod: { videoId: '0123', offsetSeconds: 1 } }],
    ['negative views', { views: { count: -1, checkedAt: '2026-11-01T13:00:00Z' } }],
    ['a reaction that is not a number', { reaction: { chatLift: 'high', emoteLift: 1, chatters: 1, largestShare: 0.1 } }],
    ['no availability', { available: undefined }],
  ])('leaves out a clip with %s', (_, overrides) => {
    expect(toNativeClip(rawClip(overrides))).toBeNull()
  })

  it('drops pictures that are not on Twitch and fills an empty title', () => {
    const clip = toNativeClip(rawClip({ title: '  ', thumbnailUrl: 'https://evil.example/x.jpg',
      channel: { id: '1', login: 'a', displayName: '', profileImageUrl: 'http://static-cdn.jtvnw.net/x.png' } }))
    expect(clip).toMatchObject({ title: 'Untitled clip', thumbnailUrl: '', channel: { displayName: 'a', profileImageUrl: '' } })
  })

  it('keeps unknown views and VOD as unknown, never zero', () => {
    const clip = toNativeClip(rawClip({ views: null, vod: { videoId: '2100000000', offsetSeconds: null } }))
    expect(clip?.views).toBeNull()
    expect(clip?.vod).toEqual({ videoId: '2100000000', offsetSeconds: null })
    expect(clipVodHref(clip!)).toBeNull()
  })

  it('keeps a game’s box art only from Twitch’s box-art address for that game', () => {
    const art = 'https://static-cdn.jtvnw.net/ttv-boxart/509658-144x192.jpg'
    expect(toNativeClip(rawClip({ game: { id: '509658', name: 'Just Chatting', boxArtUrl: art } }))?.game?.boxArtUrl).toBe(art)
    expect(toNativeClip(rawClip({ game: { id: '509658', name: 'Just Chatting', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/27471-144x192.jpg' } }))?.game?.boxArtUrl).toBe('')
    expect(toNativeClip(rawClip({ game: { id: '509658', name: 'Just Chatting', boxArtUrl: 'https://example.com/509658-144x192.jpg' } }))?.game?.boxArtUrl).toBe('')
    expect(toNativeClip(rawClip())?.game).toEqual({ id: '509658', name: 'Just Chatting', boxArtUrl: '' })
  })
})

describe('nativeClipsSearch', () => {
  it('leaves defaults out so the same view asks for the same URL', () => {
    expect(nativeClipsSearch({ period: '7d', sort: 'newest', mix: true })).toBe('period=7d&sort=newest')
  })

  it('trims, lowercases and bounds the search', () => {
    const q = `  ${'A'.repeat(80)}  `
    const params = new URLSearchParams(nativeClipsSearch({ period: '24h', sort: 'views', game: '509658', q, mix: false, cursor: '24' }))
    expect(params.get('q')).toBe('a'.repeat(64))
    expect(Object.fromEntries(params)).toMatchObject({ period: '24h', sort: 'views', game: '509658', mix: '0', cursor: '24' })
  })

  it('names one channel and a page size, and a list can be read again from its key', () => {
    const query = { period: '30d', sort: 'newest', channel: 'KaiCenat', mix: false, limit: 48 } as const
    const key = clipListKey(query)
    expect(key).toBe('period=30d&sort=newest&channel=kaicenat&mix=0&limit=48')
    expect(clipListQueryFromKey(key)).toEqual({ period: '30d', sort: 'newest', channel: 'kaicenat', mix: false, limit: 48 })
    expect(clipListQueryFromKey('saved')).toBeNull()
    expect(clipListQueryFromKey('period=1y&sort=newest')).toBeNull()
  })
})

describe('loadNativeClips', () => {
  it('reads one page and leaves out malformed or repeated clips', async () => {
    const calls = stubFetch({ body: page([rawClip(), rawClip(), rawClip({ id: 'Two', url: 'https://evil.example/Two' })],
      { facets: { games: [{ id: '509658', name: 'Just Chatting', count: 3 }, { id: '', name: 'x', count: 1 }], channels: [] },
        scope: { total: 40, matching: 30, truncated: true }, unranked: { count: 2 }, nextCursor: '24' }) })
    const result = await loadNativeClips({ period: '7d', sort: 'newest', mix: true })
    expect(new URL(calls[0].url).pathname).toBe('/v1/public/clips')
    expect(new URL(calls[0].url).search).toBe('?period=7d&sort=newest')
    expect(calls[0].init?.cache).toBe('default')
    expect(result.items.map(clip => clip.id)).toEqual(['BraveClipSlug-abc_1'])
    expect(result.games).toEqual([{ id: '509658', name: 'Just Chatting', count: 3 }])
    expect(result).toMatchObject({ total: 40, matching: 30, truncated: true, unranked: 2, nextCursor: '24' })
  })

  it('ignores a cursor that is not an offset', async () => {
    stubFetch({ body: page([rawClip()], { nextCursor: '../x' }) })
    expect((await loadNativeClips({ period: '7d', sort: 'newest', mix: true })).nextCursor).toBeNull()
  })

  it('refuses an answer of another shape', async () => {
    stubFetch({ body: { schemaVersion: 2, items: [] } })
    await expect(loadNativeClips({ period: '7d', sort: 'newest', mix: true })).rejects.toMatchObject({ code: 'schema' })
  })
})

describe('lookupNativeClips', () => {
  it('asks in groups of 50, never cached, and keeps the order asked', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `clip${i}`)
    const calls = stubFetch(
      { body: page([rawClip({ id: 'clip3', url: 'https://clips.twitch.tv/clip3' }), rawClip({ id: 'clip1', url: 'https://clips.twitch.tv/clip1' })]) },
      { body: page([rawClip({ id: 'clip55', url: 'https://clips.twitch.tv/clip55', available: false })]) },
    )
    const result = await lookupNativeClips([...ids, 'clip1', 'not valid'])
    expect(calls).toHaveLength(2)
    expect(new URL(calls[0].url).searchParams.get('ids')?.split(',')).toHaveLength(50)
    expect(new URL(calls[1].url).searchParams.get('ids')?.split(',')).toHaveLength(10)
    expect(calls.every(call => call.init?.cache === 'no-store')).toBe(true)
    expect(result.map(clip => [clip.id, clip.available])).toEqual([['clip1', true], ['clip3', true], ['clip55', false]])
  })
})

describe('Twitch links', () => {
  it('builds the clip player for this page and the VOD position', () => {
    const src = new URL(clipEmbedSrc('BraveClipSlug-abc_1', 'streampulse.stream'))
    expect(src.origin + src.pathname).toBe('https://clips.twitch.tv/embed')
    expect(Object.fromEntries(src.searchParams)).toEqual({ clip: 'BraveClipSlug-abc_1', parent: 'streampulse.stream', autoplay: 'true' })
    expect(clipVodHref(toNativeClip(rawClip())!)).toBe('https://www.twitch.tv/videos/2100000000?t=1h2m5s')
  })

  it('reads a 404 as the library being switched off', () => {
    expect(clipsNotOn(normalizeApiError(404, { error: 'not found' }))).toBe(true)
    expect(clipsNotOn(normalizeApiError(500, { error: 'boom' }))).toBe(false)
  })
})
