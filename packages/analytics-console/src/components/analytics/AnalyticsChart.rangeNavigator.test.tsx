import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsStreamDetail } from '../../api.ts'
import AnalyticsChart from './AnalyticsChart.tsx'
import { resetChartWheelGuard } from './ChartNavigator.tsx'
import { scrollZoomToggle } from './__fixtures__/sessionChartHarness.ts'
import {
  sessionNavigatorIndexForOffset,
  sessionNavigatorPointCount,
  sessionNavigatorPresets,
  sessionNavigatorRangeForViewport,
  sessionViewportForNavigatorRange,
} from '../../utils/sessionChartNavigator.ts'

const motion = vi.hoisted(() => ({ enabled: false }))
vi.mock('../../hooks/useConsoleMotion.ts', () => ({
  useConsoleMotion: () => ({ motionEnabled: motion.enabled }),
}))

function detailWithMinutes(minuteCount: number): AnalyticsStreamDetail {
  return {
    stream: {
      streamId: 'rail-chart-stream',
      startedAt: '2026-07-31T00:00:00.000Z',
      peakViewers: 200,
      avgViewers: 120,
    },
    rollups: Array.from({ length: minuteCount }, (_, index) => ({
      minuteTs: new Date(Date.parse('2026-07-31T00:00:00.000Z') + index * 60_000).toISOString(),
      viewerAvg: 100 + (index % 40),
      chatCount: 10 + (index % 12),
      totalEmoteCount: 2 + (index % 9),
      emotes: { Kappa: 4 + (index % 8) },
    })),
    topEmotes: [{ key: 'Kappa', name: 'Kappa', count: 11, provider: '7tv' }],
    sources: [],
  } as unknown as AnalyticsStreamDetail
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); motion.enabled = false })

function renderChart(minuteCount: number) {
  return render(
    <AnalyticsChart
      detail={detailWithMinutes(minuteCount)}
      selectedEmotes={new Set()}
      onSelectEmote={vi.fn()}
      selectedRollup={null}
      onSelectRollup={vi.fn()}
      viewMode="overview"
      onViewModeChange={vi.fn()}
    />,
  )
}

/** Click the navigator track without dragging (jsdom has no layout: 10px per step on a 91-minute chart). */
function clickNavigatorTrack(container: HTMLElement, clientX: number) {
  const track = container.querySelector<HTMLElement>('.hx-chart-navigator__track')!
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 900 } as DOMRect)
  const target = container.querySelector<HTMLElement>('.hx-chart-navigator__window')!
  fireEvent.pointerDown(target, { pointerId: 3, button: 0, clientX })
  fireEvent.pointerUp(target, { pointerId: 3, clientX })
}

const navigatorWindowSpan = (container: HTMLElement) => {
  const [startIndex, endIndex] = container.querySelector('[data-hub-chart-navigator]')!
    .getAttribute('data-hub-chart-navigator-window')!.split(':').map(Number)
  return endIndex! - startIndex! + 1
}

const navigatorHeading = (container: HTMLElement) =>
  container.querySelector('[data-hub-chart-navigator] strong')?.textContent

const viewportOf = (container: HTMLElement) => {
  const plot = container.querySelector('[data-chart-touch-action]')!
  return [
    Number(plot.getAttribute('data-chart-viewport-start')),
    Number(plot.getAttribute('data-chart-viewport-end')),
  ]
}

describe('session navigator mapping', () => {
  // The plot ends on the start of its last minute, so a 91-minute stream
  // (minutes 0..90) spans 90 * 60 seconds and has 91 steps, one per minute.
  it('counts the plotted minutes and round-trips the full stream', () => {
    expect(sessionNavigatorPointCount(90 * 60, 0)).toBe(91)
    const full = sessionNavigatorRangeForViewport({ startSeconds: 0, endSeconds: 90 * 60 }, 90 * 60, 0)
    expect(full).toEqual({ startIndex: 0, endIndex: 90 })
    expect(sessionViewportForNavigatorRange(full, 90 * 60, 0)).toEqual({ startSeconds: 0, endSeconds: 90 * 60 })
  })

  it('maps a zoomed window to the minutes at its edges and back, so the purple window spans what the plot shows', () => {
    const range = sessionNavigatorRangeForViewport({ startSeconds: 600, endSeconds: 1500 }, 90 * 60, 0)
    expect(range).toEqual({ startIndex: 10, endIndex: 25 })
    expect(sessionViewportForNavigatorRange(range, 90 * 60, 0)).toEqual({ startSeconds: 600, endSeconds: 1500 })
    // Window position on the track (index / last index) equals the plot's share of the domain.
    const pointCount = sessionNavigatorPointCount(90 * 60, 0)
    expect(range.startIndex / (pointCount - 1)).toBeCloseTo(600 / (90 * 60))
    expect(range.endIndex / (pointCount - 1)).toBeCloseTo(1500 / (90 * 60))
  })

  it('counts from the first charted minute and clamps offsets', () => {
    expect(sessionNavigatorPointCount(3600, 600)).toBe(51)
    expect(sessionNavigatorIndexForOffset(605, 3600, 600)).toBe(0)
    expect(sessionNavigatorIndexForOffset(10_000, 3600, 600)).toBe(50)
    expect(sessionNavigatorIndexForOffset(null, 3600, 600)).toBeNull()
  })

  it('offers the hub-style one-click zoom sizes by stream length', () => {
    // A view m minutes long holds m + 1 minute steps.
    // Two hours or less: 15m first, then 1h (a 2h stream is 121 steps).
    expect(sessionNavigatorPresets(2 * 3600, 0)).toEqual([
      { label: '15m', pointCount: 16 },
      { label: '1h', pointCount: 61 },
    ])
    // Longer streams: 1h first, then 4h when it still fits.
    expect(sessionNavigatorPresets(3 * 3600, 0)).toEqual([{ label: '1h', pointCount: 61 }])
    expect(sessionNavigatorPresets(12 * 3600, 0)).toEqual([
      { label: '1h', pointCount: 61 },
      { label: '4h', pointCount: 241 },
    ])
    // A preset that is not smaller than the whole navigator is dropped.
    expect(sessionNavigatorPresets(45 * 60, 0)).toEqual([{ label: '15m', pointCount: 16 }])
    expect(sessionNavigatorPresets(15 * 60, 0)).toEqual([])
    // Spans count from the first charted minute.
    expect(sessionNavigatorPresets(70 * 60, 30 * 60)).toEqual([{ label: '15m', pointCount: 16 }])
  })
})

/** Hold animation frames; flush() runs them until the viewport store settles. */
function holdFrames() {
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  let clock = performance.now()
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(key => { frames.delete(key) })
  return () => {
    for (let round = 0; round < 100 && frames.size; round += 1) {
      clock += 1000
      act(() => {
        const pending = [...frames.values()]
        frames.clear()
        pending.forEach(callback => callback(clock))
      })
    }
  }
}

describe('AnalyticsChart range controls and navigator', () => {
  it('has one zoom UI: the shared navigator under the plot, plus the toolbar range seg', () => {
    const { container } = renderChart(91)
    // The old stream-only range row and its − / + buttons are gone.
    expect(container.querySelector('[data-chart-range-row]')).toBeNull()
    expect(container.querySelector('[data-chart-viewport-controls]')).toBeNull()
    expect(container.querySelector('[data-chart-viewport-readout]')).toBeNull()
    for (const name of ['Zoom chart in', 'Zoom chart out']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    // Presets live only in the toolbar's one range seg (D1), end-anchored.
    const seg = container.querySelector<HTMLElement>('[data-session-range-seg]')!
    for (const name of ['15m', '1h', 'Full']) {
      const buttons = screen.getAllByRole('button', { name })
      expect(buttons).toHaveLength(1)
      expect(seg.contains(buttons[0]!)).toBe(true)
    }
    const navigators = container.querySelectorAll('[data-hub-chart-navigator]')
    expect(navigators).toHaveLength(1)
    const stack = container.querySelector('[data-session-chart-stack]')!
    const plot = stack.querySelector('[data-chart-touch-action]')!
    expect(stack.contains(navigators[0]!)).toBe(true)
    expect(plot.compareDocumentPosition(navigators[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const host = container.querySelector<HTMLElement>('[data-session-chart-navigator]')!
    expect(host.className).not.toMatch(/\b(absolute|fixed|sticky)\b/)
    expect(navigators[0]!.getAttribute('data-chart-navigator-variant')).toBe('d3')
  })

  it('keeps the readout line and the games strip above the toolbar, ahead of the plot', () => {
    const { container } = renderChart(91)
    const card = container.querySelector<HTMLElement>('[data-session-chart-wheel-card]')!
    const games = container.querySelector<HTMLElement>('[data-chart-header-block]')!
    const part = container.querySelector<HTMLElement>('[data-session-chart-part]')!
    // The wheel card wraps the Games played strip and the chart part (D8).
    expect(card.contains(games)).toBe(true)
    expect(card.contains(part)).toBe(true)
    expect(games.compareDocumentPosition(part) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const focusBar = part.querySelector('[data-chart-focus-bar]')!
    const stack = part.querySelector('[data-session-chart-stack]')!
    // session-original: the readout line sits above Games played, inside the card.
    const hint = container.querySelector('[data-chart-selection-hint]')!
    expect(games.contains(hint)).toBe(true)
    expect(focusBar.contains(hint)).toBe(false)
    expect(focusBar.compareDocumentPosition(stack) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The banners, selected detail and the minute table stay outside the card.
    expect(card.contains(container.querySelector('#analytics-chart-help'))).toBe(false)
    expect(card.contains(container.querySelector('[data-chart-selected-detail-slot]'))).toBe(false)
    expect(card.contains(container.querySelector('[data-chart-data-alternative]'))).toBe(false)
  })

  it('mentions the plot zoom keys only to assistive tech', () => {
    const { container } = renderChart(91)
    expect(container.querySelector('#analytics-chart-help')?.textContent)
      .toContain('With the chart focused, + and − work like Zoom in and Zoom out and 0 like Reset zoom.')
  })

  it('zooms to the first preset around a click on the track at full range, as the hub does', () => {
    const { container } = renderChart(748)
    const track = container.querySelector<HTMLElement>('.hx-chart-navigator__track')!
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 747 } as DOMRect)
    const target = container.querySelector<HTMLElement>('.hx-chart-navigator__window')!
    fireEvent.pointerDown(target, { pointerId: 4, button: 0, clientX: 400 })
    fireEvent.pointerUp(target, { pointerId: 4, clientX: 400 })
    // 748 minutes is over 2h, so presets[0] is 1h: a 60-minute window (61 minute
    // steps, both edge minutes included) around minute 400.
    expect(navigatorWindowSpan(container)).toBe(61)
    const [start, end] = viewportOf(container)
    expect(end! - start!).toBe(60 * 60)
    expect(start!).toBeLessThanOrEqual(400 * 60)
    expect(end!).toBeGreaterThan(400 * 60)
    // The heading names the span, as on the hub.
    expect(navigatorHeading(container)).toBe('1 h')
  })

  it('hides the navigator below the five-minute interaction threshold', () => {
    const { container } = renderChart(4)
    expect(container.querySelector('[data-session-chart-navigator]')).toBeNull()
    expect(container.querySelector('[data-hub-chart-navigator]')).toBeNull()
  })

  it('uses the hub chart navigator (d3) under the plot for long streams', () => {
    const { container } = renderChart(91)
    const host = container.querySelector<HTMLElement>('[data-session-chart-navigator]')!
    expect(host).not.toBeNull()
    expect(host.closest('[data-session-chart-stack]')).not.toBeNull()
    expect(host.getAttribute('data-chart-range-state')).toBe('full')
    const navigator = host.querySelector('[data-hub-chart-navigator]')!
    expect(navigator.getAttribute('aria-label')).toBe('Chart navigator')
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('0:90')
    const start = screen.getByRole('slider', { name: 'Chart view start' })
    // The plot ends on its last minute (01:30:00).
    expect(start.getAttribute('aria-valuetext')).toBe('Start 00:00:00; showing 00:00:00 to 01:30:00')
    expect(screen.getByRole('slider', { name: 'Chart view end' })).not.toBeNull()
    expect(navigator.querySelector('strong')?.textContent).toBe('Full stream')
    expect(navigator.querySelector('.hx-chart-navigator__bucket-count')?.textContent).toBe(', 91 of 91 minutes')
    expect(navigator.querySelector('[data-chart-bar-size-label]')?.textContent).toBe('1-min bars')
    for (const name of ['Zoom in', 'Zoom out', 'Reset zoom']) {
      expect(screen.getByRole('button', { name })).not.toBeNull()
    }
    // The track draws the stream's activity silhouette (the overview).
    expect(navigator.querySelector('.hx-chart-navigator__overview')).not.toBeNull()
    // On by default, and remembered in this browser.
    expect(scrollZoomToggle(container).getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-chart-position-rail]')).toBeNull()
  })

  it('keeps the navigator after zooming, and names the zoomed span', () => {
    const { container } = renderChart(91)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(container.querySelector('[data-hub-chart-navigator]')).not.toBeNull()
    expect(container.querySelector('[data-session-chart-navigator]')?.getAttribute('data-chart-range-state'))
      .toBe('zoomed')
    const span = navigatorWindowSpan(container) - 1
    expect(navigatorHeading(container)).toBe(span < 60 ? `${span} min` : expect.any(String))
  })

  it('moves the plotted x-axis and the drawn range, not just the readout', () => {
    const { container } = renderChart(91)
    const axis = () =>
      [...container.querySelectorAll('[data-bench-axis] g')]
        .filter(tick => tick.getAttribute('visibility') === 'visible')
        .map(tick => tick.textContent)
    const transform = () => container.querySelector('g[data-spc-scaled]')?.getAttribute('transform')

    const fullAxis = axis()
    const fullTransform = transform()
    expect(fullAxis.length).toBeGreaterThan(1)

    // A click on the track zooms to the first preset (15m on a 91-minute stream).
    clickNavigatorTrack(container, 450)

    // The readout updating is not enough — a range control that reports a new
    // window while the plot stays put is worse than no control at all.
    expect(navigatorHeading(container)).toBe('15 min')
    expect(axis()).not.toEqual(fullAxis)
    expect(transform()).not.toBe(fullTransform)
    // 15 minutes long: 16 minute steps.
    expect(navigatorWindowSpan(container)).toBe(16)
  })

  it('drives the plotted viewport from the navigator sliders and resets', () => {
    const { container } = renderChart(91)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    const zoomed = viewportOf(container)
    const end = screen.getByRole('slider', { name: 'Chart view end' })
    fireEvent.keyDown(end, { key: 'ArrowLeft', shiftKey: true })
    const shrunk = viewportOf(container)
    expect(shrunk[1]! - shrunk[0]!).toBeCloseTo(zoomed[1]! - zoomed[0]! - 5 * 60, 0)

    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }))
    expect(viewportOf(container)).toEqual([0, 90 * 60])
    // Reset restores the full range and leaves the Scroll zoom choice alone.
    expect(scrollZoomToggle(container).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Reset zoom' }).getAttribute('aria-disabled')).toBe('true')
    expect(navigatorHeading(container)).toBe('Full stream')
  })

  it('keeps the plot under the pointer while the navigator window is dragged with motion on', () => {
    motion.enabled = true
    // Hold every animation frame: a tween would leave the plot on its old range.
    const flush = holdFrames()
    const { container } = renderChart(91)
    clickNavigatorTrack(container, 450)
    flush()
    const before = viewportOf(container)
    expect(before[1]! - before[0]!).toBe(15 * 60)

    const track = container.querySelector<HTMLElement>('.hx-chart-navigator__track')!
    const windowEl = container.querySelector<HTMLElement>('.hx-chart-navigator__window')!
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 900 } as DOMRect)
    // 90 navigator steps over 900px: 10px per minute.
    fireEvent.pointerDown(windowEl, { pointerId: 7, button: 0, clientX: 300 })
    for (const clientX of [400, 500, 600]) {
      fireEvent.pointerMove(windowEl, { pointerId: 7, clientX })
      const minutesMoved = (clientX - 300) / 10
      // No frame has run, so a tween would still show the previous window.
      expect(viewportOf(container)).toEqual([before[0]! + minutesMoved * 60, before[1]! + minutesMoved * 60])
    }
    fireEvent.pointerUp(windowEl, { pointerId: 7, clientX: 600 })
    expect(viewportOf(container)).toEqual([before[0]! + 30 * 60, before[1]! + 30 * 60])

    // Discrete controls still ease once the drag is over.
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }))
    expect(viewportOf(container)).not.toEqual([0, 90 * 60])
    flush()
    expect(viewportOf(container)).toEqual([0, 90 * 60])
  })

  it('Escape releases the pin first, then restores the full range, and never changes Scroll zoom', () => {
    const detail = detailWithMinutes(91)
    const onSelectRollup = vi.fn()
    const chart = (selectedRollup: (typeof detail.rollups)[number] | null) => (
      <AnalyticsChart
        detail={detail}
        selectedEmotes={new Set()}
        onSelectEmote={vi.fn()}
        selectedRollup={selectedRollup}
        onSelectRollup={onSelectRollup}
        viewMode="overview"
        onViewModeChange={vi.fn()}
      />
    )
    const { container, rerender } = render(chart(detail.rollups[20]!))
    clickNavigatorTrack(container, 450)
    const zoomed = viewportOf(container)
    expect(zoomed).not.toEqual([0, 90 * 60])
    const scrollZoom = scrollZoomToggle(container)
    expect(scrollZoom.getAttribute('aria-pressed')).toBe('true')
    const plot = container.querySelector<HTMLElement>('[data-chart-touch-action]')!
    // A pin exists: Escape clears it and keeps the zoom.
    fireEvent.keyDown(plot, { key: 'Escape' })
    expect(onSelectRollup).toHaveBeenCalledWith(null)
    expect(viewportOf(container)).toEqual(zoomed)

    // Nothing pinned: Escape restores the full range.
    onSelectRollup.mockClear()
    rerender(chart(null))
    fireEvent.keyDown(plot, { key: 'Escape' })
    expect(viewportOf(container)).toEqual([0, 90 * 60])
    expect(scrollZoom.getAttribute('aria-pressed')).toBe('true')

    // At the full range with nothing pinned, Escape does nothing more.
    fireEvent.keyDown(plot, { key: 'Escape' })
    expect(viewportOf(container)).toEqual([0, 90 * 60])
    expect(scrollZoom.getAttribute('aria-pressed')).toBe('true')
  })

  it('zooms with Alt + wheel and pans with Shift + wheel while Scroll zoom is off', () => {
    const flush = holdFrames()
    const { container } = renderChart(91)
    fireEvent.click(scrollZoomToggle(container))
    expect(scrollZoomToggle(container).getAttribute('aria-pressed')).toBe('false')
    const plot = container.querySelector('[data-chart-touch-action]')!
    const stack = container.querySelector('[data-session-chart-stack]')!
    const box = { left: 0, right: 1000, top: 0, bottom: 300, width: 1000, height: 300 } as DOMRect
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue(box)
    vi.spyOn(stack, 'getBoundingClientRect').mockReturnValue({ ...box, bottom: 500, height: 500 } as DOMRect)
    const full = viewportOf(container)

    // A plain wheel goes to the page while Scroll zoom is off.
    expect(fireEvent.wheel(plot, { deltaY: -400, clientX: 500, clientY: 150 })).toBe(true)
    flush()
    expect(viewportOf(container)).toEqual(full)
    resetChartWheelGuard()

    expect(fireEvent.wheel(plot, { deltaY: -400, clientX: 500, clientY: 150, altKey: true })).toBe(false)
    flush()
    const zoomed = viewportOf(container)
    expect(zoomed[1]! - zoomed[0]!).toBeLessThan(full[1]! - full[0]!)

    // Shift + wheel is the navigator's pan gesture; it must not also zoom.
    expect(fireEvent.wheel(plot, { deltaY: 300, clientX: 500, clientY: 150, shiftKey: true })).toBe(false)
    flush()
    const panned = viewportOf(container)
    expect(panned[0]).toBeGreaterThan(zoomed[0]!)
    // The navigator pans in whole minutes, so the span may snap by under a minute.
    expect(Math.abs((panned[1]! - panned[0]!) - (zoomed[1]! - zoomed[0]!))).toBeLessThan(60)
  })

  it('does not zoom on a wheel event the browser already scrolled (not cancelable), and zooms on the next real one', () => {
    const flush = holdFrames()
    const { container } = renderChart(91)
    const plot = container.querySelector('[data-chart-touch-action]')!
    const stack = container.querySelector('[data-session-chart-stack]')!
    const box = { left: 0, right: 1000, top: 0, bottom: 300, width: 1000, height: 300 } as DOMRect
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue(box)
    vi.spyOn(stack, 'getBoundingClientRect').mockReturnValue({ ...box, bottom: 500, height: 500 } as DOMRect)
    const full = viewportOf(container)

    // A page scroll that began below the card, now over the plot.
    const scrolled = new WheelEvent('wheel', { deltaY: -400, clientX: 500, clientY: 150, bubbles: true, cancelable: false })
    plot.dispatchEvent(scrolled)
    flush()
    expect(viewportOf(container)).toEqual(full)
    resetChartWheelGuard()

    expect(fireEvent.wheel(plot, { deltaY: -400, clientX: 500, clientY: 150 })).toBe(false)
    flush()
    const zoomed = viewportOf(container)
    expect(zoomed[1]! - zoomed[0]!).toBeLessThan(full[1]! - full[0]!)
  })

  it('discloses the bar size (D2) in the navigator readout on long streams', () => {
    // jsdom has no layout, so the chart uses its 1000 px fallback (944 px plot):
    // session-original lanes keep 1-minute bars up to about 1057 minutes there.
    const { container, unmount } = renderChart(748)
    const level = () => container.querySelector('[data-bench-plot]')?.getAttribute('data-activity-bucket-minutes')
    expect(level()).toBe('1')
    let note = container.querySelector('[data-chart-bar-bucket-minutes]')
    expect(note?.getAttribute('data-chart-bar-bucket-minutes')).toBe('1')
    expect(note?.textContent).toBe('1-min bars')
    const readout = container.querySelector('[data-session-chart-navigator] [role="status"]')
    expect(readout?.contains(note!)).toBe(true)
    expect(readout?.querySelector('.hx-chart-navigator__bucket-count')?.textContent)
      .toBe(', 748 of 748 minutes')
    unmount()
    // Longer than that, coarser bars, and the note says which.
    const long = renderChart(4000)
    const coarse = long.container.querySelector('[data-bench-plot]')?.getAttribute('data-activity-bucket-minutes')
    expect(Number(coarse)).toBeGreaterThan(1)
    note = long.container.querySelector('[data-chart-bar-bucket-minutes]')
    expect(note?.textContent).toBe(`${coarse}-min bars`)
  })

  it('re-buckets the bars as the view zooms and keeps the note live, down to 1-minute bars', () => {
    // The bar level changes when the viewport settles (the next frame), not mid-gesture.
    const flush = holdFrames()
    const { container } = renderChart(4000)
    flush()
    const level = () => container.querySelector('[data-bench-plot]')?.getAttribute('data-activity-bucket-minutes')
    const note = () => container.querySelector('[data-chart-bar-bucket-minutes]')
    const levels = [level()]
    const notes = [note()?.textContent]
    for (let click = 0; click < 7; click += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
      flush()
      levels.push(level())
      notes.push(note()?.textContent)
    }
    // Finer bars as the view narrows, never coarser; ends on 1-minute bars.
    const minutes = levels.map(Number)
    for (let index = 1; index < minutes.length; index += 1) expect(minutes[index]!).toBeLessThanOrEqual(minutes[index - 1]!)
    expect(minutes[minutes.length - 1]).toBe(1)
    expect(notes[notes.length - 1]).toBe('1-min bars')
    expect(notes.every((text, index) => text === `${minutes[index]}-min bars`)).toBe(true)
    // Zooming back out returns to the full-view level.
    expect(new Set(minutes).size).toBeGreaterThan(2)
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }))
    flush()
    expect(level()).toBe(levels[0])
  })

  it('draws no peak caps at any bar level (F3)', () => {
    const flush = holdFrames()
    const { container } = renderChart(748)
    flush()
    const caps = () => container.querySelectorAll('[data-activity-bar-peak], .spc-cap, .spc-peak')
    expect(container.querySelectorAll('rect.spc-bar').length).toBeGreaterThan(0)
    expect(caps()).toHaveLength(0)
    for (let click = 0; click < 5; click += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
      flush()
    }
    expect(container.querySelector('[data-bench-plot]')?.getAttribute('data-activity-bucket-minutes')).toBe('1')
    expect(caps()).toHaveLength(0)
  })

  it('reads the hovered bar in the toolbar readout: its slot and averages above 1-minute bars, the minute at 1-minute bars', () => {
    const flush = holdFrames()
    const minutes = 4000
    const { container } = renderChart(minutes)
    flush()
    const svg = container.querySelector<SVGSVGElement>('[data-bench-plot]')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 1000, top: 0, bottom: 400, width: 1000, height: 400, x: 0, y: 0 } as DOMRect)
    const readout = () => container.querySelector<HTMLElement>('[data-session-readout]')!.textContent!.replace(/\s+/g, ' ')
    const resting = readout()
    const size = Number(svg.getAttribute('data-activity-bucket-minutes'))
    expect(size).toBeGreaterThan(1)

    // Minute 45 reads its bar's slot and average chat (chat is 10 + minute % 12),
    // not minute 45 alone (19). 944 px plot.
    const first = Math.floor(45 / size) * size
    let sum = 0
    for (let m = first; m < first + size; m += 1) sum += 10 + (m % 12)
    const hms = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}:00`
    const x = ((45 + 0.5) / minutes) * 944
    fireEvent.pointerMove(svg, { clientX: x, clientY: 200, pointerType: 'mouse' })
    flush()
    expect(readout()).toContain(`${hms(first)}–${hms(first + size)} · ${size}-min avg`)
    expect(readout()).toContain(`chat ${Math.round(sum / size)}/min`)
    // No "Bar … · 10-min avg · (peak …)" row any more (plan §1.6).
    expect(container.querySelector('[data-chart-bar-readout]')).toBeNull()

    fireEvent.pointerLeave(svg)
    flush()
    expect(readout()).toBe(resting)
  })

  it('a click at 1-minute bars selects the minute the readout names', () => {
    const flush = holdFrames()
    const detail = detailWithMinutes(748)
    const onSelectRollup = vi.fn()
    const { container } = render(
      <AnalyticsChart detail={detail} selectedEmotes={new Set()} onSelectEmote={vi.fn()} selectedRollup={null}
        onSelectRollup={onSelectRollup} viewMode="overview" onViewModeChange={vi.fn()} />,
    )
    flush()
    const svg = container.querySelector<SVGSVGElement>('[data-bench-plot]')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 1000, top: 0, bottom: 400, width: 1000, height: 400, x: 0, y: 0 } as DOMRect)
    expect(svg.getAttribute('data-activity-bucket-minutes')).toBe('1')
    const readout = () => container.querySelector<HTMLElement>('[data-session-readout]')!.textContent!.replace(/\s+/g, ' ')
    // Near a minute's left edge: Chrome's click reports whole px (122), the pointer events the
    // exact x (122.5), and 1-minute bars are ~1.3 px wide here, so the click must hit-test the press.
    for (const minute of [97, 334, 415]) {
      const x = ((minute + 0.1) / 748) * 944
      fireEvent.pointerMove(svg, { clientX: x, clientY: 200, pointerType: 'mouse' })
      flush()
      const named = readout().match(/^(\d+):(\d\d):00/)!
      fireEvent.pointerDown(svg, { clientX: x, clientY: 200, pointerType: 'mouse', button: 0 })
      fireEvent.click(svg, { clientX: Math.floor(x), clientY: 200 })
      flush()
      const picked = onSelectRollup.mock.calls.at(-1)![0] as { minuteTs: string }
      const pickedMinute = (Date.parse(picked.minuteTs) - Date.parse(detail.stream.startedAt!)) / 60_000
      expect(pickedMinute, `readout ${named[0]}`).toBe(Number(named[1]) * 60 + Number(named[2]))
    }
  })

  it('reads the pinned minute on the toolbar readout, with no separate bar line', () => {
    const detail = detailWithMinutes(748)
    const props = {
      detail,
      selectedEmotes: new Set<string>(),
      onSelectEmote: vi.fn(),
      onSelectRollup: vi.fn(),
      viewMode: 'overview' as const,
      onViewModeChange: vi.fn(),
    }
    const { container, rerender } = render(<AnalyticsChart {...props} selectedRollup={null} />)
    rerender(<AnalyticsChart {...props} selectedRollup={detail.rollups[42]!} />)
    const text = container.querySelector('[data-session-readout]')!.textContent!.replace(/\s+/g, ' ')
    // Minute 42: chat 10 + 42 % 12 = 16.
    expect(text).toMatch(/^Pinned 0:42:00 · /)
    expect(text).toContain('chat 16/min')
    expect(container.querySelector('[data-chart-pinned-bar-readout]')).toBeNull()
    // The selection band sits on the pinned minute (1-minute bars at 748 minutes).
    expect(container.querySelector('rect[data-chart-selband]')).not.toBeNull()
  })

  it('drops the chart-header VOD jump; the selected detail slot keeps the page VOD link', () => {
    const detail = detailWithMinutes(91)
    const { container } = render(
      <AnalyticsChart
        detail={detail}
        selectedEmotes={new Set()}
        onSelectEmote={vi.fn()}
        selectedRollup={detail.rollups[20]!}
        onSelectRollup={vi.fn()}
        viewMode="overview"
        onViewModeChange={vi.fn()}
        vodJump={{ url: 'https://www.twitch.tv/videos/9?t=20m0s', offsetStr: '20m0s', seekOffsetSeconds: 1200 }}
      />,
    )
    expect(container.querySelector('[data-chart-vod-jump]')).toBeNull()
  })

  it('places selected detail after the graph and before measured data', () => {
    const detail = detailWithMinutes(91)
    const { container } = render(
      <AnalyticsChart
        detail={detail}
        selectedEmotes={new Set()}
        onSelectEmote={vi.fn()}
        selectedRollup={detail.rollups[20]!}
        onSelectRollup={vi.fn()}
        viewMode="overview"
        onViewModeChange={vi.fn()}
        selectedDetail={<a href="https://www.twitch.tv/videos/9?t=20m0s">Jump to VOD</a>}
        vodJump={{ url: 'https://www.twitch.tv/videos/9?t=20m0s', offsetStr: '20m0s', seekOffsetSeconds: 1200 }}
      />,
    )
    const graph = container.querySelector('[data-session-chart-stack]')!
    const selected = container.querySelector('[data-chart-selected-detail]')!
    const data = container.querySelector('[data-chart-data-alternative]')!
    expect(graph.compareDocumentPosition(selected) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(selected.compareDocumentPosition(data) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Jump to VOD' })).toHaveLength(1)
    expect(container.querySelector('[data-chart-vod-jump]')).toBeNull()
  })
})
