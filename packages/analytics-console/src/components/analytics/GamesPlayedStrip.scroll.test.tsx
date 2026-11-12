// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChartGameSegment } from '@streampulse/pulse-charts'
import { GamesPlayedStrip } from './GamesPlayedStrip.tsx'

afterEach(() => cleanup())

const NAMES = ['Chess', 'Golf', 'Doom', 'Tetris', 'Grand Theft Auto V', 'Hades', 'Celeste', 'Portal']
const games: ChartGameSegment[] = NAMES.map((gameName, index) => ({
  gameName,
  offsetSeconds: index * 600,
  durationSeconds: 600,
}))

// jsdom has no layout: give the rail a viewport and a scroll position, and each
// poster a box that moves with it. The rail starts 10 px from the page's left.
function layOut(track: HTMLElement, clientWidth: number, widths: number[] = []) {
  const RAIL_LEFT = 10
  const GAP = 8
  const PAD = 2
  let scrollLeft = 0
  let x = PAD
  const boxes = widths.map(width => {
    const box = { x, width }
    x += width + GAP
    return box
  })
  const scrollWidth = widths.length ? x - GAP + PAD : 500
  Object.defineProperty(track, 'clientWidth', { configurable: true, value: clientWidth })
  Object.defineProperty(track, 'scrollWidth', { configurable: true, value: scrollWidth })
  Object.defineProperty(track, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => { scrollLeft = value },
  })
  track.getBoundingClientRect = () => new DOMRect(RAIL_LEFT, 0, clientWidth, 74)
  Array.from(track.children).forEach((item, index) => {
    const box = boxes[index]
    if (!box) return
    item.getBoundingClientRect = () => new DOMRect(RAIL_LEFT + box.x - scrollLeft, 0, box.width, 74)
  })
  const scrollBy = vi.fn((options: ScrollToOptions) => {
    scrollLeft = Math.max(0, Math.min(scrollWidth - clientWidth, scrollLeft + (options.left ?? 0)))
  })
  track.scrollBy = scrollBy as unknown as typeof track.scrollBy
  // The strip reads the layout on scroll.
  fireEvent.scroll(track)
  return scrollBy
}

const moreGames = () => screen.getByRole('button', { name: /more games/ })

describe('Games played rail arrows', () => {
  it('chips keep the fixed step, one 52 px chip and its gap', () => {
    const { container } = render(<GamesPlayedStrip games={games} durationSeconds={4_800} visibleRange={null} />)
    const track = container.querySelector<HTMLElement>('[data-games-played-track]')!
    const scrollBy = layOut(track, 200)
    // Three 60 px steps fit in 200 px, so 5 of the 8 are ahead.
    expect(moreGames().getAttribute('aria-label')).toBe('Show 5 more games')
    fireEvent.click(moreGames())
    expect(scrollBy).toHaveBeenLastCalledWith(expect.objectContaining({ left: 60 }))
  })

  // (candidate, 10-30) GP1: named posters are 52 to 96 px wide, so the rail
  // measures them instead of assuming the widest.
  it('named posters (session chart): counts the posters really cut off and steps one poster per click', () => {
    const { container } = render(<GamesPlayedStrip games={games} durationSeconds={4_800} headerless />)
    const track = container.querySelector<HTMLElement>('[data-games-played-track]')!
    // Posters at 2-62, 70-130, 138-198, 206-266, 274-370 (the long name), 378-438, 446-506, 514-574.
    const scrollBy = layOut(track, 250, [60, 60, 60, 60, 96, 60, 60, 60])

    // Three whole posters and Tetris cut at 250 px: 5 ahead (a fixed 104 px step said 6).
    expect(moreGames().getAttribute('aria-label')).toBe('Show 5 more games')

    // One short poster: Tetris takes Doom's place (68 px, not 104).
    fireEvent.click(moreGames())
    expect(scrollBy).toHaveBeenLastCalledWith(expect.objectContaining({ left: 68 }))
    expect(track.scrollLeft).toBe(68)
    fireEvent.scroll(track)
    expect(moreGames().getAttribute('aria-label')).toBe('Show 4 more games')

    // The long name is the next one cut off, so this step is its own 104 px.
    fireEvent.click(moreGames())
    expect(scrollBy).toHaveBeenLastCalledWith(expect.objectContaining({ left: 104 }))
    expect(track.scrollLeft).toBe(172)
    fireEvent.scroll(track)
    expect(moreGames().getAttribute('aria-label')).toBe('Show 3 more games')

    // Back: Doom, the last poster cut off on the left, takes Tetris's place.
    fireEvent.click(screen.getByRole('button', { name: 'Previous games' }))
    expect(scrollBy).toHaveBeenLastCalledWith(expect.objectContaining({ left: -68 }))
    expect(track.scrollLeft).toBe(104)
  })
})
