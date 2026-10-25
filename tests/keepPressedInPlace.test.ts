// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindKeepPressedInPlace, revealCardBelow } from '../src/ui/keepPressedInPlace.ts'

/**
 * A panel where a card slot (top `slotTop`) grows by `grown` px above a row.
 * Positions follow the scroller like a real layout: everything moves up by
 * `scrollTop`, and the row also moves down by however much the slot grew.
 */
function setup({ slotTop = 300, rowTop = 400 } = {}) {
  const scroller = document.createElement('div')
  const slot = document.createElement('div')
  slot.className = 'pulse-moment-slot'
  const close = document.createElement('button')
  slot.append(close)
  const row = document.createElement('button')
  scroller.append(slot, row)
  document.body.append(scroller)
  // `grown` is the card slot's height; `other` is any unrelated growth above the row.
  const layout = { grown: 0, other: 0 }
  const rect = (top: number, height = 0) => ({ top, height } as DOMRect)
  scroller.getBoundingClientRect = () => rect(0)
  slot.getBoundingClientRect = () => rect(slotTop - scroller.scrollTop, layout.grown)
  row.getBoundingClientRect = () => rect(rowTop + layout.grown + layout.other - scroller.scrollTop)
  const unbind = bindKeepPressedInPlace(scroller)
  return { scroller, slot, close, row, layout, unbind }
}

function press(target: Element, init: Partial<{ button: number; isPrimary: boolean }> = {}) {
  const event = new MouseEvent('pointerdown', { bubbles: true, composed: true, button: init.button ?? 0 })
  Object.defineProperty(event, 'isPrimary', { value: init.isPrimary ?? true })
  target.dispatchEvent(event)
}

let frames: Array<FrameRequestCallback> = []
let now = 0
function frame(advanceMs = 16) {
  now += advanceMs
  const due = frames
  frames = []
  for (const callback of due) callback(now)
}

beforeEach(() => {
  frames = []
  now = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', () => { frames = [] })
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})
afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('keepPressedInPlace', () => {
  it('keeps the pressed row still while a card opens above it', () => {
    const { scroller, row, layout } = setup()
    press(row)
    expect(scroller.hasAttribute('data-keep-in-place')).toBe(true)
    for (const grown of [40, 120, 158]) {
      layout.grown = grown
      frame()
      expect(scroller.scrollTop).toBe(grown)
      expect(row.getBoundingClientRect().top).toBe(400)
    }
  })

  it('stops for good when the user scrolls with the wheel', () => {
    const { scroller, row, layout } = setup()
    press(row)
    layout.grown = 40
    frame()
    scroller.dispatchEvent(new Event('wheel'))
    layout.grown = 120
    frame()
    expect(scroller.scrollTop).toBe(40)
    expect(scroller.hasAttribute('data-keep-in-place')).toBe(false)
  })

  it('never fights a scroll it did not make', () => {
    const { scroller, row, layout } = setup()
    press(row)
    layout.grown = 40
    frame()
    scroller.scrollTop = 250
    layout.grown = 120
    frame()
    expect(scroller.scrollTop).toBe(250)
  })

  it('holds the content below a card still while its close button collapses it', () => {
    const { scroller, close, row, layout } = setup()
    layout.grown = 158
    scroller.scrollTop = 158
    press(close)
    layout.grown = 0
    frame()
    expect(scroller.scrollTop).toBe(0)
    expect(row.getBoundingClientRect().top).toBe(400)
  })

  it('does not push the opening card above the top of the panel', () => {
    const { scroller, row, layout } = setup({ slotTop: 60, rowTop: 200 })
    press(row)
    layout.grown = 158
    frame()
    // Only 52 px of room above the slot (60 minus an 8 px margin).
    expect(scroller.scrollTop).toBe(52)
  })

  it('ignores secondary buttons and presses on the scroller itself', () => {
    const { scroller, row } = setup()
    press(row, { button: 2 })
    press(scroller)
    expect(scroller.hasAttribute('data-keep-in-place')).toBe(false)
  })

  it('starts from the keyboard too', () => {
    const { scroller, row, layout } = setup()
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    layout.grown = 90
    frame()
    expect(scroller.scrollTop).toBe(90)
  })

  // A real scroller clamps scrollTop to [0, scrollHeight - clientHeight].
  function clampScroll(scroller: HTMLElement, max: number) {
    let value = scroller.scrollTop
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => value,
      set: (next: number) => { value = Math.min(max, Math.max(0, next)) },
    })
  }
  function runFrames(ms: number) {
    for (let elapsed = 0; elapsed < ms && frames.length > 0; elapsed += 16) frame()
  }

  it('ends a close at the top of the panel, where there is nothing left to scroll', () => {
    const { scroller, close, layout } = setup()
    clampScroll(scroller, 400)
    layout.grown = 158
    press(close)
    layout.grown = 0
    runFrames(1500)
    expect(scroller.scrollTop).toBe(0)
    expect(frames).toHaveLength(0)
    expect(scroller.hasAttribute('data-keep-in-place')).toBe(false)
  })

  it('takes what the scroll can absorb when the panel is short, then stops', () => {
    const { scroller, row, layout } = setup()
    clampScroll(scroller, 40)
    press(row)
    layout.grown = 158
    runFrames(1500)
    expect(scroller.scrollTop).toBe(40)
    expect(frames).toHaveLength(0)
    expect(scroller.hasAttribute('data-keep-in-place')).toBe(false)
  })

  it('never runs past its hard deadline, even while the layout keeps moving', () => {
    const { scroller, row, layout } = setup()
    press(row)
    for (let elapsed = 0; elapsed < 3000 && frames.length > 0; elapsed += 16) {
      layout.grown += 2
      frame()
    }
    expect(frames).toHaveLength(0)
    expect(scroller.hasAttribute('data-keep-in-place')).toBe(false)
  })

  it('leaves list expanders alone: only a moment card moving the row is corrected', () => {
    const { scroller, row, layout } = setup()
    press(row)
    // "Show 7 more" inserts rows above its own button; nothing about the card changed.
    layout.other = 350
    runFrames(800)
    expect(scroller.scrollTop).toBe(0)
  })

  it('corrects the card even when something else moves at the same time, and only by the card', () => {
    const { scroller, row, layout } = setup()
    press(row)
    layout.grown = 100
    layout.other = 40
    runFrames(800)
    expect(scroller.scrollTop).toBe(100)
  })

  it('ends once the layout has been quiet and leaves no listeners behind', () => {
    const { scroller, row, layout, unbind } = setup()
    press(row)
    frame(700)
    expect(scroller.hasAttribute('data-keep-in-place')).toBe(false)
    unbind()
    press(row)
    layout.grown = 50
    frame()
    expect(scroller.scrollTop).toBe(0)
  })
})

describe('keepPressedInPlace with a card closing above the pressed row', () => {
  // A Top Moments pick closes the chart's minute card above the list.
  it('keeps the newly picked row in place while the card above it closes', () => {
    const { scroller, row, layout } = setup()
    layout.grown = 158
    scroller.scrollTop = 158
    press(row)
    const before = row.getBoundingClientRect().top
    for (const grown of [120, 40, 0]) {
      layout.grown = grown
      frame()
      expect(row.getBoundingClientRect().top).toBe(before)
    }
    expect(scroller.scrollTop).toBe(0)
  })

  it('takes back scroll rounding frame by frame instead of letting it add up', () => {
    const { scroller, row, layout } = setup()
    // At a 1.25 device pixel ratio scrollTop lands on 0.8 px steps; snapping
    // the same way every frame loses up to 0.8 px each time.
    let value = 400
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => value,
      set: (next: number) => { value = Math.ceil(next / 0.8 - 1e-9) * 0.8 },
    })
    layout.grown = 116
    press(row)
    const before = row.getBoundingClientRect().top
    // The card above collapses over several frames, 14.8 px at a time.
    for (const grown of [101.2, 86.4, 71.6, 56.8, 42, 27.2, 12.4, 0]) {
      layout.grown = grown
      frame()
    }
    runAllFrames()
    expect(Math.abs(row.getBoundingClientRect().top - before)).toBeLessThan(1)
  })

  it('never scrolls once the press has settled', () => {
    const { scroller, row } = setup()
    const scrollBy = vi.fn()
    scroller.scrollBy = scrollBy as unknown as HTMLElement['scrollBy']
    press(row)
    runAllFrames()
    expect(scrollBy).not.toHaveBeenCalled()
    expect(scroller.scrollTop).toBe(0)
  })
})

function runAllFrames() {
  for (let elapsed = 0; elapsed < 1500 && frames.length > 0; elapsed += 16) frame()
}

describe('revealCardBelow (an arrival)', () => {
  /** Stands in for the browser's ResizeObserver: `resize()` reports a layout change to every live one. */
  let observers: Array<{ callback: () => void; watched: Element[] }> = []
  function resize() {
    for (const observer of observers) if (observer.watched.length) observer.callback()
  }
  beforeEach(() => {
    observers = []
    vi.stubGlobal('ResizeObserver', class {
      private entry: { callback: () => void; watched: Element[] }
      constructor(callback: () => void) {
        this.entry = { callback, watched: [] }
        observers.push(this.entry)
      }
      observe(target: Element) { this.entry.watched.push(target) }
      disconnect() { this.entry.watched = [] }
    })
  })

  /**
   * A panel (top `panelTop`, `panelHeight` tall) with the chip at `chipTop`
   * in the window and the card's slot right after it, in the panel's content.
   */
  function arrival({ chipTop = 600, cardHeight = 0, panelTop = 0, panelHeight = 500 } = {}) {
    const scroller = document.createElement('div')
    scroller.className = 'pulse-panel-body'
    const content = document.createElement('div')
    const chip = document.createElement('div')
    const slot = document.createElement('div')
    slot.className = 'pulse-moment-slot'
    content.append(chip, slot)
    scroller.append(content)
    document.body.append(scroller)
    // `above` grows the content over the chip, as a summary that loads taller.
    const layout = { cardHeight, above: 0 }
    const rect = (top: number, height: number) => ({ top, bottom: top + height, height } as DOMRect)
    scroller.getBoundingClientRect = () => rect(panelTop, panelHeight)
    chip.getBoundingClientRect = () => rect(chipTop + layout.above - scroller.scrollTop, 24)
    slot.getBoundingClientRect = () => rect(chipTop + layout.above + 30 - scroller.scrollTop, layout.cardHeight)
    return { scroller, content, chip, layout }
  }

  it('scrolls just far enough for the card, following it while it opens', () => {
    const { scroller, chip, layout } = arrival()
    revealCardBelow(chip)
    frame()
    // The empty slot starts at 630: 630 + 8 px margin - 500.
    expect(scroller.scrollTop).toBe(138)
    layout.cardHeight = 200
    frame()
    // Card bottom 830 + 8 - 500.
    expect(scroller.scrollTop).toBe(338)
  })

  it('favours the card over the chip when both cannot fit', () => {
    const { scroller, chip } = arrival({ cardHeight: 480 })
    revealCardBelow(chip)
    frame()
    // Card bottom 1110 + 8 - 500: the chip (at 600) scrolls off, the card's actions show.
    expect(scroller.scrollTop).toBe(618)
    expect(chip.getBoundingClientRect().top).toBeLessThan(0)
  })

  it('ends the visible panel at the bottom edge of the window', () => {
    vi.stubGlobal('innerHeight', 400)
    const { scroller, chip } = arrival()
    revealCardBelow(chip)
    frame()
    // The panel runs to 500, the window to 400: 630 + 8 - 400.
    expect(scroller.scrollTop).toBe(238)
  })

  it('follows a picture that makes the card taller seconds later', () => {
    const { scroller, chip, layout } = arrival({ cardHeight: 150 })
    revealCardBelow(chip)
    frame()
    expect(scroller.scrollTop).toBe(288)
    // The card has opened: no more frames, only layout changes.
    frame(700)
    expect(frames).toEqual([])
    frame(3000)
    layout.cardHeight = 330
    resize()
    expect(scroller.scrollTop).toBe(468)
  })

  it('finds the slot inside what follows the chip (Top moments\' card)', () => {
    const { scroller, chip } = arrival({ cardHeight: 200 })
    const slot = chip.nextElementSibling!
    const wrapper = document.createElement('div')
    chip.after(wrapper)
    wrapper.append(slot)
    revealCardBelow(chip)
    frame()
    // Card bottom 830 + 8 - 500, as with the slot right after the chip.
    expect(scroller.scrollTop).toBe(338)
  })

  it('follows the chip when it moves to the card that opens', () => {
    const { scroller, content, chip } = arrival({ cardHeight: 200 })
    // The chip first renders under the chart, with no card after it.
    const early = document.createElement('div')
    early.getBoundingClientRect = () => ({ top: 300 - scroller.scrollTop, bottom: 324 - scroller.scrollTop, height: 24 } as DOMRect)
    content.prepend(early)
    let current: HTMLElement = early
    revealCardBelow(() => current)
    frame()
    expect(scroller.scrollTop).toBe(0)
    // The recap matches a ranked moment: the chip re-renders above its card.
    early.remove()
    current = chip
    frame()
    expect(scroller.scrollTop).toBe(338)
  })

  it('goes on through scroll anchoring when something above loads taller', () => {
    const { scroller, chip, layout } = arrival({ cardHeight: 150 })
    revealCardBelow(chip)
    frame()
    expect(scroller.scrollTop).toBe(288)
    // The summary above loads 40 px taller; scroll anchoring keeps the chip in place.
    layout.above = 40
    scroller.scrollTop += 40
    frame()
    expect(scroller.scrollTop).toBe(328)
    // The card's picture mounts later and is still followed: 670 + 330 + 8 - 500.
    layout.cardHeight = 330
    frame()
    expect(scroller.scrollTop).toBe(508)
  })

  // Real-Twitch check, 2026-10-19: at 1038×1078 the card fit until its picture landed,
  // past the old five-second window, and pushed the card's actions out of view.
  it('keeps the card\'s actions in view at 1038×1078 when its picture lands 12 s later', () => {
    vi.stubGlobal('innerHeight', 1078)
    const { scroller, content, chip, layout } = arrival({ chipTop: 760, cardHeight: 200, panelTop: 140, panelHeight: 860 })
    revealCardBelow(chip)
    expect(observers.map(observer => observer.watched)).toEqual([[scroller, content]])
    frame()
    // Card bottom 990 + 8 is inside the panel's end at 1000.
    expect(scroller.scrollTop).toBe(0)
    frame(12_000)
    layout.cardHeight = 400
    resize()
    // Card bottom 1190 + 8 - 1000.
    expect(scroller.scrollTop).toBe(198)
  })

  it('leaves a card already in view alone', () => {
    const { scroller, chip } = arrival({ chipTop: 100, cardHeight: 200 })
    revealCardBelow(chip)
    frame()
    expect(scroller.scrollTop).toBe(0)
  })

  it('stops at the viewer\'s first input, and on its own after a minute', () => {
    const first = arrival()
    revealCardBelow(first.chip)
    first.scroller.dispatchEvent(new Event('wheel'))
    frame()
    expect(first.scroller.scrollTop).toBe(0)
    expect(frames).toEqual([])
    first.layout.cardHeight = 200
    resize()
    expect(first.scroller.scrollTop).toBe(0)

    const second = arrival()
    revealCardBelow(second.chip)
    frame()
    expect(second.scroller.scrollTop).toBe(138)
    frame(60_100)
    second.layout.cardHeight = 200
    resize()
    expect(second.scroller.scrollTop).toBe(138)
    expect(observers.every(observer => observer.watched.length === 0)).toBe(true)
  })

  it('stops when anything else scrolls the panel, such as its scrollbar', () => {
    const { scroller, chip, layout } = arrival()
    revealCardBelow(chip)
    frame()
    expect(scroller.scrollTop).toBe(138)
    scroller.scrollTop = 0
    layout.cardHeight = 200
    frame()
    expect(scroller.scrollTop).toBe(0)
    expect(frames).toEqual([])
    resize()
    expect(scroller.scrollTop).toBe(0)
  })
})
