import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { applyWheelGesture, ChartNavigator, type ChartNavigatorRange } from './ChartNavigator.tsx'

afterEach(() => cleanup())

const WIDTH = 1000

/** A navigator with a wheel surface around it, as on the stream chart. */
function Harness({ pointCount, minVisibleCount }: { pointCount: number; minVisibleCount?: number }) {
  const [range, setRange] = useState<ChartNavigatorRange>({ startIndex: 0, endIndex: pointCount - 1 })
  const [scrollZoom, setScrollZoom] = useState(false)
  const surfaceRef = useRef<HTMLDivElement>(null)
  return (
    <div ref={surfaceRef} data-testid="surface">
      <div data-testid="plot" />
      <ChartNavigator
        pointCount={pointCount}
        startIndex={range.startIndex}
        endIndex={range.endIndex}
        startLabel="start"
        endLabel="end"
        wheelSurfaceRef={surfaceRef}
        minVisibleCount={minVisibleCount}
        scrollZoomEnabled={scrollZoom}
        onScrollZoomChange={setScrollZoom}
        onChange={(next) => setRange(next)}
        onReset={() => {
          setScrollZoom(false)
          setRange({ startIndex: 0, endIndex: pointCount - 1 })
        }}
      />
    </div>
  )
}

function setup(pointCount: number, minVisibleCount?: number) {
  const view = render(<Harness pointCount={pointCount} minVisibleCount={minVisibleCount} />)
  const surface = screen.getByTestId('surface')
  const plot = screen.getByTestId('plot')
  const rect = { left: 0, right: WIDTH, top: 0, bottom: 300, width: WIDTH, height: 300, x: 0, y: 0, toJSON: () => ({}) }
  Object.defineProperty(surface, 'getBoundingClientRect', { configurable: true, value: () => rect })
  const track = view.container.querySelector('.hx-chart-navigator__track') as HTMLElement
  Object.defineProperty(track, 'getBoundingClientRect', { configurable: true, value: () => rect })
  const navigator = view.container.querySelector('[data-hub-chart-navigator]') as HTMLElement
  const range = () => navigator.getAttribute('data-hub-chart-navigator-window')!
  const count = () => {
    const [start, end] = range().split(':').map(Number)
    return end! - start! + 1
  }
  let timeStamp = 1000
  /** Dispatches one wheel event; returns whether the page keeps it (not prevented). */
  const wheel = (init: WheelEventInit & { target?: HTMLElement }, gapMs = 8) => {
    timeStamp += gapMs
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: init.cancelable ?? true, clientX: WIDTH / 2, ...init })
    Object.defineProperty(event, 'timeStamp', { value: timeStamp })
    act(() => { (init.target ?? plot).dispatchEvent(event) })
    return event
  }
  const scrollZoom = () => fireEvent.click(screen.getByRole('button', { name: /Scroll zoom/ }))
  return { range, count, wheel, scrollZoom, navigator, track }
}

describe('ChartNavigator wheel matrix', () => {
  it('scrolls the page for a plain wheel while Scroll zoom is off, in every delta profile', () => {
    const { wheel, range } = setup(240)
    for (const init of [
      { deltaY: -100 }, { deltaY: 120 }, { deltaY: -4 }, { deltaY: 2 }, { deltaY: -3, deltaMode: 1 },
      { deltaY: -10, ctrlKey: true },
    ]) {
      expect(wheel(init).defaultPrevented, JSON.stringify(init)).toBe(false)
    }
    expect(range()).toBe('0:239')
  })

  it('zooms the same total amount for one notch, a high-resolution burst, a touchpad burst and a Firefox line notch', () => {
    const results: Record<string, number> = {}
    const profiles: Record<string, Array<WheelEventInit>> = {
      'windows notch -100': [{ deltaY: -100 }],
      'hi-res 25 x -4': Array.from({ length: 25 }, () => ({ deltaY: -4 })),
      'smooth 10 x -10': Array.from({ length: 10 }, () => ({ deltaY: -10 })),
      'touchpad 50 x -2': Array.from({ length: 50 }, () => ({ deltaY: -2 })),
      'firefox 3 lines': [{ deltaY: -3, deltaMode: 1 }],
    }
    for (const [name, events] of Object.entries(profiles)) {
      for (const pointCount of [240, 21]) {
        const { wheel, count, scrollZoom } = setup(pointCount)
        scrollZoom()
        for (const init of events) expect(wheel(init).defaultPrevented, name).toBe(true)
        results[`${name}@${pointCount}`] = count()
        cleanup()
      }
    }
    // exp(-100 * 0.0025) of the view, whatever the event size.
    for (const [key, value] of Object.entries(results)) {
      const pointCount = Number(key.split('@')[1])
      expect(Math.abs(value - pointCount * Math.exp(-0.25)), key).toBeLessThanOrEqual(1)
    }
  })

  it('zooms with Alt held while Scroll zoom is off, in every delta profile', () => {
    for (const events of [
      [{ deltaY: -100 }],
      Array.from({ length: 25 }, () => ({ deltaY: -4 })),
      Array.from({ length: 50 }, () => ({ deltaY: -2 })),
      [{ deltaY: -3, deltaMode: 1 }],
    ]) {
      const { wheel, count } = setup(240)
      for (const init of events) expect(wheel({ ...init, altKey: true }).defaultPrevented).toBe(true)
      expect(Math.abs(count() - 240 * Math.exp(-0.25))).toBeLessThanOrEqual(1)
      cleanup()
    }
  })

  it('zooms back out by the same amount', () => {
    const { wheel, count, scrollZoom } = setup(240)
    scrollZoom()
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
    view.scrollZoom()
    for (const init of [...pinch, { deltaY: -100, ctrlKey: true }]) expect(view.wheel(init).defaultPrevented).toBe(false)
    for (const init of pinch) expect(view.wheel({ ...init, altKey: true }).defaultPrevented).toBe(false)
    expect(view.range()).toBe('0:239')
  })

  it('leaves Meta+wheel to the browser even with Scroll zoom on', () => {
    const { wheel, range, scrollZoom } = setup(240)
    scrollZoom()
    expect(wheel({ deltaY: -100, metaKey: true }).defaultPrevented).toBe(false)
    expect(range()).toBe('0:239')
  })

  it('pans with Shift+wheel and horizontal swipes, adding small deltas up exactly', () => {
    const { wheel, range, count, scrollZoom } = setup(240)
    // Full range: nothing to pan, so the page keeps the event.
    expect(wheel({ deltaY: 100, shiftKey: true }).defaultPrevented).toBe(false)
    scrollZoom()
    for (let index = 0; index < 4; index += 1) wheel({ deltaY: -100, clientX: 0 })
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
    const { wheel, count, scrollZoom } = setup(8)
    scrollZoom()
    const counts = [count()]
    for (let index = 0; index < 3; index += 1) {
      expect(wheel({ deltaY: -60 }).defaultPrevented).toBe(true)
      counts.push(count())
    }
    for (let index = 1; index < counts.length; index += 1) expect(counts[index]!).toBeLessThan(counts[index - 1]!)
  })

  it('gives the page the wheel at the zoom limits instead of swallowing it', () => {
    const { wheel, count, scrollZoom } = setup(30, 6)
    scrollZoom()
    // Already at the full view: zooming out has nothing to do.
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false)
    for (let index = 0; index < 20; index += 1) wheel({ deltaY: -100 })
    expect(count()).toBe(6)
    // At the floor: zooming in has nothing to do.
    expect(wheel({ deltaY: -100 }).defaultPrevented).toBe(false)
    expect(wheel({ deltaY: -3 }).defaultPrevented).toBe(false)
  })

  it('applies a wheel event over the navigator once, even when it cannot be cancelled', () => {
    const { wheel, count, scrollZoom, track } = setup(240)
    scrollZoom()
    // The navigator sits inside the wheel surface, so both hear the event; an
    // uncancellable event is never marked defaultPrevented.
    const event = wheel({ deltaY: -100, cancelable: false, target: track })
    expect(event.defaultPrevented).toBe(false)
    expect(count()).toBe(Math.round(240 * Math.exp(-0.25)))
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
