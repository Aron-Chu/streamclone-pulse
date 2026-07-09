import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fetchTopClip } from '../src/background/api.ts'
import type { ExtensionClip } from '../src/shared/messages.ts'

describe('fetchTopClip', () => {
  const clips: ExtensionClip[] = [
    { id: 'low', title: 'Low', url: 'https://clips.twitch.tv/low', viewCount: 5 },
    { id: 'high', title: 'High', url: 'https://clips.twitch.tv/high', viewCount: 500 },
  ]

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: clips }),
    })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns highest viewCount clip', async () => {
    const clip = await fetchTopClip('streamer', { isLive: false }, 'http://localhost:8081')
    expect(clip?.id).toBe('high')
  })

  it('returns null on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    const clip = await fetchTopClip('streamer', undefined, 'http://localhost:8081')
    expect(clip).toBeNull()
  })

  it('returns null on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    const clip = await fetchTopClip('streamer', undefined, 'http://localhost:8081')
    expect(clip).toBeNull()
  })
})
