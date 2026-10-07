// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindKeepPressedInPlace } from '../src/ui/keepPressedInPlace.ts'

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
