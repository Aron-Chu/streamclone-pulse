import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fetchTopClip } from '../src/background/api.ts'
import type { ExtensionClip } from '../src/shared/messages.ts'

describe('fetchTopClip', () => {
  const clips: ExtensionClip[] = [
    { id: 'low', title: 'Low', url: 'https://clips.twitch.tv/low', viewCount: 5, createdAt: '2026-09-18T12:30:00Z' },
    { id: 'high', title: 'High', url: 'https://clips.twitch.tv/high', viewCount: 500, createdAt: '2026-09-18T13:30:00Z' },
  ]

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(
      JSON.stringify({ items: url.includes('/streams/history')
        ? [{ id: 'stream-1', startedAt: '2026-09-18T12:00:00Z', endedAt: '2026-09-18T14:00:00Z' }]
        : clips }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns highest viewCount clip', async () => {
    const clip = await fetchTopClip('streamer', { isLive: false }, 'http://localhost:8081')
    expect(clip?.id).toBe('high')
  })

  it('returns null on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })))
    const clip = await fetchTopClip('streamer', undefined, 'http://localhost:8081')
    expect(clip).toBeNull()
  })

  it('returns null on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    const clip = await fetchTopClip('streamer', undefined, 'http://localhost:8081')
    expect(clip).toBeNull()
  })
})
