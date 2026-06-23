import { describe, expect, it } from 'vitest'
import {
  buildTwitchVodUrl,
  formatPastVodDate,
  formatPastVodDuration,
  mergePastVodRows,
  pastVodAnalyticsStatusLabel,
  resolvePastVodAnalyticsStatus,
  vodThumbnailUrl,
} from '../src/shared/pastVods.ts'

describe('vodThumbnailUrl', () => {
  it('replaces twitch template placeholders', () => {
    expect(vodThumbnailUrl('https://example/%{width}x%{height}.jpg', 72, 40)).toBe(
      'https://example/72x40.jpg',
    )
  })
})

describe('buildTwitchVodUrl', () => {
  it('builds twitch vod url with optional offset', () => {
    expect(buildTwitchVodUrl('12345')).toBe('https://www.twitch.tv/videos/12345')
    expect(buildTwitchVodUrl('12345', 90)).toBe('https://www.twitch.tv/videos/12345?t=1m30s')
  })
})

describe('resolvePastVodAnalyticsStatus', () => {
  it('returns synced when chat or viewer samples exist', () => {
    expect(
      resolvePastVodAnalyticsStatus('s1', [{ streamId: 's1', chatMessages: 12 }]),
    ).toBe('synced')
  })

  it('returns stats-only when analytics row has no rollups', () => {
    expect(
      resolvePastVodAnalyticsStatus('s1', [{ streamId: 's1', chatMessages: 0, viewerSamples: 0 }]),
    ).toBe('stats-only')
  })

  it('returns current-live for the active stream id', () => {
    expect(
      resolvePastVodAnalyticsStatus(
        'live',
        [{ streamId: 'live', chatMessages: 5 }],
        'live',
      ),
    ).toBe('current-live')
  })
})

describe('pastVodAnalyticsStatusLabel', () => {
  it('maps known statuses', () => {
    expect(pastVodAnalyticsStatusLabel('synced')).toBe('Synced')
    expect(pastVodAnalyticsStatusLabel('stats-only')).toBe('Stats only')
  })
})

describe('formatPastVodDate', () => {
  it('formats ISO timestamps', () => {
    expect(formatPastVodDate('2026-06-12T18:00:00.000Z')).toMatch(/Jun/)
  })
})

describe('formatPastVodDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatPastVodDuration(252)).toBe('4h 12m')
    expect(formatPastVodDuration(45)).toBe('45m')
  })
})

describe('mergePastVodRows', () => {
  it('merges metadata history with analytics overlap', () => {
    const rows = mergePastVodRows(
      [{
        id: 's1',
        videoId: 'v1',
        title: 'Big stream',
        thumbnailUrl: 'https://thumb/%{width}x%{height}.jpg',
        startedAt: '2026-06-12T10:00:00.000Z',
        durationMinutes: 120,
        avgViewers: 500,
        peakViewers: 900,
      }],
      [{
        streamId: 's1',
        vodId: 'v1',
        chatMessages: 42,
        viewerSamples: 10,
      }],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('Big stream')
    expect(rows[0]?.analyticsStatus).toBe('synced')
    expect(rows[0]?.videoId).toBe('v1')
  })

  it('includes analytics-only rows', () => {
    const rows = mergePastVodRows(
      [],
      [{
        streamId: 's2',
        title: 'Analytics only',
        startedAt: '2026-06-11T10:00:00.000Z',
        chatMessages: 0,
        viewerSamples: 0,
      }],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.streamId).toBe('s2')
    expect(rows[0]?.analyticsStatus).toBe('stats-only')
  })

  it('excludes the current live stream when isLive is true', () => {
    const rows = mergePastVodRows(
      [
        { id: 'live', title: 'Live now', startedAt: '2026-06-12T12:00:00.000Z' },
        { id: 'past', title: 'Earlier', startedAt: '2026-06-11T12:00:00.000Z' },
      ],
      [
        { streamId: 'live', chatMessages: 1 },
        { streamId: 'past', chatMessages: 1 },
      ],
      { liveStreamId: 'live', isLive: true },
    )

    expect(rows.map(row => row.streamId)).toEqual(['past'])
  })

  it('sorts newest streams first', () => {
    const rows = mergePastVodRows(
      [
        { id: 'old', title: 'Old', startedAt: '2026-06-10T10:00:00.000Z' },
        { id: 'new', title: 'New', startedAt: '2026-06-12T10:00:00.000Z' },
      ],
      [],
    )

    expect(rows.map(row => row.streamId)).toEqual(['new', 'old'])
  })
})
