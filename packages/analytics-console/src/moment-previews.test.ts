import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import {
  CLIP_READS_AT_ONCE,
  NEARBY_CLIP_WINDOW_SECONDS,
  configureMomentClipsReader,
  configureVodStoryboardReader,
  loadMomentClips,
  matchNearbyClip,
  momentClipRange,
  momentMiddleVodSecond,
  parseMomentClips,
  peekMomentClips,
  pickMomentPreview,
  resetMomentClipCache,
  useMomentPreview,
  type MomentClip,
  type NearbyClip,
  type VodFrame,
} from './moment-previews.ts'
import { resetVodFrameCache } from './utils/vodFrames.ts'

const VOD = '100000001'
const OTHER_VOD = '100000002'
const THUMB = 'https://static-cdn.jtvnw.net/twitch-clips-thumbnails-prod/fakechan01/preview-480x272.jpg'

function clip(over: Partial<MomentClip> = {}): MomentClip {
  return {
    id: 'FakeClipOne',
    url: 'https://clips.twitch.tv/FakeClipOne',
    title: 'fake clip',
    thumbnailUrl: THUMB,
    videoId: VOD,
    vodOffsetSeconds: 1000,
    durationSeconds: 30,
    viewCount: 10,
    ...over,
  }
}

const RANGE = { startMs: Date.UTC(2026, 10, 1, 10), endMs: Date.UTC(2026, 10, 1, 16) }

beforeEach(() => {
  resetMomentClipCache()
  resetVodFrameCache()
  configureMomentClipsReader(null)
  configureVodStoryboardReader(null)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  configureMomentClipsReader(null)
  configureVodStoryboardReader(null)
})

describe('matchNearbyClip', () => {
  // the clip's middle is 1015 s on the VOD clock
  it('matches a clip from the same VOD inside the window', () => {
    const found = matchNearbyClip([clip()], { vodId: VOD, vodSecond: 1015 + NEARBY_CLIP_WINDOW_SECONDS })
    expect(found?.id).toBe('FakeClipOne')
    expect(found?.distanceSeconds).toBe(NEARBY_CLIP_WINDOW_SECONDS)
  })

  it('never matches a clip from another VOD, however close', () => {
    expect(matchNearbyClip([clip({ videoId: OTHER_VOD })], { vodId: VOD, vodSecond: 1015 })).toBeNull()
  })

  it('never matches a clip outside the window', () => {
    expect(matchNearbyClip([clip()], { vodId: VOD, vodSecond: 1015 + NEARBY_CLIP_WINDOW_SECONDS + 1 })).toBeNull()
    expect(matchNearbyClip([clip()], { vodId: VOD, vodSecond: 1015 - NEARBY_CLIP_WINDOW_SECONDS - 1 })).toBeNull()
  })

  it('needs a VOD and a second on its clock', () => {
    expect(matchNearbyClip([clip()], { vodId: null, vodSecond: 1015 })).toBeNull()
    expect(matchNearbyClip([clip()], { vodId: VOD, vodSecond: null })).toBeNull()
    expect(momentMiddleVodSecond(600, null)).toBeNull()
    expect(momentMiddleVodSecond(600, 12)).toBe(642)
  })

  it('takes the nearest clip, then the most watched', () => {
    const near = clip({ id: 'Near', vodOffsetSeconds: 990 })
    const far = clip({ id: 'Far', vodOffsetSeconds: 1020 })
    expect(matchNearbyClip([far, near], { vodId: VOD, vodSecond: 1005 })?.id).toBe('Near')
    const tieA = clip({ id: 'TieA', viewCount: 5 })
    const tieB = clip({ id: 'TieB', viewCount: 50 })
    expect(matchNearbyClip([tieA, tieB], { vodId: VOD, vodSecond: 1015 })?.id).toBe('TieB')
  })
})

describe('parseMomentClips', () => {
  it('keeps only rows with a VOD, an offset and Twitch links', () => {
    const rows = parseMomentClips({
      items: [
        { id: 'Good', url: 'https://clips.twitch.tv/Good', thumbnailUrl: THUMB, videoId: VOD, vodOffsetSeconds: 12, durationSeconds: 20, viewCount: 3 },
        { id: 'NoVod', url: 'https://clips.twitch.tv/NoVod', thumbnailUrl: THUMB, videoId: '', vodOffsetSeconds: 12 },
        { id: 'NoOffset', url: 'https://clips.twitch.tv/NoOffset', thumbnailUrl: THUMB, videoId: VOD, vodOffsetSeconds: null },
        { id: 'BadPic', url: 'https://clips.twitch.tv/BadPic', thumbnailUrl: 'https://example.com/a.jpg', videoId: VOD, vodOffsetSeconds: 12 },
        { id: 'BadLink', url: 'javascript:alert(1)', thumbnailUrl: THUMB, videoId: VOD, vodOffsetSeconds: 12 },
      ],
    })
    expect(rows.map((row) => row.id)).toEqual(['Good'])
    expect(parseMomentClips(null)).toEqual([])
    expect(parseMomentClips({ items: 'nope' })).toEqual([])
  })
})

describe('pickMomentPreview', () => {
  const frame = { sheetUrl: 'https://d2vi6trrdongqn.cloudfront.net/fake/storyboards/1-high-0.jpg' } as unknown as VodFrame
  const nearby: NearbyClip = { ...clip(), distanceSeconds: 4 }
  const all = { frame, clip: nearby, broadcastUrl: 'https://static-cdn.jtvnw.net/cf_vods/x/thumb/thumb0-320x180.jpg', gameArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/1-76x100.jpg', gameName: 'Fake Game' }

  it('goes stream frame, nearby clip, VOD thumbnail, game art, then none', () => {
    expect(pickMomentPreview(all).kind).toBe('frame')
    expect(pickMomentPreview({ ...all, frame: null }).kind).toBe('clip')
    expect(pickMomentPreview({ ...all, frame: null, clip: null }).kind).toBe('broadcast')
    expect(pickMomentPreview({ ...all, frame: null, clip: null, broadcastUrl: null })).toMatchObject({ kind: 'game', label: 'Game art', gameName: 'Fake Game' })
    expect(pickMomentPreview({})).toMatchObject({ kind: 'none', label: 'No picture of this moment yet' })
  })

  it('labels every picture', () => {
    expect(pickMomentPreview(all).label).toBe('Stream frame')
    expect(pickMomentPreview({ ...all, frame: null }).label).toBe('Nearby clip')
  })

  it('falls through a picture that failed to load', () => {
    const failed = new Set([nearby.thumbnailUrl, all.broadcastUrl])
    expect(pickMomentPreview({ ...all, frame: null, failed }).kind).toBe('game')
    expect(pickMomentPreview({ ...all, frame: null, failed: new Set([...failed, all.gameArtUrl]) }).kind).toBe('none')
  })
})

describe('loadMomentClips', () => {
  it('reads once per channel, joining the ranges asked for together', async () => {
    const reader = vi.fn(async () => ({ items: [{ ...clip(), id: 'Joined' }] }))
    configureMomentClipsReader(reader)
    const later = { startMs: RANGE.startMs + 3_600_000, endMs: RANGE.endMs + 3_600_000 }
    const [a, b, c] = await Promise.all([
      loadMomentClips('fakechan01', RANGE),
      loadMomentClips('FakeChan01', later),
      loadMomentClips('fakechan01', RANGE),
    ])
    expect(reader).toHaveBeenCalledTimes(1)
    expect(reader).toHaveBeenCalledWith('fakechan01', new Date(RANGE.startMs).toISOString(), new Date(later.endMs).toISOString())
    expect(a).toBe(b)
    expect(b).toBe(c)
    // a later row on the same page view reuses the answer
    await loadMomentClips('fakechan01', { startMs: RANGE.startMs - 1, endMs: RANGE.endMs })
    expect(reader).toHaveBeenCalledTimes(1)
    expect(peekMomentClips('fakechan01')?.[0]?.id).toBe('Joined')
  })

  it('fails quietly, once', async () => {
    const reader = vi.fn(async () => { throw new Error('down') })
    configureMomentClipsReader(reader)
    await expect(loadMomentClips('fakechan02', RANGE)).resolves.toEqual([])
    await expect(loadMomentClips('fakechan02', RANGE)).resolves.toEqual([])
    expect(reader).toHaveBeenCalledTimes(1)
  })

  it(`keeps at most ${CLIP_READS_AT_ONCE} reads out at once`, async () => {
    let out = 0
    let most = 0
    const reader = vi.fn(async () => {
      out += 1
      most = Math.max(most, out)
      await new Promise((resolve) => setTimeout(resolve, 20))
      out -= 1
      return { items: [] }
    })
    configureMomentClipsReader(reader)
    await Promise.all(['fakechan01', 'fakechan02', 'fakechan03', 'fakechan04', 'fakechan05'].map((login) => loadMomentClips(login, RANGE)))
    expect(reader).toHaveBeenCalledTimes(5)
    expect(most).toBe(CLIP_READS_AT_ONCE)
  })

  it('asks for nothing with a bad login or range', async () => {
    const reader = vi.fn(async () => ({ items: [] }))
    configureMomentClipsReader(reader)
    await loadMomentClips('not a login', RANGE)
    await loadMomentClips('fakechan01', { startMs: 10, endMs: 5 })
    expect(reader).not.toHaveBeenCalled()
  })
})

describe('momentClipRange', () => {
  it('runs from 2 min before to 6 h after, never past the next whole minute', () => {
    const at = Date.UTC(2026, 10, 1, 10)
    expect(momentClipRange(at, at + 24 * 3_600_000)).toEqual({ startMs: at - 120_000, endMs: at + 6 * 3_600_000 })
    expect(momentClipRange(at, at + 30_000)).toEqual({ startMs: at - 120_000, endMs: at + 60_000 })
    expect(momentClipRange(null)).toBeNull()
  })
})

describe('useMomentPreview', () => {
  const args = {
    login: 'fakechan01',
    vodId: VOD,
    vodSecond: 1015,
    clipRange: RANGE,
    gameArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/1-76x100.jpg',
    gameName: 'Fake Game',
  }

  it('asks for nothing until enabled, then shows a nearby clip when there is no frame', async () => {
    const clips = vi.fn(async () => ({ items: [clip()] }))
    const frames = vi.fn(async () => ({ reason: 'no_storyboard' }))
    configureMomentClipsReader(clips)
    configureVodStoryboardReader(frames)
    const { result, rerender } = renderHook((enabled: boolean) => useMomentPreview({ ...args, enabled }), { initialProps: false })
    expect(result.current.preview.kind).toBe('game')
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(clips).not.toHaveBeenCalled()
    expect(frames).not.toHaveBeenCalled()
    rerender(true)
    await waitFor(() => expect(result.current.preview.kind).toBe('clip'))
    expect(clips).toHaveBeenCalledTimes(1)
    expect(result.current.loading).toBe(false)
  })

  it('shares one clips read between rows of one channel', async () => {
    const clips = vi.fn(async () => ({ items: [clip()] }))
    configureMomentClipsReader(clips)
    configureVodStoryboardReader(async () => ({ reason: 'no_storyboard' }))
    const one = renderHook(() => useMomentPreview({ ...args, enabled: true }))
    const two = renderHook(() => useMomentPreview({ ...args, vodSecond: 4000, enabled: true }))
    await waitFor(() => expect(one.result.current.preview.kind).toBe('clip'))
    // the second row's moment is far from the clip: it falls through to game art
    await waitFor(() => expect(two.result.current.loading).toBe(false))
    expect(two.result.current.preview.kind).toBe('game')
    expect(clips).toHaveBeenCalledTimes(1)
  })
})
