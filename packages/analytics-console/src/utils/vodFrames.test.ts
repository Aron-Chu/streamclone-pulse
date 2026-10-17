import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { configureAnalyticsApi, type AnalyticsApi } from '../configureApi.ts'
import {
  frameBackgroundStyle,
  frameTimingPhrase,
  isAllowedSheetUrl,
  loadVodFrame,
  parseStoryboardThumb,
  peekVodFrame,
  resetVodFrameCache,
  useVodFrame,
  type VodFrame,
} from './vodFrames.ts'

const SHEET = 'https://d2vi6trrdongqn.cloudfront.net/af1cb9b7_xqc_1/storyboards/2899924626-high-0.jpg'
const THUMB = { sheetUrl: SHEET, sheetWidth: 1600, sheetHeight: 900, cropX: 320, cropY: 180, cropW: 160, cropH: 90 }

function configure(getVodStoryboardThumb: AnalyticsApi['getVodStoryboardThumb']) {
  configureAnalyticsApi({ getVodStoryboardThumb } as unknown as AnalyticsApi)
}

beforeEach(() => resetVodFrameCache())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('isAllowedSheetUrl', () => {
  it('allows https cloudfront sheets only', () => {
    expect(isAllowedSheetUrl(SHEET)).toBe(true)
    expect(isAllowedSheetUrl('http://d2vi6trrdongqn.cloudfront.net/a.jpg')).toBe(false)
    expect(isAllowedSheetUrl('https://static-cdn.jtvnw.net/cf_vods/a.jpg')).toBe(false)
    expect(isAllowedSheetUrl('https://evil.example/cloudfront.net/a.jpg')).toBe(false)
    expect(isAllowedSheetUrl('https://cloudfront.net.evil.example/a.jpg')).toBe(false)
    expect(isAllowedSheetUrl(42)).toBe(false)
  })

  it('refuses characters that could escape a CSS url()', () => {
    for (const bad of ['"', "'", '(', ')', '\\', ' ', '\n']) {
      expect(isAllowedSheetUrl(`https://d1.cloudfront.net/a${bad}b.jpg`)).toBe(false)
    }
  })
})

describe('parseStoryboardThumb', () => {
  it('reads the backend thumb shape', () => {
    expect(parseStoryboardThumb(THUMB)).toEqual({ frame: { ...THUMB, fromSec: null }, reason: null })
  })

  it('reads a wrapped body and the tile start when given', () => {
    expect(parseStoryboardThumb({ data: { ...THUMB, fromSec: 3030 } }).frame?.fromSec).toBe(3030)
    expect(parseStoryboardThumb({ ...THUMB, frameIndex: 30, intervalMilliseconds: 101000 }).frame?.fromSec).toBe(3030)
  })

  it('keeps the tile interval when given, for scrubbing; a missing or absurd one is left out', () => {
    expect(parseStoryboardThumb({ ...THUMB, frameIndex: 12, intervalMilliseconds: 249000 }).frame?.intervalSec).toBe(249)
    expect(parseStoryboardThumb(THUMB).frame).not.toHaveProperty('intervalSec')
    expect(parseStoryboardThumb({ ...THUMB, intervalMilliseconds: 5 }).frame).not.toHaveProperty('intervalSec')
    expect(parseStoryboardThumb({ ...THUMB, intervalMilliseconds: 'x' }).frame).not.toHaveProperty('intervalSec')
  })

  it('maps reasons and recording states to a miss', () => {
    expect(parseStoryboardThumb({ reason: 'no_storyboard' })).toEqual({ frame: null, reason: 'no_storyboard' })
    expect(parseStoryboardThumb({ reason: 'offset_out_of_range' }).reason).toBe('out_of_range')
    expect(parseStoryboardThumb({ status: 'RECORDING' }).reason).toBe('recording')
    expect(parseStoryboardThumb({ statusCode: 403 }).reason).toBe('recording')
  })

  it('treats null, junk, a foreign host and impossible crops as unavailable', () => {
    for (const raw of [
      null,
      undefined,
      'x',
      [],
      {},
      { ...THUMB, sheetUrl: 'https://example.com/a.jpg' },
      { ...THUMB, cropW: 0 },
      { ...THUMB, cropX: -1 },
      { ...THUMB, cropX: 1500 },
      { ...THUMB, sheetWidth: 'wide' },
      { ...THUMB, cropW: Number.NaN },
    ]) {
      expect(parseStoryboardThumb(raw).reason).toBe('unavailable')
    }
  })
})

describe('frameBackgroundStyle', () => {
  it('crops the tile with percentage size and position', () => {
    const frame = parseStoryboardThumb(THUMB).frame as VodFrame
    expect(frameBackgroundStyle(frame)).toEqual({
      backgroundImage: `url("${SHEET}")`,
      backgroundSize: '1000.0000% 1000.0000%',
      // col 2 of 10, row 2 of 10: 2/9 of the way across and down
      backgroundPosition: '22.2222% 22.2222%',
      backgroundRepeat: 'no-repeat',
    })
  })

  it('pins a one-tile sheet at 0%', () => {
    const style = frameBackgroundStyle({ ...THUMB, sheetWidth: 160, sheetHeight: 90, cropX: 0, cropY: 0, fromSec: null })
    expect(style.backgroundPosition).toBe('0.0000% 0.0000%')
    expect(style.backgroundSize).toBe('100.0000% 100.0000%')
  })
})

describe('frameTimingPhrase', () => {
  const frame = { ...THUMB, fromSec: 3000 }
  it("says how far the tile sits from the subject's start", () => {
    expect(frameTimingPhrase(frame, 3054, 'minute')).toBe('from about 54 s before this minute')
    expect(frameTimingPhrase(frame, 2980, 'bar')).toBe('from about 20 s into this bar')
    expect(frameTimingPhrase(frame, 3001, 'bar')).toBe('from the start of this bar')
    expect(frameTimingPhrase(frame, 3001, 'moment')).toBe("from the moment's start")
    expect(frameTimingPhrase(frame, 3054, 'moment')).toBe('from about 54 s before the moment')
  })

  it('says nothing when the tile start is unknown', () => {
    expect(frameTimingPhrase({ ...frame, fromSec: null }, 3054, 'minute')).toBeNull()
    expect(frameTimingPhrase(frame, null, 'minute')).toBeNull()
  })
})

describe('loadVodFrame', () => {
  it('asks once per VOD and offset, and caches', async () => {
    const get = vi.fn(async () => THUMB)
    configure(get)
    const [a, b] = await Promise.all([loadVodFrame('2899924626', 3054.6), loadVodFrame('2899924626', 3054)])
    expect(a.frame?.sheetUrl).toBe(SHEET)
    expect(b).toBe(a)
    await loadVodFrame('2899924626', 3054)
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('2899924626', 3054)
    expect(peekVodFrame('2899924626', 3054)?.frame?.sheetUrl).toBe(SHEET)
  })

  it('remembers a VOD with no storyboard', async () => {
    const get = vi.fn(async () => ({ reason: 'no_storyboard' }))
    configure(get)
    expect((await loadVodFrame('2899924626', 10)).reason).toBe('no_storyboard')
    expect((await loadVodFrame('2899924626', 500)).reason).toBe('no_storyboard')
    expect(get).toHaveBeenCalledTimes(1)
  })

  it("other offsets of a VOD wait for its first answer: a VOD with no storyboard costs one request", async () => {
    const get = vi.fn(async () => ({ reason: 'no_storyboard' }))
    configure(get)
    const results = await Promise.all([10, 700, 1400].map((offset) => loadVodFrame('2899924626', offset)))
    expect(results.map((r) => r.reason)).toEqual(['no_storyboard', 'no_storyboard', 'no_storyboard'])
    expect(get).toHaveBeenCalledTimes(1)
    // once the VOD has answered with frames, offsets load side by side
    resetVodFrameCache()
    const frames = vi.fn(async () => THUMB)
    configure(frames)
    await loadVodFrame('2899924626', 10)
    await Promise.all([700, 1400].map((offset) => loadVodFrame('2899924626', offset)))
    expect(frames).toHaveBeenCalledTimes(3)
  })

  it('never throws: a failed request or the null stub is unavailable, a 403 is recording', async () => {
    configure(async () => {
      throw Object.assign(new Error('forbidden'), { status: 403 })
    })
    expect((await loadVodFrame('2899924626', 10)).reason).toBe('recording')
    resetVodFrameCache()
    configure(async () => {
      throw new Error('network')
    })
    expect((await loadVodFrame('2899924626', 10)).reason).toBe('unavailable')
    resetVodFrameCache()
    configure(async () => null)
    expect((await loadVodFrame('2899924626', 10)).reason).toBe('unavailable')
  })

  it('refuses a malformed VOD id or offset without a request', async () => {
    const get = vi.fn(async () => THUMB)
    configure(get)
    expect((await loadVodFrame('v123', 10)).reason).toBe('unavailable')
    expect((await loadVodFrame('2899924626', -1)).reason).toBe('unavailable')
    expect(get).not.toHaveBeenCalled()
  })
})

describe('useVodFrame', () => {
  it('loads the frame and reports loading first', async () => {
    let resolve: (value: unknown) => void = () => {}
    configure(() => new Promise((r) => { resolve = r }))
    const { result } = renderHook(() => useVodFrame('2899924626', 3054))
    expect(result.current).toEqual({ loading: true, result: null })
    await act(async () => resolve(THUMB))
    await waitFor(() => expect(result.current.result?.frame?.sheetUrl).toBe(SHEET))
    expect(result.current.loading).toBe(false)
  })

  it('loads nothing without a VOD or an offset', () => {
    const get = vi.fn(async () => THUMB)
    configure(get)
    const { result } = renderHook(() => useVodFrame(null, 3054))
    expect(result.current).toEqual({ loading: false, result: null })
    renderHook(() => useVodFrame('2899924626', null))
    expect(get).not.toHaveBeenCalled()
  })
})
