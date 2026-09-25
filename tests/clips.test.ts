import { describe, expect, it } from 'vitest'
import { clipWindowBounds, pickTopClip, selectStreamClips } from '../src/shared/clips.ts'
import type { ExtensionClip } from '../src/shared/messages.ts'

describe('pickTopClip', () => {
  it('filters stream bounds, deduplicates and ranks only matching clips', () => {
    const clip = { id: 'a', title: 'A', url: 'https://clips.twitch.tv/a', createdAt: '2026-09-19T12:00:00Z', viewCount: 10 }
    expect(selectStreamClips([
      clip, clip, { ...clip, id: 'b', viewCount: 20 },
      { ...clip, id: 'old', createdAt: '2026-09-18T12:00:00Z', viewCount: 1000 },
      { ...clip, id: 'unknown', createdAt: undefined },
      { ...clip, id: 'future', createdAt: '2026-09-20T12:00:00Z' },
    ], '2026-09-19T11:00:00Z', '2026-09-19T13:00:00Z').map(item => item.id)).toEqual(['b', 'a'])
    expect(selectStreamClips([clip], 'invalid', '2026-09-19T13:00:00Z')).toEqual([])
  })
  it('returns null for empty list', () => {
    expect(pickTopClip([])).toBeNull()
  })

  it('picks highest viewCount', () => {
    const items: ExtensionClip[] = [
      { id: 'a', title: 'A', url: 'https://clips.twitch.tv/a', viewCount: 12 },
      { id: 'b', title: 'B', url: 'https://clips.twitch.tv/b', viewCount: 99 },
      { id: 'c', title: 'C', url: 'https://clips.twitch.tv/c', viewCount: 45 },
    ]
    expect(pickTopClip(items)?.id).toBe('b')
  })

  it('treats missing viewCount as zero', () => {
    const items: ExtensionClip[] = [
      { id: 'a', title: 'A', url: 'https://clips.twitch.tv/a' },
      { id: 'b', title: 'B', url: 'https://clips.twitch.tv/b', viewCount: 1 },
    ]
    expect(pickTopClip(items)?.id).toBe('b')
  })
})

describe('clipWindowBounds', () => {
  it('uses stream start when live', () => {
    const startedAt = '2026-06-21T10:00:00.000Z'
    const bounds = clipWindowBounds(startedAt, true)
    expect(bounds.startedAt).toBe(startedAt)
    expect(bounds.endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('defaults to last 7 days when not live', () => {
    const bounds = clipWindowBounds(undefined, false)
    const start = new Date(bounds.startedAt).getTime()
    const end = new Date(bounds.endedAt).getTime()
    expect(end - start).toBeGreaterThanOrEqual(6.9 * 24 * 60 * 60 * 1000)
  })
})
