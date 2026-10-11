import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyWheelGesture,
  ChartNavigator,
  CHART_SCROLL_ZOOM_STORAGE_KEY,
  resetChartWheelGuard,
  type ChartNavigatorRange,
} from './ChartNavigator.tsx'
import { resetChartScrollZoomMemory } from './chartScrollZoom.ts'

beforeEach(() => {
  window.localStorage.clear()
  resetChartScrollZoomMemory()
  resetChartWheelGuard()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
  resetChartScrollZoomMemory()
  resetChartWheelGuard()
})

const WIDTH = 1000
const PLOT_HEIGHT = 300

/**
 * A navigator with a wheel surface around it, as on the stream chart: the
 * plot box is the top 300px of the surface; below it sit axis labels.
 * Scroll zoom comes from the remembered preference (on by default).
 */
function Harness({ pointCount, minVisibleCount, testId = 'surface' }: { pointCount: number; minVisibleCount?: number; testId?: string }) {
  const [range, setRange] = useState<ChartNavigatorRange>({ startIndex: 0, endIndex: pointCount - 1 })
  const surfaceRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  return (
    <div ref={surfaceRef} data-testid={testId}>
      <div ref={plotRef} data-testid={`${testId}-plot`} />
      <div data-testid={`${testId}-labels`} />
      <ChartNavigator
        pointCount={pointCount}
        startIndex={range.startIndex}
        endIndex={range.endIndex}
        startLabel="start"
        endLabel="end"
        wheelSurfaceRef={surfaceRef}
        wheelAnchor={() => plotRef.current}
        minVisibleCount={minVisibleCount}
        onChange={(next) => setRange(next)}
        onReset={() => setRange({ startIndex: 0, endIndex: pointCount - 1 })}
      />
    </div>
  )
}

const rectAt = (top: number, height: number) => ({
  left: 0, right: WIDTH, top, bottom: top + height, width: WIDTH, height, x: 0, y: top, toJSON: () => ({}),
})

/** Wheel event times keep growing across tests, like one page session. */
let clock = 10_000

function setup(pointCount: number, minVisibleCount?: number) {
  clock += 100_000
  const view = render(<Harness pointCount={pointCount} minVisibleCount={minVisibleCount} />)
  const surface = screen.getByTestId('surface')
  const plot = screen.getByTestId('surface-plot')
  const labels = screen.getByTestId('surface-labels')
  Object.defineProperty(surface, 'getBoundingClientRect', { configurable: true, value: () => rectAt(0, 400) })
  Object.defineProperty(plot, 'getBoundingClientRect', { configurable: true, value: () => rectAt(0, PLOT_HEIGHT) })
  const track = view.container.querySelector('.hx-chart-navigator__track') as HTMLElement
  const trackShell = view.container.querySelector('.hx-chart-navigator__track-shell') as HTMLElement
  Object.defineProperty(track, 'getBoundingClientRect', { configurable: true, value: () => rectAt(340, 20) })
  Object.defineProperty(trackShell, 'getBoundingClientRect', { configurable: true, value: () => rectAt(336, 28) })
  const navigator = view.container.querySelector('[data-hub-chart-navigator]') as HTMLElement
  const range = () => navigator.getAttribute('data-hub-chart-navigator-window')!
  const count = () => {
    const [start, end] = range().split(':').map(Number)
    return end! - start! + 1
  }
  /** Dispatches one wheel event over the plot; returns it (defaultPrevented = taken from the page). */
  const wheel = (init: WheelEventInit & { target?: HTMLElement }, gapMs = 8) => {
    clock += gapMs
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: init.cancelable ?? true, clientX: WIDTH / 2, clientY: PLOT_HEIGHT / 2, ...init })
    Object.defineProperty(event, 'timeStamp', { value: clock })
    act(() => { (init.target ?? plot).dispatchEvent(event) })
    return event
  }
  /** A wheel event somewhere else on the page (no chart under it). */
  const pageWheel = (gapMs = 8) => {
    clock += gapMs
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100, clientX: 10, clientY: 900 })
    Object.defineProperty(event, 'timeStamp', { value: clock })
    act(() => { document.body.dispatchEvent(event) })
    return event
  }
  const toggle = () => screen.getByRole('button', { name: /Scroll zoom/ })
  const scrollZoom = () => fireEvent.click(toggle())
  return { range, count, wheel, pageWheel, toggle, scrollZoom, navigator, track, labels, view }
}

const PROFILES: Record<string, Array<WheelEventInit>> = {
  'windows notch -100': [{ deltaY: -100 }],
  'windows notch -120 (one 120px notch)': [{ deltaY: -120 }],
  'hi-res 25 x -4': Array.from({ length: 25 }, () => ({ deltaY: -4 })),
  'smooth 10 x -10': Array.from({ length: 10 }, () => ({ deltaY: -10 })),
  'touchpad 50 x -2': Array.from({ length: 50 }, () => ({ deltaY: -2 })),
  'firefox 3 lines': [{ deltaY: -3, deltaMode: 1 }],
}

const totalPixels = (events: WheelEventInit[]) =>
  events.reduce((sum, event) => sum + (event.deltaY ?? 0) * (event.deltaMode === 1 ? 100 / 3 : 1), 0)

describe('ChartNavigator wheel matrix', () => {
  it('zooms with a plain wheel over the plot by default, by the total delta of every profile', () => {
    for (const [name, events] of Object.entries(PROFILES)) {
      for (const pointCount of [240, 21]) {
        const { wheel, count, toggle } = setup(pointCount)
        expect(toggle().getAttribute('aria-pressed'), 'Scroll zoom is on by default').toBe('true')
        for (const init of events) expect(wheel(init).defaultPrevented, name).toBe(true)
        const expected = pointCount * Math.exp(totalPixels(events) * 0.0025)
        expect(Math.abs(count() - expected), `${name}@${pointCount}`).toBeLessThanOrEqual(1)
        cleanup()
      }
    }
  })

  it('leaves a plain wheel to the page with Scroll zoom off, in every profile', () => {
    const { wheel, range, scrollZoom, toggle } = setup(240)
    scrollZoom()
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    for (const events of Object.values(PROFILES)) {
      for (const init of events) expect(wheel(init).defaultPrevented).toBe(false)
    }
    expect(range()).toBe('0:239')
  })

  it('zooms with Alt held while Scroll zoom is off, in every profile', () => {
    for (const events of Object.values(PROFILES)) {
      const { wheel, count, scrollZoom } = setup(240)
      scrollZoom()
      for (const init of events) expect(wheel({ ...init, altKey: true }).defaultPrevented).toBe(true)
      expect(Math.abs(count() - 240 * Math.exp(totalPixels(events) * 0.0025))).toBeLessThanOrEqual(1)
      cleanup()
    }
  })

  it('lands a burst on the exact computed span, with no momentum of its own', () => {
    const { wheel, count } = setup(748)
    // 7 notches in, 3 out: e^(-4 * 0.25) of the view, rounded once.
    for (let index = 0; index < 7; index += 1) wheel({ deltaY: -100 })
    for (let index = 0; index < 3; index += 1) wheel({ deltaY: 100 })
    expect(Math.abs(count() - 748 * Math.exp(-1))).toBeLessThanOrEqual(1)
  })

  it('zooms back out by the same amount', () => {
    const { wheel, count } = setup(240)
    for (let index = 0; index < 4; index += 1) wheel({ deltaY: -100 })
    const zoomed = count()
    for (let index = 0; index < 100; index += 1) wheel({ deltaY: 4 })
    expect(count()).toBeGreaterThan(zoomed)
    expect(Math.abs(count() - zoomed * Math.exp(0.25 * 4))).toBeLessThanOrEqual(2)
  })

  it('leaves Ctrl+wheel and touchpad pinch to browser zoom in every mode', () => {
    // Chrome reports a pinch as Ctrl+wheel with deltaY = -100 * ln(scale).
    const pinch = Array.from({ length: 12 }, () => ({ deltaY: (-100 * Math.log(2)) / 12, ctrlKey: true }))
    const view = setup(240)
    for (const init of [...pinch, { deltaY: -100, ctrlKey: true }]) expect(view.wheel(init).defaultPrevented).toBe(false)
    for (const init of pinch) expect(view.wheel({ ...init, altKey: true }).defaultPrevented).toBe(false)
    view.scrollZoom()
    for (const init of [...pinch, { deltaY: -100, ctrlKey: true }]) expect(view.wheel(init).defaultPrevented).toBe(false)
    expect(view.range()).toBe('0:239')
  })

  it('leaves Meta+wheel to the browser', () => {
    const { wheel, range } = setup(240)
    expect(wheel({ deltaY: -100, metaKey: true }).defaultPrevented).toBe(false)
    expect(range()).toBe('0:239')
  })

  it('pans with Shift+wheel and horizontal swipes, adding small deltas up exactly', () => {
    const { wheel, range, count } = setup(240)
    // Full range: nothing to pan, so the page keeps the event.
    expect(wheel({ deltaY: 100, shiftKey: true }).defaultPrevented).toBe(false)
    // That page scroll holds plain zoom back for 400 ms (scroll-through guard).
    for (let index = 0; index < 4; index += 1) wheel({ deltaY: -100, clientX: 0 }, index === 0 ? 600 : 8)
    const before = range().split(':').map(Number)
    const span = count()
    // 800px of movement pans one whole view: 40 x 5px = 200px = a quarter.
    for (let index = 0; index < 40; index += 1) expect(wheel({ deltaX: 5, deltaY: 0 }).defaultPrevented).toBe(true)
    const after = range().split(':').map(Number)
    expect(count()).toBe(span)
    expect(Math.abs(after[0]! - before[0]! - span / 4)).toBeLessThanOrEqual(1)
    // Shift + a vertical notch pans too (Shift+wheel), and never zooms.
    expect(wheel({ deltaY: 100, shiftKey: true }).defaultPrevented).toBe(true)
    expect(count()).toBe(span)
    expect(Number(range().split(':')[0])).toBeGreaterThan(after[0]!)
  })

  it('moves at least one step for every whole notch, even on a short view', () => {
    const { wheel, count } = setup(8)
    const counts = [count()]
    for (let index = 0; index < 3; index += 1) {
      expect(wheel({ deltaY: -60 }).defaultPrevented).toBe(true)
      counts.push(count())
    }
    for (let index = 1; index < counts.length; index += 1) expect(counts[index]!).toBeLessThan(counts[index - 1]!)
  })

  it('gives the page a zoom-out at the full range, so a wheel-down never traps it', () => {
    const { wheel, range } = setup(240)
    for (const init of [{ deltaY: 100 }, { deltaY: 4 }, { deltaY: 3, deltaMode: 1 }]) {
      expect(wheel(init).defaultPrevented).toBe(false)
    }
    expect(range()).toBe('0:239')
  })

  it('takes a zoom-in at the floor while the gesture continues, and gives the page a fresh one after a pause', () => {
    const { wheel, count } = setup(30, 6)
    for (let index = 0; index < 20; index += 1) wheel({ deltaY: -100 })
    expect(count()).toBe(6)
    // Still in the gesture: taken, so the page does not jump.
    expect(wheel({ deltaY: -100 }).defaultPrevented).toBe(true)
    expect(wheel({ deltaY: -3 }, 1_400).defaultPrevented).toBe(true)
    // After a pause longer than the gesture gap: the page gets it.
    expect(wheel({ deltaY: -100 }, 1_600).defaultPrevented).toBe(false)
    expect(count()).toBe(6)
  })

  it('keeps a page scroll that sweeps the plot under the pointer scrolling the page', () => {
    const view = setup(240)
    view.pageWheel()
    // 200 ms later the plot is under the pointer: still the page's scroll.
    expect(view.wheel({ deltaY: 100 }, 200).defaultPrevented).toBe(false)
    expect(view.wheel({ deltaY: -100 }, 200).defaultPrevented).toBe(false)
    expect(view.range()).toBe('0:239')
    // Alt+wheel is never held back.
    expect(view.wheel({ deltaY: -100, altKey: true }, 50).defaultPrevented).toBe(true)
    cleanup()

    const fresh = setup(240)
    fresh.pageWheel()
    // After 600 ms of quiet, a wheel over the plot zooms.
    expect(fresh.wheel({ deltaY: -100 }, 600).defaultPrevented).toBe(true)
    expect(fresh.count()).toBeLessThan(240)
  })

  it('leaves a wheel outside the plot box to the page, even inside the chart', () => {
    const { wheel, range, labels, view } = setup(240)
    // Axis labels under the plot (inside the wheel surface).
    expect(wheel({ deltaY: -100, clientY: PLOT_HEIGHT + 20, target: labels }).defaultPrevented).toBe(false)
    // The navigator's buttons, readout and hint.
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' })
    expect(wheel({ deltaY: -100, clientY: 380, target: zoomIn }).defaultPrevented).toBe(false)
    const hint = view.container.querySelector('.hx-chart-navigator__hint') as HTMLElement
    expect(wheel({ deltaY: -100, clientY: 390, target: hint }).defaultPrevented).toBe(false)
    expect(range()).toBe('0:239')
    // The navigator track is a zoom surface.
    const track = view.container.querySelector('.hx-chart-navigator__track') as HTMLElement
    expect(wheel({ deltaY: -100, clientY: 350, target: track }, 600).defaultPrevented).toBe(true)
  })

  it('counts an overlay drawn on top of the plot as the plot', () => {
    const { wheel, labels, count } = setup(240)
    // An element outside the plot node, but over the plot box.
    expect(wheel({ deltaY: -100, clientY: PLOT_HEIGHT / 2, target: labels }).defaultPrevented).toBe(true)
    expect(count()).toBeLessThan(240)
  })

  it('applies a wheel event over the navigator once, even when it cannot be cancelled', () => {
    const { wheel, count, track } = setup(240)
    // The navigator sits inside the wheel surface, so both hear the event; an
    // uncancellable event is never marked defaultPrevented.
    const event = wheel({ deltaY: -100, cancelable: false, target: track, clientY: 350 })
    expect(event.defaultPrevented).toBe(false)
    expect(count()).toBe(Math.round(240 * Math.exp(-0.25)))
  })
})

describe('Scroll zoom preference', () => {
  it('is on by default, remembered in localStorage, and read back on the next mount', () => {
    const first = setup(240)
    expect(first.toggle().getAttribute('aria-pressed')).toBe('true')
    expect(first.toggle().textContent).toContain('On')
    expect(first.toggle().getAttribute('title')).toBe('Remembered in this browser')
    first.scrollZoom()
    expect(window.localStorage.getItem(CHART_SCROLL_ZOOM_STORAGE_KEY)).toBe('off')
    cleanup()
    const second = setup(240)
    expect(second.toggle().getAttribute('aria-pressed')).toBe('false')
    expect(second.toggle().textContent).toContain('Off')
    second.scrollZoom()
    expect(window.localStorage.getItem(CHART_SCROLL_ZOOM_STORAGE_KEY)).toBe('on')
  })

  it('treats a missing or invalid stored value as on', () => {
    window.localStorage.setItem(CHART_SCROLL_ZOOM_STORAGE_KEY, 'maybe')
    const { toggle } = setup(240)
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
  })

  it('defaults to on and keeps the choice in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const { toggle, scrollZoom, wheel, range } = setup(240)
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    scrollZoom()
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    expect(wheel({ deltaY: -100 }).defaultPrevented).toBe(false)
    expect(range()).toBe('0:239')
    scrollZoom()
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
  })

  it('is one value for every navigator on the page, and follows another tab', () => {
    clock += 100_000
    render(
      <>
        <Harness pointCount={240} testId="a" />
        <Harness pointCount={120} testId="b" />
      </>,
    )
    const toggles = screen.getAllByRole('button', { name: /Scroll zoom/ })
    expect(toggles.map(toggle => toggle.getAttribute('aria-pressed'))).toEqual(['true', 'true'])
    fireEvent.click(toggles[0]!)
    expect(toggles.map(toggle => toggle.getAttribute('aria-pressed'))).toEqual(['false', 'false'])
    // Another tab turns it back on.
    window.localStorage.setItem(CHART_SCROLL_ZOOM_STORAGE_KEY, 'on')
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: CHART_SCROLL_ZOOM_STORAGE_KEY, newValue: 'on' })) })
    expect(toggles.map(toggle => toggle.getAttribute('aria-pressed'))).toEqual(['true', 'true'])
  })

  it('is changed only by the toggle: Reset zoom, Escape on a slider and a track double-click keep it', () => {
    const { wheel, toggle, range, view } = setup(240)
    for (let index = 0; index < 3; index += 1) wheel({ deltaY: -100 })
    expect(range()).not.toBe('0:239')
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }))
    expect(range()).toBe('0:239')
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Reset zoom' }).hasAttribute('disabled')).toBe(true)

    for (let index = 0; index < 3; index += 1) wheel({ deltaY: -100 })
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Chart view start' }), { key: 'Escape' })
    expect(range()).toBe('0:239')
    expect(toggle().getAttribute('aria-pressed')).toBe('true')

    for (let index = 0; index < 3; index += 1) wheel({ deltaY: -100 })
    fireEvent.doubleClick(view.container.querySelector('.hx-chart-navigator__track') as HTMLElement)
    expect(range()).toBe('0:239')
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
  })

  it('no longer takes Escape from the rest of the navigator', () => {
    const { wheel, toggle, range } = setup(240)
    for (let index = 0; index < 3; index += 1) wheel({ deltaY: -100 })
    const zoomed = range()
    fireEvent.keyDown(toggle(), { key: 'Escape' })
    expect(range()).toBe(zoomed)
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
  })

  it('words the hint for each state', () => {
    const { scrollZoom, view } = setup(240)
    const hint = () => view.container.querySelector('.hx-chart-navigator__hint')?.textContent
    expect(hint()).toBe('Scroll over the chart to zoom · Shift + scroll to pan · Drag the purple bar to pick a span')
    scrollZoom()
    expect(hint()).toBe('Scroll zoom is off: the wheel scrolls the page · Hold Alt and scroll to zoom · Shift + scroll to pan')
  })
})

describe('applyWheelGesture', () => {
  it('keeps the minute under the pointer in place', () => {
    const current = { startIndex: 0, endIndex: 99 }
    const result = applyWheelGesture({ pointCount: 100, current, mode: 'zoom', deltaPixels: -100, anchorRatio: 0.25 })
    const anchorBefore = 0 + 0.25 * 99
    const anchorAfter = result.start + 0.25 * (result.end - result.start)
    expect(anchorAfter).toBeCloseTo(anchorBefore)
    expect(result.moved).toBe(true)
  })

  it('reports no movement at a limit', () => {
    const full = { startIndex: 0, endIndex: 99 }
    expect(applyWheelGesture({ pointCount: 100, current: full, mode: 'zoom', deltaPixels: 100 }).moved).toBe(false)
    expect(applyWheelGesture({ pointCount: 100, current: full, mode: 'pan', deltaPixels: 100 }).moved).toBe(false)
    const left = { startIndex: 0, endIndex: 9 }
    expect(applyWheelGesture({ pointCount: 100, current: left, mode: 'pan', deltaPixels: -100 }).moved).toBe(false)
    expect(applyWheelGesture({ pointCount: 100, current: left, mode: 'pan', deltaPixels: 100 }).moved).toBe(true)
  })

  it('never zooms more than 2x in one event', () => {
    const current = { startIndex: 0, endIndex: 199 }
    const page = applyWheelGesture({ pointCount: 200, current, mode: 'zoom', deltaPixels: -3000 })
    expect(page.range.endIndex - page.range.startIndex + 1).toBe(100)
  })
})
