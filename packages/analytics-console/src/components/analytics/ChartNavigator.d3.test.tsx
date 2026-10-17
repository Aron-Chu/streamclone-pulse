import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Profiler, useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ChartNavigator,
  isChartWheelExempt,
  wheelZoneContains,
  type ChartNavigatorOverview,
  type ChartNavigatorPreset,
  type ChartNavigatorRange,
  type SpRange,
  type SpViewportSource,
} from './ChartNavigator.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const POINTS = 240
const SPAN = POINTS - 1
const WIDTH = 1000
const PLOT_TOP = 30
const PLOT_BOTTOM = 300

/**
 * A stand-in for the chart core's viewport store (plan §2.1): setTarget moves
 * the target at once; frames and the settle are driven by the test.
 */
function createFakeStore(initial: SpRange = { startIndex: 0, endIndex: SPAN }) {
  let target = { ...initial }
  let visual = { ...initial }
  const targetListeners = new Set<() => void>()
  const frameListeners = new Set<(visual: SpRange) => void>()
  const settleListeners = new Set<(settled: SpRange) => void>()
  const setTarget = vi.fn((next: SpRange, _opts?: { animate?: boolean }) => {
    target = { startIndex: next.startIndex, endIndex: next.endIndex }
    targetListeners.forEach((listener) => listener())
  })
  const source: SpViewportSource = {
    getTarget: () => target,
    getVisual: () => visual,
    setTarget,
    subscribeTarget(listener) {
      targetListeners.add(listener)
      return () => targetListeners.delete(listener)
    },
    subscribeFrame(listener) {
      frameListeners.add(listener)
      return () => frameListeners.delete(listener)
    },
    subscribeSettle(listener) {
      settleListeners.add(listener)
      return () => settleListeners.delete(listener)
    },
  }
  return {
    source,
    setTarget,
    frame(next: SpRange) {
      visual = { ...next }
      act(() => frameListeners.forEach((listener) => listener(visual)))
    },
    settle() {
      visual = { ...target }
      act(() => {
        frameListeners.forEach((listener) => listener(visual))
        settleListeners.forEach((listener) => listener(visual))
      })
    },
    listenerCounts: () => ({ target: targetListeners.size, frame: frameListeners.size, settle: settleListeners.size }),
  }
}

interface HarnessProps {
  source?: SpViewportSource
  variant?: 'd3'
  overview?: ChartNavigatorOverview | null
  presets?: ChartNavigatorPreset[]
  onChange?: (range: ChartNavigatorRange, animate?: boolean) => void
  onReset?: () => void
  onDragStart?: () => ChartNavigatorRange
  withExemptCard?: boolean
  infoDisclosure?: boolean
}

/** The navigator inside a chart card (wheel surface) with a plot and a label band, as on the site. */
function Harness({ source, variant, overview, presets, onChange = () => {}, onReset = () => {}, onDragStart, withExemptCard, infoDisclosure }: HarnessProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  return (
    <div ref={surfaceRef} data-testid="surface">
      <div ref={plotRef} data-testid="plot" />
      <div data-testid="labels" />
      {withExemptCard ? (
        <div data-chart-wheel-exempt="" data-testid="bucket-card">
          <span data-testid="bucket-card-row">row</span>
        </div>
      ) : null}
      <ChartNavigator
        pointCount={POINTS}
        startIndex={0}
        endIndex={SPAN}
        startLabel="start"
        endLabel="end"
        wheelSurfaceRef={surfaceRef}
        wheelAnchor={() => plotRef.current}
        presets={presets}
        viewportSource={source}
        variant={variant}
        overview={overview}
        onChange={onChange}
        onReset={onReset}
        onDragStart={onDragStart}
        infoDisclosure={infoDisclosure}
      />
      <button type="button">outside</button>
    </div>
  )
}

const rectAt = (top: number, height: number) => ({
  left: 0, right: WIDTH, top, bottom: top + height, width: WIDTH, height, x: 0, y: top, toJSON: () => ({}),
}) as DOMRect

/** Wheel event times keep growing across tests, like one page session. */
let clock = 50_000

function mount(props: HarnessProps) {
  clock += 100_000
  const onRender = vi.fn()
  const view = render(
    <Profiler id="navigator" onRender={onRender}>
      <Harness {...props} />
    </Profiler>,
  )
  const surface = screen.getByTestId('surface')
  const plot = screen.getByTestId('plot')
  const labels = screen.getByTestId('labels')
  const navigator = view.container.querySelector<HTMLElement>('[data-hub-chart-navigator]')!
  const track = navigator.querySelector<HTMLElement>('.hx-chart-navigator__track')!
  const trackShell = navigator.querySelector<HTMLElement>('.hx-chart-navigator__track-shell')!
  const windowEl = navigator.querySelector<HTMLElement>('.hx-chart-navigator__window')!
  const rects = {
    surface: vi.fn(() => rectAt(0, 420)),
    plot: vi.fn(() => rectAt(PLOT_TOP, PLOT_BOTTOM - PLOT_TOP)),
    track: vi.fn(() => rectAt(340, 30)),
    trackShell: vi.fn(() => rectAt(340, 30)),
  }
  Object.defineProperty(surface, 'getBoundingClientRect', { configurable: true, value: rects.surface })
  Object.defineProperty(plot, 'getBoundingClientRect', { configurable: true, value: rects.plot })
  Object.defineProperty(track, 'getBoundingClientRect', { configurable: true, value: rects.track })
  Object.defineProperty(trackShell, 'getBoundingClientRect', { configurable: true, value: rects.trackShell })
  /** One wheel event over the plot (by position); returns it (defaultPrevented = taken from the page). */
  const wheel = (init: WheelEventInit & { target?: Element }, gapMs = 8) => {
    clock += gapMs
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: WIDTH / 2, clientY: 150, ...init })
    Object.defineProperty(event, 'timeStamp', { value: clock })
    act(() => { (init.target ?? plot).dispatchEvent(event) })
    return event
  }
  const windowAttr = () => navigator.getAttribute('data-hub-chart-navigator-window')
  return { ...view, onRender, surface, plot, labels, navigator, track, windowEl, rects, wheel, windowAttr }
}

const percent = (index: number) => `${(index / SPAN) * 100}%`

describe('ChartNavigator with a viewport store', () => {
  it('moves the window, grips and data-chart-viewport-* on every store frame without a React commit', () => {
    const store = createFakeStore()
    const { navigator, windowEl, onRender } = mount({ source: store.source, variant: 'd3' })
    expect(navigator.getAttribute('data-chart-viewport-start')).toBe('0')
    expect(navigator.getAttribute('data-chart-viewport-end')).toBe(String(SPAN))
    const startGrip = navigator.querySelector<HTMLElement>('.spc-nav__grip--start')!
    const endGrip = navigator.querySelector<HTMLElement>('.spc-nav__grip--end')!
    const commitsBefore = onRender.mock.calls.length
    // An eased zoom: 30 frames from the full range towards 60..179.
    for (let frame = 1; frame <= 30; frame++) {
      const k = frame / 30
      const visual = { startIndex: 60 * k + 0.0004, endIndex: SPAN - (SPAN - 179) * k }
      store.frame(visual)
      expect(windowEl.style.left).toBe(percent(visual.startIndex))
      expect(windowEl.style.width).toBe(`${Math.max(1, (visual.endIndex / SPAN) * 100 - (visual.startIndex / SPAN) * 100)}%`)
      expect(startGrip.style.left).toBe(percent(visual.startIndex))
      expect(endGrip.style.left).toBe(percent(visual.endIndex))
      expect(navigator.getAttribute('data-chart-viewport-start')).toBe(String(Math.round(visual.startIndex * 1000) / 1000))
      expect(navigator.getAttribute('data-chart-viewport-end')).toBe(String(Math.round(visual.endIndex * 1000) / 1000))
    }
    // Fractional frames are written with at most 3 decimals.
    store.frame({ startIndex: 10.123456, endIndex: 100.98765 })
    expect(navigator.getAttribute('data-chart-viewport-start')).toBe('10.123')
    expect(navigator.getAttribute('data-chart-viewport-end')).toBe('100.988')
    expect(onRender.mock.calls.length - commitsBefore).toBe(0)
  })

  it('renders once per target change, sends every input to setTarget and calls onChange only on settle', () => {
    const store = createFakeStore()
    const onChange = vi.fn()
    const onDragStart = vi.fn(() => ({ startIndex: 0, endIndex: SPAN }))
    const { navigator, track, windowEl, onRender, wheel, windowAttr } = mount({ source: store.source, variant: 'd3', onChange, onDragStart })

    // Zoom in (+) eases to the middle half.
    let commits = onRender.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(store.setTarget).toHaveBeenLastCalledWith({ startIndex: 60, endIndex: 179 }, { animate: true })
    expect(onRender.mock.calls.length - commits).toBe(1)
    expect(windowAttr()).toBe('60:179')
    expect(navigator.querySelector('.hx-chart-navigator__bucket-count')!.textContent).toBe('120 of 240 buckets')
    expect(onChange).not.toHaveBeenCalled()

    // Frames move the window but never call onChange; the settle does, once.
    store.frame({ startIndex: 30, endIndex: 200 })
    expect(onChange).not.toHaveBeenCalled()
    store.settle()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith({ startIndex: 60, endIndex: 179 }, false)

    // The wheel over the plot composes on the store's target.
    commits = onRender.mock.calls.length
    const event = wheel({ deltaY: -100 })
    expect(event.defaultPrevented).toBe(true)
    const [wheelTarget, wheelOptions] = store.setTarget.mock.lastCall!
    expect(wheelOptions).toEqual({ animate: true })
    expect(wheelTarget.endIndex - wheelTarget.startIndex).toBeLessThan(119)
    expect(onRender.mock.calls.length - commits).toBe(1)
    expect(onChange).toHaveBeenCalledTimes(1)
    const afterWheel = { ...wheelTarget }

    // Zoom out (-).
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    const [outTarget] = store.setTarget.mock.lastCall!
    expect(outTarget.endIndex - outTarget.startIndex).toBeGreaterThan(afterWheel.endIndex - afterWheel.startIndex)
    store.settle()
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenLastCalledWith(outTarget, false)

    // A track click centres the same span on the clicked step.
    const count = outTarget.endIndex - outTarget.startIndex + 1
    fireEvent.pointerDown(track, { pointerId: 3, button: 0, clientX: 800 })
    fireEvent.pointerUp(track, { pointerId: 3, clientX: 800 })
    const [clickTarget, clickOptions] = store.setTarget.mock.lastCall!
    expect(clickOptions).toEqual({ animate: true })
    expect(clickTarget.endIndex - clickTarget.startIndex + 1).toBe(count)
    const clicked = Math.round(0.8 * SPAN)
    const expectedStart = Math.min(POINTS - count, Math.max(0, Math.round(clicked - (count - 1) / 2)))
    expect(clickTarget.startIndex).toBe(expectedStart)
    store.settle()

    // Dragging the window pans from the store's target, not from the host's
    // onDragStart range (which is still called), without easing.
    const base = store.source.getTarget()
    onDragStart.mockClear()
    fireEvent.pointerDown(windowEl, { pointerId: 7, button: 0, clientX: 300 })
    expect(onDragStart).toHaveBeenCalledTimes(1)
    fireEvent.pointerMove(windowEl, { pointerId: 7, clientX: 200 })
    const steps = Math.round((-100 / WIDTH) * SPAN)
    expect(store.setTarget).toHaveBeenLastCalledWith(
      { startIndex: base.startIndex + steps, endIndex: base.endIndex + steps },
      { animate: false },
    )
    fireEvent.pointerUp(windowEl, { pointerId: 7, clientX: 200 })
    const settledBefore = onChange.mock.calls.length
    store.settle()
    expect(onChange).toHaveBeenCalledTimes(settledBefore + 1)
  })

  it('resets through the store and the host (Reset, Escape, double-click)', () => {
    const store = createFakeStore({ startIndex: 60, endIndex: 179 })
    const onReset = vi.fn()
    const { track } = mount({ source: store.source, variant: 'd3', onReset })
    const reset = screen.getByRole('button', { name: 'Reset zoom' })
    expect(reset.textContent).toBe('Reset')
    fireEvent.click(reset)
    expect(store.setTarget).toHaveBeenLastCalledWith({ startIndex: 0, endIndex: SPAN }, { animate: true })
    expect(onReset).toHaveBeenCalledTimes(1)
    act(() => store.source.setTarget({ startIndex: 10, endIndex: 50 }))
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Chart view start' }), { key: 'Escape' })
    expect(store.setTarget).toHaveBeenLastCalledWith({ startIndex: 0, endIndex: SPAN }, { animate: true })
    expect(onReset).toHaveBeenCalledTimes(2)
    act(() => store.source.setTarget({ startIndex: 10, endIndex: 50 }))
    fireEvent.doubleClick(track)
    expect(store.setTarget).toHaveBeenLastCalledWith({ startIndex: 0, endIndex: SPAN }, { animate: true })
    expect(onReset).toHaveBeenCalledTimes(3)
  })

  it('unsubscribes from the store on unmount', () => {
    const store = createFakeStore()
    const { unmount } = mount({ source: store.source, variant: 'd3' })
    expect(store.listenerCounts()).toEqual({ target: 1, frame: 1, settle: 1 })
    unmount()
    expect(store.listenerCounts()).toEqual({ target: 0, frame: 0, settle: 0 })
  })
})

describe('ChartNavigator variant d3', () => {
  const overview: ChartNavigatorOverview = { d: 'M0 22L0 10L500 4L1000 22Z', width: WIDTH, height: 22 }

  it('draws the overview silhouette behind the window', () => {
    const { navigator, track, windowEl } = mount({ variant: 'd3', overview })
    const svg = track.querySelector('svg[data-chart-navigator-overview]')!
    expect(svg).not.toBeNull()
    expect(svg.getAttribute('viewBox')).toBe('0 0 1000 22')
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    const path = svg.querySelector('path')!
    expect(path.getAttribute('d')).toBe(overview.d)
    expect(path.getAttribute('fill')).toBe('#8e8e96')
    // The attribute name is joined at run time: check-analytics-tailwind scans test
    // files too and would read the hyphenated literal as a Tailwind fill class.
    expect(path.getAttribute(['fill', 'opacity'].join('-'))).toBe('0.28')
    // Drawn first, so the window and grips paint over it; it never takes the pointer.
    expect(svg.compareDocumentPosition(windowEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect((svg as SVGElement).style.pointerEvents).toBe('none')
    cleanup()
    const plain = mount({ variant: 'd3', overview: null })
    expect(plain.navigator.querySelector('[data-chart-navigator-overview]')).toBeNull()
    expect(navigator.isConnected).toBe(false)
  })

  it('is styled only through .spc-nav, keeps Scroll zoom on by default and adds no preset buttons', () => {
    const { navigator } = mount({ variant: 'd3', overview, presets: [{ label: '1 h', pointCount: 10 }, { label: '6 h', pointCount: 60 }] })
    expect(navigator.classList.contains('spc-nav')).toBe(true)
    expect(navigator.classList.contains('hx-chart-navigator')).toBe(true)
    expect(navigator.getAttribute('data-chart-navigator-variant')).toBe('d3')
    // No preset buttons.
    expect(screen.queryByRole('button', { name: '1 h' })).toBeNull()
    expect(screen.queryByRole('button', { name: '6 h' })).toBeNull()
    // One control row: readout, hint, then - / + / Reset / Scroll zoom.
    const actions = navigator.querySelector('.hx-chart-navigator__actions')!
    const hint = navigator.querySelector('.hx-chart-navigator__hint')!
    expect(actions.contains(hint)).toBe(true)
    expect(hint.textContent).toBe('Scroll over the chart to zoom · Shift + scroll to pan · Drag the purple bar to pick a span')
    const toolbar = navigator.querySelector('.hx-chart-navigator__toolbar')!
    const buttons = Array.from(toolbar.querySelectorAll('button'))
    expect(buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual([
      'Zoom out', 'Zoom in', 'Reset zoom', 'Scroll zoomOn',
    ])
    const toggle = screen.getByRole('button', { name: /Scroll zoom/ })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(toggle.querySelector('.hx-chart-navigator__scroll-state')!.textContent).toBe('On')
    expect(toggle.querySelector('svg')).toBeNull()
    // Inline styles are positions only (the look lives in sp-navigator.css).
    const styled = Array.from(navigator.querySelectorAll<HTMLElement | SVGElement>('[style]'))
    for (const element of styled) {
      const props = Array.from(element.style).sort()
      const allowed = element.matches('[data-chart-navigator-overview]')
        ? ['display', 'height', 'left', 'overflow', 'pointer-events', 'position', 'top', 'width']
        : ['left', 'width']
      for (const prop of props) expect(allowed).toContain(prop)
    }
  })

  it('never greys out - / + / Reset (as the design); one that cannot act is aria-disabled and does nothing', () => {
    const store = createFakeStore()
    const onReset = vi.fn()
    mount({ source: store.source, variant: 'd3', onReset })
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' })
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' })
    const reset = screen.getByRole('button', { name: 'Reset zoom' })
    for (const button of [zoomOut, zoomIn, reset]) expect(button.hasAttribute('disabled')).toBe(false)
    // Full range: - and Reset cannot act.
    expect(zoomOut.getAttribute('aria-disabled')).toBe('true')
    expect(reset.getAttribute('aria-disabled')).toBe('true')
    expect(zoomIn.hasAttribute('aria-disabled')).toBe(false)
    fireEvent.click(zoomOut)
    fireEvent.click(reset)
    expect(store.setTarget).not.toHaveBeenCalled()
    expect(onReset).not.toHaveBeenCalled()
    // Zoomed: all three act.
    act(() => store.source.setTarget({ startIndex: 60, endIndex: 179 }))
    store.setTarget.mockClear()
    expect(zoomOut.hasAttribute('aria-disabled')).toBe(false)
    expect(reset.hasAttribute('aria-disabled')).toBe(false)
    fireEvent.click(reset)
    expect(store.setTarget).toHaveBeenLastCalledWith({ startIndex: 0, endIndex: SPAN }, { animate: true })
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('infoDisclosure (session): the hint and Scroll zoom sit in an (i); Reset hides at the full range', () => {
    const store = createFakeStore()
    const { navigator } = mount({ source: store.source, variant: 'd3', infoDisclosure: true })
    const toolbar = navigator.querySelector('.hx-chart-navigator__toolbar')!
    const info = screen.getByRole('button', { name: 'How to zoom and pan the chart' })
    expect(toolbar.contains(info)).toBe(true)
    expect(info.getAttribute('aria-expanded')).toBe('false')
    const panel = document.getElementById(info.getAttribute('aria-controls')!)!
    expect(panel.hidden).toBe(true)
    // Nothing of the hint or the toggle shows in the row itself.
    expect(screen.queryByRole('button', { name: /Scroll zoom/ })).toBeNull()
    expect(panel.querySelector('.hx-chart-navigator__hint')!.textContent).toBe('Scroll over the chart to zoom · Shift + scroll to pan · Drag the purple bar to pick a span')
    // Reset is marked to hide (sp-navigator.css) while the whole range shows.
    const reset = screen.getByRole('button', { name: 'Reset zoom' })
    expect(reset.classList.contains('spc-nav__reset')).toBe(true)
    expect(navigator.classList.contains('is-full-range')).toBe(true)
    act(() => store.source.setTarget({ startIndex: 60, endIndex: 179 }))
    expect(navigator.classList.contains('is-full-range')).toBe(false)

    fireEvent.click(info)
    expect(info.getAttribute('aria-expanded')).toBe('true')
    expect(panel.hidden).toBe(false)
    const toggle = screen.getByRole('button', { name: /Scroll zoom/ })
    expect(panel.contains(toggle)).toBe(true)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(panel.querySelector('.hx-chart-navigator__hint')!.textContent).toMatch(/^Scroll zoom is off/)
    // Escape closes it first (not the chart's restore-full-range) and focus goes back to the (i).
    toggle.focus()
    fireEvent.keyDown(toggle, { key: 'Escape' })
    expect(panel.hidden).toBe(true)
    expect(document.activeElement).toBe(info)
    expect(store.source.getTarget()).toEqual({ startIndex: 60, endIndex: 179 })
    // An outside press closes it too.
    fireEvent.click(info)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }))
    expect(panel.hidden).toBe(true)
    // Reset used: focus moves to Zoom in as Reset hides.
    reset.focus()
    fireEvent.click(reset)
    expect(navigator.classList.contains('is-full-range')).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Zoom in' }))
  })

  it('leaves the default markup unchanged', () => {
    const { navigator } = mount({})
    expect(navigator.classList.contains('spc-nav')).toBe(false)
    expect(navigator.hasAttribute('data-chart-navigator-variant')).toBe(false)
    expect(navigator.hasAttribute('data-chart-viewport-start')).toBe(false)
    expect(navigator.querySelector('[data-chart-navigator-overview], .spc-nav__grip, .spc-nav__sep')).toBeNull()
    const toolbar = navigator.querySelector('.hx-chart-navigator__toolbar')!
    expect(Array.from(toolbar.querySelectorAll('button')).map((button) => button.textContent)).toEqual([
      'Zoom in', 'Zoom out', 'Reset zoom', 'Scroll zoomOn',
    ])
    expect(toolbar.querySelector('.lucide-mouse')).not.toBeNull()
    // The hint stays its own line below the actions row.
    const hint = navigator.querySelector('.hx-chart-navigator__hint')!
    expect(hint.parentElement).toBe(navigator)
    expect(navigator.querySelector('.hx-chart-navigator__actions')!.contains(hint)).toBe(false)
  })
})

describe('chart wheel exemption', () => {
  it('passes the wheel to the page over an open bucket card ([data-chart-wheel-exempt])', () => {
    const store = createFakeStore()
    const { wheel, plot } = mount({ source: store.source, variant: 'd3', withExemptCard: true })
    const row = screen.getByTestId('bucket-card-row')
    expect(isChartWheelExempt(row)).toBe(true)
    expect(isChartWheelExempt(plot)).toBe(false)
    // Over the plot box, but inside the card: the page keeps it.
    expect(wheel({ deltaY: -100, target: row }).defaultPrevented).toBe(false)
    expect(store.setTarget).not.toHaveBeenCalled()
    expect(wheelZoneContains(screen.getByTestId('surface'), null, plot, WIDTH / 2, 150, row)).toBe(false)
    expect(wheelZoneContains(screen.getByTestId('surface'), null, plot, WIDTH / 2, 150, plot)).toBe(true)
    // After the page scroll has stopped, the plot itself still zooms.
    expect(wheel({ deltaY: -100 }, 600).defaultPrevented).toBe(true)
    expect(store.setTarget).toHaveBeenCalledTimes(1)
  })

  it('passes the wheel over an exempt card without a store too', () => {
    const { wheel, windowAttr } = mount({ withExemptCard: true })
    const row = screen.getByTestId('bucket-card-row')
    expect(wheel({ deltaY: -100, target: row }).defaultPrevented).toBe(false)
    expect(windowAttr()).toBe(`0:${SPAN}`)
  })
})

describe('wheel layout reads', () => {
  it('reads the card, plot and inner-list styles once per gesture', () => {
    const store = createFakeStore()
    const { wheel, labels, rects } = mount({ source: store.source, variant: 'd3' })
    const computed = vi.spyOn(globalThis, 'getComputedStyle')
    const labelStyleReads = () => computed.mock.calls.filter(([element]) => element === labels).length
    // One gesture: ten notches over the label band's element, over the plot box.
    for (let i = 0; i < 10; i++) expect(wheel({ deltaY: -40, target: labels }).defaultPrevented).toBe(true)
    expect(store.setTarget).toHaveBeenCalled()
    expect(rects.surface).toHaveBeenCalledTimes(1)
    expect(rects.plot).toHaveBeenCalledTimes(1)
    expect(labelStyleReads()).toBe(1)

    // After the gesture gap, the next gesture measures again.
    wheel({ deltaY: -40, target: labels }, 1600)
    expect(rects.surface).toHaveBeenCalledTimes(2)
    expect(rects.plot).toHaveBeenCalledTimes(2)
    expect(labelStyleReads()).toBe(2)
    wheel({ deltaY: -40, target: labels })
    expect(rects.surface).toHaveBeenCalledTimes(2)

    // A scroll anywhere, or a window resize, re-measures within a gesture.
    act(() => { window.dispatchEvent(new Event('scroll')) })
    wheel({ deltaY: -40, target: labels })
    expect(rects.surface).toHaveBeenCalledTimes(3)
    act(() => { window.dispatchEvent(new Event('resize')) })
    wheel({ deltaY: -40, target: labels })
    expect(rects.surface).toHaveBeenCalledTimes(4)
    expect(rects.plot).toHaveBeenCalledTimes(4)
  })

  it('reads the navigator track once per gesture', () => {
    const store = createFakeStore()
    const { wheel, track, rects } = mount({ source: store.source, variant: 'd3' })
    for (let i = 0; i < 8; i++) wheel({ deltaY: -40, target: track, clientY: 355 })
    expect(store.setTarget).toHaveBeenCalled()
    expect(rects.track).toHaveBeenCalledTimes(1)
    expect(rects.trackShell.mock.calls.length + rects.surface.mock.calls.length).toBeLessThanOrEqual(2)
  })
})
