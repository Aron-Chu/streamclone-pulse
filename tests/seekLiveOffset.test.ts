import { describe, expect, it } from 'vitest'
import {
  isSeekable,
  resolveLiveMediaEdge,
  resolvePrimaryVideo,
  seekLiveOffset,
  seekPlaybackOffsetVerified,
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

function fakeVideo(seekable: TimeRanges, currentTime = 0, buffered: TimeRanges = fakeRanges([])): HTMLVideoElement {
  const video = {
    currentTime,
    buffered,
    seekable,
  } as HTMLVideoElement
  return video
}

function primaryVideoFixture(input: {
  label?: string
  readyState?: number
  width?: number
  height?: number
  seekable?: TimeRanges
  buffered?: TimeRanges
  currentTime?: number
}): HTMLVideoElement {
  return {
    currentTime: input.currentTime ?? 0,
    readyState: input.readyState ?? 0,
    seekable: input.seekable ?? fakeRanges([]),
    buffered: input.buffered ?? fakeRanges([]),
    getAttribute: (name: string) => name === 'aria-label' ? input.label ?? null : null,
    closest: () => null,
    getBoundingClientRect: () => ({ width: input.width ?? 0, height: input.height ?? 0 } as DOMRect),
  } as unknown as HTMLVideoElement
}

describe('seekableLiveEdge', () => {
  it('uses the final seekable range end', () => {
    expect(seekableLiveEdge(fakeRanges([[0, 10], [20, 120]]))).toBe(120)
  })
})

describe('seekLiveOffset', () => {
  it('ignores Twitch’s synthetic giant seekable endpoint', () => {
    const video = fakeVideo(
      fakeRanges([[0, 1_073_741_824]]),
      1_301,
      fakeRanges([[1_270, 1_304]]),
    )
    const result = seekLiveOffset(video, 1_080, 2_045)

    expect(result).toEqual({ ok: true, targetSeconds: 339 })
    expect(video.currentTime).toBe(339)
  })

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

describe('resolveLiveMediaEdge', () => {
  it('prefers a plausible seekable edge over the buffered edge', () => {
    expect(resolveLiveMediaEdge(
      fakeVideo(fakeRanges([[0, 2_100]]), 2_000, fakeRanges([[1_990, 2_010]])),
      2_100,
    )).toBe(2_100)
  })

  it('falls back to buffered media when the seekable edge is a sentinel', () => {
    expect(resolveLiveMediaEdge(
      fakeVideo(fakeRanges([[0, 1_073_741_824]]), 1_301, fakeRanges([[1_270, 1_304]])),
      2_045,
    )).toBe(1_304)
  })
})

describe('resolvePrimaryVideo', () => {
  it('chooses the ready Twitch player over an unready secondary video', () => {
    const secondary = primaryVideoFixture({ width: 340, height: 190, readyState: 0, currentTime: 0 })
    const player = primaryVideoFixture({
      label: 'Twitch video player',
      width: 2_400,
      height: 1_300,
      readyState: 4,
      currentTime: 1_301,
      seekable: fakeRanges([[0, 1_073_741_824]]),
      buffered: fakeRanges([[1_270, 1_304]]),
    })

    expect(resolvePrimaryVideo([secondary, player])).toBe(player)
  })
})

describe('seekPlaybackOffsetVerified', () => {
  it('returns success only after the player holds the requested target', async () => {
    const video = fakeVideo(fakeRanges([]))

    await expect(
      seekPlaybackOffsetVerified(video, 24, { timeoutMs: 600 }),
    ).resolves.toEqual({ ok: true, targetSeconds: 24 })
  })

  it('reports a rejected target when Twitch restores the old position', async () => {
    let currentTime = 8
    const video = fakeVideo(fakeRanges([]), currentTime)
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: () => undefined,
    })

    await expect(
      seekPlaybackOffsetVerified(video, 24, { timeoutMs: 600 }),
    ).resolves.toEqual({ ok: false, reason: 'seek_rejected' })
    expect(currentTime).toBe(8)
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
