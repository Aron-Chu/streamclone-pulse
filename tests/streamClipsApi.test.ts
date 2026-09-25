import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchStreamClips } from '../src/background/api.ts'

afterEach(() => vi.unstubAllGlobals())
describe('stream-specific clip windows', () => {
  it('resolves the last completed broadcast when offline and filters unrelated clips', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/streams/history')) return Response.json({ items: [
        { id: 'older', startedAt: '2026-09-17T12:00:00Z', endedAt: '2026-09-17T14:00:00Z' },
        { id: 'latest', startedAt: '2026-09-18T12:00:00Z', endedAt: '2026-09-18T14:00:00Z' },
      ] })
      expect(new URL(url).searchParams.get('startedAt')).toBe('2026-09-18T12:00:00Z')
      expect(new URL(url).searchParams.get('endedAt')).toBe('2026-09-18T14:00:00Z')
      return Response.json({ items: [
        { id: 'yes', title: 'Latest', url: 'https://clips.twitch.tv/Latest', createdAt: '2026-09-18T13:00:00Z' },
        { id: 'no', title: 'Older', url: 'https://clips.twitch.tv/Older', createdAt: '2026-09-17T13:00:00Z' },
      ] })
    })
    vi.stubGlobal('fetch', fetch)
    expect((await fetchStreamClips('xqc', { isLive: false }, 'https://api.streampulse.stream')).map(clip => clip.id)).toEqual(['yes'])
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('does not substitute a different stream when the requested identity is absent', async () => {
    const fetch = vi.fn(async () => Response.json({ items: [] }))
    vi.stubGlobal('fetch', fetch)
    expect(await fetchStreamClips('xqc', { isLive: false, streamId: 'missing' }, 'https://api.streampulse.stream')).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not request past-stream clips while live start metadata is missing', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await fetchStreamClips('xqc', { isLive: true }, 'https://api.streampulse.stream')).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('resolves an older VOD by video identity, not the latest broadcast', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/streams/history')) return Response.json({ items: [
        { id: 'latest', videoId: '222', startedAt: '2026-09-18T12:00:00Z', endedAt: '2026-09-18T14:00:00Z' },
        { id: 'older', videoId: '111', startedAt: '2026-09-17T12:00:00Z', endedAt: '2026-09-17T14:00:00Z' },
      ] })
      expect(new URL(url).searchParams.get('startedAt')).toBe('2026-09-17T12:00:00Z')
      expect(new URL(url).searchParams.get('endedAt')).toBe('2026-09-17T14:00:00Z')
      return Response.json({ items: [{ id: 'vod-clip', title: 'VOD clip', url: 'https://clips.twitch.tv/Vod', createdAt: '2026-09-17T13:00:00Z' }] })
    })
    vi.stubGlobal('fetch', fetch)
    expect((await fetchStreamClips('xqc', { isLive: false, vodId: '111' }, 'https://api.streampulse.stream')).map(clip => clip.id)).toEqual(['vod-clip'])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    { streamId: 'older', vodId: '222' },
    { streamId: 'older', startedAt: '2026-09-18T12:00:00Z' },
  ])('fails closed for conflicting requested identities %j', async identity => {
    const fetch = vi.fn(async () => Response.json({ items: [
      { id: 'older', videoId: '111', startedAt: '2026-09-17T12:00:00Z', endedAt: '2026-09-17T14:00:00Z' },
      { id: 'latest', videoId: '222', startedAt: '2026-09-18T12:00:00Z', endedAt: '2026-09-18T14:00:00Z' },
    ] }))
    vi.stubGlobal('fetch', fetch)
    expect(await fetchStreamClips('xqc', { isLive: false, ...identity }, 'https://api.streampulse.stream')).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('exposes a request failure for the carousel retry state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })))
    await expect(fetchStreamClips('xqc', {
      startedAt: '2026-09-17T12:00:00Z', endedAt: '2026-09-17T14:00:00Z', isLive: false,
    }, 'https://api.streampulse.stream')).rejects.toThrow('stream_clips_unavailable')
  })
})
