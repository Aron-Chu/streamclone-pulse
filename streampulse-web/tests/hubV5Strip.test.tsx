/**
 * The hub's strips (Busiest now, Your follows) when a read re-ranks the tiles (11-01). The tiles move within the
 * list, and the browser's snapping follows the tile it had snapped, which would slide a strip on 1–5 to wherever
 * the old first tile went. jsdom has no layout, so the track below snaps the way Chrome does: to one tile, which
 * it follows when the list changes.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HubLiveChannel } from '../src/lib/publicHub'
import { HubV5Busiest } from '../src/ui/components/hub/v5/HubV5Busiest'

const MIN = 60_000
const END = Date.UTC(2026, 10, 1, 18, 0)
/** One tile and its gap. */
const STEP = 200

function chan(login: string, rate: number): HubLiveChannel {
  return {
    login,
    displayName: login.toUpperCase(),
    category: 'Just Chatting',
    streamId: `s-${login}`,
    viewers: 1_000,
    chatPerMin: 0,
    seventvPerMin: 0,
    coverageState: 'synced',
    trendPct: 0,
    screenerV1: {
      version: 1,
      measuredAt: END,
      baselineKind: 'current_stream_measured_average',
      state: 'ready',
      currentWindow: { start: END - 5 * MIN, end: END, expectedMinutes: 5, measuredMinutes: 5, coveragePct: 100 },
      baselineWindow: null,
      baselineMeasuredMinutes: 40,
      evidence: null,
      chat: { state: 'ready', currentPerMin: rate, baselinePerMin: rate, multiplier: 1, baselineMeasuredMinutes: 40 },
      emotes: null,
    },
  } as HubLiveChannel
}

/** Channels a, b, c… at these rates. */
const pool = (...rates: number[]) => rates.map((rate, i) => chan('abcdefghijkl'[i]!, rate))

function strip(live: HubLiveChannel[]) {
  const page = (next: HubLiveChannel[]) => (
    <MemoryRouter>
      <HubV5Busiest live={next} nowMs={END + MIN} />
    </MemoryRouter>
  )
  const view = render(page(live))
  const track = document.getElementById('hv5-busy-track')!
  // Chrome's snapping: the offset is the snapped tile's place, and that tile is followed when the list changes.
  let snapped: Element | null = track.children[0] ?? null
  Object.defineProperty(track, 'scrollLeft', {
    configurable: true,
    get: () => (snapped ? Math.max(0, [...track.children].indexOf(snapped)) : 0) * STEP,
    set: (left: number) => { snapped = track.children[Math.round(left / STEP)] ?? null },
  })
  const order = () => [...track.children].map((li) => li.getAttribute('data-login')).join('')
  return { track, order, again: (next: HubLiveChannel[]) => view.rerender(page(next)) }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

describe('a re-ranked strip', () => {
  it('stays on the first ranks, showing the new leaders', () => {
    const { track, order, again } = strip(pool(60, 50, 40, 30, 20, 10))
    again(pool(40, 50, 60, 30, 20, 10))
    expect(order()).toBe('cbadef')
    expect(track.scrollLeft).toBe(0)
  })

  it('stays on the ranks the reader paged to', () => {
    const { track, order, again } = strip(pool(60, 50, 40, 30, 20, 10))
    track.scrollLeft = 2 * STEP
    fireEvent.scroll(track)
    fireEvent(track, new Event('scrollend'))
    again(pool(50, 40, 60, 30, 20, 10))
    expect(order()).toBe('cabdef')
    expect(track.scrollLeft).toBe(2 * STEP)
  })

  it('leaves a strip that is still moving to the browser', () => {
    const { track, again } = strip(pool(60, 50, 40, 30, 20, 10))
    track.scrollLeft = 2 * STEP
    fireEvent.scroll(track)
    again(pool(50, 40, 60, 30, 20, 10))
    expect(track.scrollLeft).toBe(0)
  })

  it('keeps a focused tile in view and its tab stop, moving the strip but never the page', () => {
    // jsdom has no scrollIntoView: it would scroll the page too, back up to a strip the reader has scrolled past
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    // 12 tiles of STEP, 6 whole ones in view (the track's default --per)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const width = this.classList.contains('hv5-bzc-it') ? STEP : 0
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) } as DOMRect
    })
    const { track, again } = strip(pool(120, 110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10))
    Object.defineProperty(track, 'clientWidth', { configurable: true, get: () => 6.5 * STEP })
    Object.defineProperty(track, 'scrollWidth', { configurable: true, get: () => 12 * STEP })
    const a = track.querySelector<HTMLAnchorElement>('[data-login="a"] a')!
    a.focus()
    // a falls to tenth: the strip stays on 1–6, then moves just far enough to show a as its last whole tile
    again(pool(25, 110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10))
    expect(document.activeElement).toBe(a)
    expect([...track.children].indexOf(a.closest('li')!)).toBe(9)
    expect(track.scrollLeft).toBe(4 * STEP)
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(a.getAttribute('tabindex')).toBe('0')
    expect(track.querySelector('[data-login="b"] a')!.getAttribute('tabindex')).toBe('-1')
    // the reader's place is now 5–10; a climbs back to first, and the strip comes back to show it
    fireEvent.scroll(track)
    fireEvent(track, new Event('scrollend'))
    again(pool(115, 110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10))
    expect([...track.children].indexOf(a.closest('li')!)).toBe(0)
    expect(track.scrollLeft).toBe(0)
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(a)
  })
})
