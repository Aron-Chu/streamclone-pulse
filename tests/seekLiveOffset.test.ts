import { describe, expect, it } from 'vitest'
import {
  isSeekable,
  seekLiveOffset,
  seekableLiveEdge,
  streamOffsetSecondsForLiveSeek,
} from '../src/content/twitch.ts'

function fakeRanges(ranges: Array<[number, number]>): TimeRanges {
  return {
    length: ranges.length,
    start: (index: number) => ranges[index]![0],
    end: (index: number) => ranges[index]![1],
  } as TimeRanges
}

function fakeVideo(seekable: TimeRanges, currentTime = 0): HTMLVideoElement {
  const video = {
    currentTime,
    seekable,
  } as HTMLVideoElement
  return video
}

describe('seekableLiveEdge', () => {
  it('uses the final seekable range end', () => {
    expect(seekableLiveEdge(fakeRanges([[0, 10], [20, 120]]))).toBe(120)
  })
})

describe('seekLiveOffset', () => {
  it('seeks from the seekable live edge, not video.currentTime', () => {
    // Delayed viewer: currentTime is mid-buffer while live edge is far ahead.
    const video = fakeVideo(fakeRanges([[0, 600]]), 120)
    const result = seekLiveOffset(video, 300, 600)
    expect(result).toEqual({ ok: true, targetSeconds: 300 })
    expect(video.currentTime).toBe(300)
  })

  it('handles multiple seekable ranges by using the last end', () => {
    const video = fakeVideo(fakeRanges([[0, 30], [40, 500]]), 450)
    const result = seekLiveOffset(video, 200, 500)
    expect(result).toEqual({ ok: true, targetSeconds: 200 })
  })

  it('rejects targets that fall in a buffer gap', () => {
    const video = fakeVideo(fakeRanges([[0, 50], [100, 200]]), 180)
    const result = seekLiveOffset(video, 70, 200)
    expect(result).toEqual({ ok: false, reason: 'outside_buffer' })
  })

  it('rejects when the moment is outside the DVR window', () => {
    const video = fakeVideo(fakeRanges([[300, 600]]), 600)
    const result = seekLiveOffset(video, 60, 600)
    expect(result).toEqual({ ok: false, reason: 'outside_buffer' })
  })
})

describe('isSeekable', () => {
  it('accepts inclusive range ends', () => {
    expect(isSeekable(fakeRanges([[10, 20]]), 20)).toBe(true)
    expect(isSeekable(fakeRanges([[10, 20]]), 9)).toBe(false)
  })
})

describe('streamOffsetSecondsForLiveSeek', () => {
  it('derives offset from startedAt', () => {
    expect(
      streamOffsetSecondsForLiveSeek({
        startedAt: '2026-01-01T00:00:00.000Z',
        nowMs: Date.parse('2026-01-01T01:00:00.000Z'),
      }),
    ).toBe(3600)
  })

  it('uses bounded payload fallback when close to wall clock', () => {
    expect(
      streamOffsetSecondsForLiveSeek({
        startedAt: '2026-01-01T00:00:00.000Z',
        payloadOffsetSeconds: 3590,
        nowMs: Date.parse('2026-01-01T01:00:00.000Z'),
      }),
    ).toBe(3590)
  })

  it('falls back to payload when startedAt is invalid', () => {
    expect(
      streamOffsetSecondsForLiveSeek({
        startedAt: 'not-a-date',
        payloadOffsetSeconds: 1200,
      }),
    ).toBe(1200)
  })
})
