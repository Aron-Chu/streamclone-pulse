import { act, fireEvent, render } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HubActivityPoint } from '../src/lib/publicHub'
import {
  getHubBucketSelectionSnapshot,
  getHubChartBridge,
  isHubGestureActive,
  resetHubBucketSelectionForTests,
  selectHubBucket,
} from '../src/lib/hubBucketSelection'
import { resetSpPerfForTests } from '@streampulse/pulse-charts/perfMarks'
import { HubActivityChart } from '../src/ui/components/hub/HubActivityChartV5'

const MIN = 60_000
const BUCKET = 6 * MIN
const END = Date.UTC(2026, 9, 13, 18, 0, 0)
const START = END - 239 * BUCKET
const BOX_WIDTH = 1600
const PLOT_WIDTH = BOX_WIDTH - 68
const PX_PER_BUCKET = PLOT_WIDTH / 240

function day(): HubActivityPoint[] {
  return Array.from({ length: 240 }, (_, index) => ({
    t: START + index * BUCKET,
    chat: (100 + ((index * 37) % 200)) * 6,
    emotes: (40 + ((index * 13) % 80)) * 6,
    seventv: (20 + ((index * 7) % 20)) * 6,
    viewers: 200_000 + index * 100,
    hasChatRollup: true,
    hasViewerRollup: true,
    bucketComplete: true,
    viewerCoverage: 'complete',
    viewerContributors: 80,
    viewerExpectedContributors: 100,
  }))
}

let clientWidth: PropertyDescriptor | undefined
beforeAll(() => {
  clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => BOX_WIDTH })
})
afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth)
})
afterEach(() => {
  resetHubBucketSelectionForTests()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderDay(props: Partial<Parameters<typeof HubActivityChart>[0]> = {}) {
  const view = render(<HubActivityChart points={day()} windowMinutes={1440} channelCount={100} bucketMinutes={6} {...props} />)
  const plot = () => view.container.querySelector('svg[data-bench-plot]') as SVGSVGElement
  const click = (index: number) => act(() => {
    plot().dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: (index + 0.5) * PX_PER_BUCKET }))
  })
  const key = (k: string) => act(() => {
    plot().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
  const navigatorWindow = () => view.container.querySelector('[data-hub-chart-navigator]')!.getAttribute('data-hub-chart-navigator-window')
  return { ...view, plot, click, key, navigatorWindow }
}

describe('bar click and the shared hub bucket selection', () => {
  it('selects the clicked bar, marks it on the plot, and a second click clears it', () => {
    const { plot, click } = renderDay()
    click(100)
    const selection = getHubBucketSelectionSnapshot().selection!
    expect(selection).toMatchObject({ t: START + 100 * BUCKET, endT: START + 101 * BUCKET, barMinutes: 6, source: 'bar' })
    expect(plot().hasAttribute('data-selection')).toBe(true)
    click(100)
    expect(getHubBucketSelectionSnapshot().selection).toBeNull()
    expect(plot().hasAttribute('data-selection')).toBe(false)
  })

  it('swaps to another bar on a click elsewhere', () => {
    const { click } = renderDay()
    click(100)
    click(140)
    expect(getHubBucketSelectionSnapshot().selection!.t).toBe(START + 140 * BUCKET)
  })

  it('closes the selection on Escape', () => {
    const { click, key } = renderDay()
    click(50)
    key('Escape')
    expect(getHubBucketSelectionSnapshot().selection).toBeNull()
  })

  it('selects from the keyboard cursor with Enter (source keyboard)', () => {
    const { key } = renderDay()
    key('ArrowLeft')
    key('Enter')
    expect(getHubBucketSelectionSnapshot().selection).toMatchObject({ source: 'keyboard' })
  })

  it('never selects on hover', () => {
    const { plot } = renderDay()
    act(() => {
      const move = new Event('pointermove', { bubbles: true })
      Object.defineProperties(move, { clientX: { value: 300 }, clientY: { value: 100 }, pointerType: { value: 'mouse' } })
      plot().dispatchEvent(move)
    })
    expect(getHubBucketSelectionSnapshot().selection).toBeNull()
  })

  it('selects a page-picked bucket as latest and pans the zoomed chart to it', () => {
    const { container, rerender, navigatorWindow } = renderDay()
    // zoom in from the toolbar so the view is narrower than the window
    for (let step = 0; step < 4; step += 1) act(() => { fireEvent.click(container.querySelector('button[aria-label="Zoom in"]')!) })
    const [start, end] = navigatorWindow()!.split(':').map(Number)
    expect(end! - start!).toBeLessThan(239)
    const target = 10
    expect(target < start! || target > end!).toBe(true)
    rerender(<HubActivityChart points={day()} windowMinutes={1440} channelCount={100} bucketMinutes={6} selectedBucketT={START + target * BUCKET} />)
    expect(getHubBucketSelectionSnapshot().selection).toMatchObject({ t: START + target * BUCKET, source: 'latest' })
    const [panStart, panEnd] = navigatorWindow()!.split(':').map(Number)
    expect(panEnd! - panStart!).toBe(end! - start!)
    expect(target >= panStart! && target <= panEnd!).toBe(true)
  })

  it('pans for a latest selection made elsewhere (Latest moments)', () => {
    const { container, navigatorWindow } = renderDay()
    for (let step = 0; step < 4; step += 1) act(() => { fireEvent.click(container.querySelector('button[aria-label="Zoom in"]')!) })
    act(() => selectHubBucket({ t: START + 5 * BUCKET, endT: START + 6 * BUCKET, barMinutes: 6, source: 'latest' }))
    const [panStart, panEnd] = navigatorWindow()!.split(':').map(Number)
    expect(5 >= panStart! && 5 <= panEnd!).toBe(true)
  })

  it('drops the selection when the window changes', () => {
    const { click, rerender } = renderDay()
    click(30)
    expect(getHubBucketSelectionSnapshot().selection).not.toBeNull()
    rerender(<HubActivityChart points={day()} windowMinutes={10080} channelCount={100} bucketMinutes={6} />)
    expect(getHubBucketSelectionSnapshot().selection).toBeNull()
  })
})

describe('chart bridge and gesture flag', () => {
  it('registers the bridge with plot-local x, the plot element and pan, and removes it on unmount', () => {
    const { container, unmount, navigatorWindow } = renderDay()
    const bridge = getHubChartBridge()!
    expect(bridge).toBeTruthy()
    expect(bridge.plotElement()).toBe(container.querySelector('[data-hub-plot-box]'))
    expect(bridge.xOfMs(START + 120 * BUCKET)).toBeCloseTo(120 * PX_PER_BUCKET, 0)
    expect(bridge.xOfMs(START - 10 * BUCKET)).toBeNull()
    const frames = vi.fn()
    const off = bridge.subscribeFrame(frames)
    for (let step = 0; step < 4; step += 1) act(() => { fireEvent.click(container.querySelector('button[aria-label="Zoom in"]')!) })
    act(() => bridge.panToMs(START + 3 * BUCKET))
    const [start, end] = navigatorWindow()!.split(':').map(Number)
    expect(3 >= start! && 3 <= end!).toBe(true)
    off()
    unmount()
    expect(getHubChartBridge()).toBeNull()
  })

  it('sets the gesture flag and the wheel marks from start to settle', async () => {
    resetSpPerfForTests()
    const marks: string[] = []
    if (typeof performance.mark !== 'function') (performance as unknown as { mark: () => void }).mark = () => undefined
    vi.spyOn(performance, 'mark').mockImplementation(((name: string) => void marks.push(name)) as unknown as typeof performance.mark)
    // jsdom paints nothing: run animation frames on a 16 ms timer so the store can settle.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
    const { container } = renderDay()
    expect(isHubGestureActive()).toBe(false)
    act(() => { fireEvent.click(container.querySelector('button[aria-label="Zoom in"]')!) })
    expect(isHubGestureActive()).toBe(true)
    expect(marks).toContain('sp:wheel-start')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)) })
    expect(isHubGestureActive()).toBe(false)
    expect(marks).toContain('sp:wheel-settle')
    const stack = container.querySelector('.hx-plot-stack')!
    const navigator = container.querySelector('[data-hub-chart-navigator]')!
    expect(`${stack.getAttribute('data-hub-chart-viewport-start')}:${stack.getAttribute('data-hub-chart-viewport-end')}`)
      .toBe(navigator.getAttribute('data-hub-chart-navigator-window'))
  })
})

describe('navigator', () => {
  it('zooms in and resets from the toolbar; the readout counts buckets and the bar level', () => {
    const { container, navigatorWindow } = renderDay()
    const count = () => container.querySelector('.hx-chart-navigator__bucket-count')!.textContent
    expect(count()).toBe('240 of 240 6-min buckets · bars 6-min')
    act(() => { fireEvent.click(container.querySelector('button[aria-label="Zoom in"]')!) })
    expect(navigatorWindow()).not.toBe('0:239')
    expect(count()).toMatch(/^\d+ of 240 6-min buckets/)
    act(() => { fireEvent.click(container.querySelector('button[aria-label="Reset zoom"]')!) })
    expect(navigatorWindow()).toBe('0:239')
  })

  it('zooms in to two served buckets (the prod floor, wave-1 wheel matrix) and no closer', () => {
    const { container, navigatorWindow } = renderDay()
    const zoomIn = () => container.querySelector('button[aria-label="Zoom in"]') as HTMLButtonElement
    for (let step = 0; step < 40; step += 1) act(() => { fireEvent.click(zoomIn()) })
    const [start, end] = navigatorWindow()!.split(':').map(Number)
    expect(end! - start! + 1).toBe(2)
    // the d3 navigator keeps the button focusable and marks the floor with aria-disabled
    expect(zoomIn().getAttribute('aria-disabled')).toBe('true')
  })
})
