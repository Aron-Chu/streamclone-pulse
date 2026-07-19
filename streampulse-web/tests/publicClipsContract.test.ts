import { describe, expect, it } from 'vitest'
import {
  normalizeHubPublicClip,
  normalizeHubPublicClips,
  sanitizeAnalyticsHref,
  sanitizeTwitchVodHref,
} from '../src/lib/publicClipsContract'

const valid = {
  id: 'clip-1',
  login: 'xqc',
  title: 'Peak moment',
  thumbnailUrl: 'https://cdn.example/thumb.jpg',
  playbackUrl: 'https://cdn.example/play.mp4',
  durationSeconds: 42,
  publishedAt: '2026-07-10T12:00:00Z',
}

describe('publicClipsContract', () => {
  it('accepts playback-verified public clips', () => {
    const clip = normalizeHubPublicClip(valid)
    expect(clip?.id).toBe('clip-1')
    expect(clip?.login).toBe('xqc')
  })

  it('rejects missing media or duration', () => {
    expect(normalizeHubPublicClip({ ...valid, thumbnailUrl: '' })).toBeNull()
    expect(normalizeHubPublicClip({ ...valid, playbackUrl: '' })).toBeNull()
    expect(normalizeHubPublicClip({ ...valid, durationSeconds: 0 })).toBeNull()
    expect(normalizeHubPublicClip({ ...valid, durationSeconds: -1 })).toBeNull()
  })

  it('rejects non-http media URLs and hostile shapes', () => {
    expect(normalizeHubPublicClip(null)).toBeNull()
    expect(normalizeHubPublicClip([])).toBeNull()
    expect(
      normalizeHubPublicClip({ ...valid, thumbnailUrl: 'javascript:alert(1)' }),
    ).toBeNull()
    expect(
      normalizeHubPublicClip({ ...valid, playbackUrl: 'file:///tmp/clip.mp4' }),
    ).toBeNull()
    expect(normalizeHubPublicClip({ ...valid, topReaction: 'KEKW' })).toBeNull()
  })

  it('rejects private candidate / job fields', () => {
    expect(normalizeHubPublicClip({ ...valid, status: 'queued' })).toBeNull()
    expect(normalizeHubPublicClip({ ...valid, candidateId: 'c1' })).toBeNull()
    expect(normalizeHubPublicClip({ ...valid, workerState: 'worker_ready_unverified' })).toBeNull()
    expect(normalizeHubPublicClip({ ...valid, betaKey: 'x' })).toBeNull()
    expect(normalizeHubPublicClip({ ...valid, jobId: 'j1' })).toBeNull()
    expect(normalizeHubPublicClip({ ...valid, renderToken: 't' })).toBeNull()
  })

  it('filters arrays to valid clips only and rejects non-arrays', () => {
    const clips = normalizeHubPublicClips([valid, { ...valid, id: '' }, null])
    expect(clips).toHaveLength(1)
    expect(normalizeHubPublicClips({ clips: [valid] })).toEqual([])
    expect(normalizeHubPublicClips('nope')).toEqual([])
  })

  it('keeps optional reaction server-owned when present', () => {
    const clip = normalizeHubPublicClip({
      ...valid,
      topReaction: { name: 'KEKW', provider: '7tv', imageUrl: 'https://cdn.example/e.webp' },
    })
    expect(clip?.topReaction?.name).toBe('KEKW')
    expect(clip?.topReaction?.provider).toBe('7tv')
  })

  it('accepts same-origin analytics paths and HTTPS Twitch VOD URLs', () => {
    expect(
      normalizeHubPublicClip({
        ...valid,
        analyticsHref: '/analytics/xqc/123',
        vodHref: 'https://www.twitch.tv/videos/123456789',
      }),
    ).toMatchObject({
      analyticsHref: '/analytics/xqc/123',
      vodHref: 'https://www.twitch.tv/videos/123456789',
    })
    expect(
      sanitizeAnalyticsHref('https://streampulse.stream/analytics/xqc'),
    ).toBe('/analytics/xqc')
  })

  it('omits hostile analyticsHref / vodHref without rewriting destinations', () => {
    const clip = normalizeHubPublicClip({
      ...valid,
      analyticsHref: 'javascript:alert(1)',
      vodHref: 'data:text/html,hi',
    })
    expect(clip).not.toBeNull()
    expect(clip?.analyticsHref).toBeUndefined()
    expect(clip?.vodHref).toBeUndefined()

    expect(sanitizeAnalyticsHref('//evil.example/analytics/xqc')).toBeUndefined()
    expect(sanitizeAnalyticsHref('https://evil.example/analytics/xqc')).toBeUndefined()
    expect(sanitizeAnalyticsHref('/dashboard/clips')).toBeUndefined()
    expect(sanitizeTwitchVodHref('http://www.twitch.tv/videos/1')).toBeUndefined()
    expect(sanitizeTwitchVodHref('https://evil.example/videos/1')).toBeUndefined()
    expect(sanitizeTwitchVodHref('https://www.twitch.tv/videos/abc')).toBeUndefined()
    expect(sanitizeTwitchVodHref('not a url')).toBeUndefined()
    expect(sanitizeTwitchVodHref('//www.twitch.tv/videos/1')).toBeUndefined()
  })
})
