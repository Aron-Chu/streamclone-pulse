/**
 * PIC-4 (candidate, 10-30): the "Live now" tile. The login is the live stream's in the saved 2026-10-30 answers
 * (316655688306, yuyuta0702). No live call: the URL is only built and checked.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIVE_NOW_LABEL, LIVE_NOW_REFRESH_MS, LIVE_NOW_STALE_MS, LiveNowTile, liveNowPreviewUrl } from './LiveNowTile.tsx'

const LOGIN = 'yuyuta0702'
// 2026-10-30T07:19:00Z, the saved answers' time
const T0 = Date.parse('2026-10-30T07:19:00Z')
// the newest measured minute a minute before: a feed that is still coming in
const FRESH = T0 - 60_000

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const img = () => document.querySelector<HTMLImageElement>('[data-live-now] img')

describe('liveNowPreviewUrl', () => {
  it("is Twitch's live picture at 640x360 with a 5-minute bucket", () => {
    const url = liveNowPreviewUrl(LOGIN, T0)
    expect(url).toBe('https://static-cdn.jtvnw.net/previews-ttv/live_user_yuyuta0702-640x360.jpg?t=5977815')
    // the same bucket for the whole 5 minutes, the next one after
    const start = Math.floor(T0 / 300_000) * 300_000
    expect(liveNowPreviewUrl(LOGIN, start + 299_999)).toBe(liveNowPreviewUrl(LOGIN, start))
    expect(liveNowPreviewUrl(LOGIN, start + 300_000)).not.toBe(liveNowPreviewUrl(LOGIN, start))
  })

  it('lowercases the login and refuses one Twitch cannot have', () => {
    expect(liveNowPreviewUrl(' YuYuta0702 ', T0)).toBe(liveNowPreviewUrl(LOGIN, T0))
    for (const bad of ['', 'a b', '../x', 'x?y=1', 'a'.repeat(26), 'name.with.dots']) {
      expect(liveNowPreviewUrl(bad, T0)).toBeNull()
    }
    expect(liveNowPreviewUrl(LOGIN, Number.NaN)).toBeNull()
  })
})

describe('LiveNowTile', () => {
  it('says Live now and that the picture is Twitch\'s and can be a few minutes old', () => {
    render(<LiveNowTile login={LOGIN} lastMinuteMs={FRESH} now={() => T0} />)
    const tile = document.querySelector('[data-live-now]')!
    expect(tile.querySelector('figcaption')?.textContent).toBe(`Live now · , ${LIVE_NOW_LABEL}`)
    expect(LIVE_NOW_LABEL).toBe("Twitch's picture, can be a few minutes old")
    expect(img()?.getAttribute('src')).toBe(liveNowPreviewUrl(LOGIN, T0))
    expect(img()?.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('asks again every 5 minutes', () => {
    vi.useFakeTimers()
    let clock = T0
    render(<LiveNowTile login={LOGIN} lastMinuteMs={FRESH} now={() => clock} />)
    const first = img()?.getAttribute('src')
    clock += LIVE_NOW_REFRESH_MS
    act(() => {
      vi.advanceTimersByTime(LIVE_NOW_REFRESH_MS)
    })
    expect(img()?.getAttribute('src')).toBe(liveNowPreviewUrl(LOGIN, clock))
    expect(img()?.getAttribute('src')).not.toBe(first)
  })

  it('hides on a failed load and tries again with the next picture', () => {
    vi.useFakeTimers()
    let clock = T0
    render(<LiveNowTile login={LOGIN} lastMinuteMs={FRESH} now={() => clock} />)
    fireEvent.error(img()!)
    expect(document.querySelector('[data-live-now]')).toBeNull()
    clock += LIVE_NOW_REFRESH_MS
    act(() => {
      vi.advanceTimersByTime(LIVE_NOW_REFRESH_MS)
    })
    expect(img()?.getAttribute('src')).toBe(liveNowPreviewUrl(LOGIN, clock))
  })

  it('draws nothing for a login Twitch cannot have', () => {
    render(<LiveNowTile login="not a login" lastMinuteMs={FRESH} now={() => T0} />)
    expect(document.querySelector('[data-live-now]')).toBeNull()
  })

  it('draws nothing without a measured minute, or when the newest is over 10 minutes old', () => {
    render(<LiveNowTile login={LOGIN} lastMinuteMs={null} now={() => T0} />)
    expect(document.querySelector('[data-live-now]')).toBeNull()
    cleanup()
    render(<LiveNowTile login={LOGIN} lastMinuteMs={T0 - LIVE_NOW_STALE_MS - 1} now={() => T0} />)
    expect(document.querySelector('[data-live-now]')).toBeNull()
  })

  it('goes away on its 5-minute tick once the minutes stop coming (the stream ended while the page stayed open)', () => {
    vi.useFakeTimers()
    let clock = T0
    render(<LiveNowTile login={LOGIN} lastMinuteMs={FRESH} now={() => clock} />)
    expect(img()).not.toBeNull()
    clock += 2 * LIVE_NOW_REFRESH_MS
    act(() => {
      vi.advanceTimersByTime(2 * LIVE_NOW_REFRESH_MS)
    })
    expect(document.querySelector('[data-live-now]')).toBeNull()
  })
})
