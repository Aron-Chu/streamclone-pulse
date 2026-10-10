import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsStreamDetail } from '../../api.ts'
import AnalyticsChart from './AnalyticsChart.tsx'
import { resetChartWheelGuard } from './ChartNavigator.tsx'
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

describe('AnalyticsChart range controls and navigator', () => {
  it('has one zoom UI: the shared navigator under the plot', () => {
    const { container } = renderChart(91)
    // The old stream-only range row and its − / + / preset buttons are gone.
    expect(container.querySelector('[data-chart-range-row]')).toBeNull()
    expect(container.querySelector('[data-chart-viewport-controls]')).toBeNull()
    expect(container.querySelector('[data-chart-viewport-readout]')).toBeNull()
    for (const name of ['Zoom chart in', 'Zoom chart out', '15m', '1h', '2h', '4h', 'Full']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    const navigators = container.querySelectorAll('[data-hub-chart-navigator]')
    expect(navigators).toHaveLength(1)
    const stack = container.querySelector('[data-session-chart-stack]')!
    const plot = stack.querySelector('[data-chart-touch-action]')!
    expect(stack.contains(navigators[0]!)).toBe(true)
    expect(plot.compareDocumentPosition(navigators[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const host = container.querySelector<HTMLElement>('[data-session-chart-navigator]')!
    expect(host.className).not.toMatch(/\b(absolute|fixed|sticky)\b/)
  })

  it('keeps the readouts in the chart header, ahead of the games strip and focus bar', () => {
    const { container } = renderChart(91)
    const header = container.querySelector<HTMLElement>('[data-chart-header-row]')!
    const readouts = container.querySelector<HTMLElement>('[data-chart-header-readouts]')!
    expect(header).not.toBeNull()
    expect(header.contains(readouts)).toBe(true)
    expect(readouts.contains(container.querySelector('[data-chart-hover-readout-row]'))).toBe(true)
    expect(readouts.contains(container.querySelector('[data-chart-selection-hint]'))).toBe(true)
    // The header precedes the focus bar and the plot.
    const focusBar = container.querySelector('[data-chart-focus-bar]')!
    const stack = container.querySelector('[data-session-chart-stack]')!
    expect(header.compareDocumentPosition(focusBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(focusBar.compareDocumentPosition(stack) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The hover values outlast the viewer-source label when the row is tight.
    const readoutValues = container.querySelector<HTMLElement>('[data-chart-hover-readout-row] > p')!
    expect(readoutValues.className).toMatch(/\bshrink-\[0\.01\]/)
    expect(readoutValues.className).toMatch(/\btruncate\b/)
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
    expect(navigatorHeading(container)).toBe('Zoomed view')
  })

  it('hides the navigator below the five-minute interaction threshold', () => {
    const { container } = renderChart(4)
    expect(container.querySelector('[data-session-chart-navigator]')).toBeNull()
    expect(container.querySelector('[data-hub-chart-navigator]')).toBeNull()
  })

  it('uses the hub chart navigator under the plot for long streams', () => {
    const { container } = renderChart(91)
    const host = container.querySelector<HTMLElement>('[data-session-chart-navigator]')!
    expect(host).not.toBeNull()
    expect(host.closest('[data-session-chart-stack]')).not.toBeNull()
    expect(host.className).toContain('hubx')
    expect(host.getAttribute('data-chart-range-state')).toBe('full')
    const navigator = host.querySelector('[data-hub-chart-navigator]')!
    expect(navigator.getAttribute('aria-label')).toBe('Chart navigator')
    expect(navigator.getAttribute('data-hub-chart-navigator-window')).toBe('0:90')
    const start = screen.getByRole('slider', { name: 'Chart view start' })
    // The plot ends on its last minute (01:30:00), where that minute's point is.
    expect(start.getAttribute('aria-valuetext')).toBe('Start 00:00:00; showing 00:00:00 to 01:30:00')
    expect(screen.getByRole('slider', { name: 'Chart view end' })).not.toBeNull()
    expect(navigator.querySelector('strong')?.textContent).toBe('Full stream')
    expect(navigator.querySelector('.hx-chart-navigator__bucket-count')?.textContent).toBe('91 of 91 minutes · bars per minute')
    for (const name of ['Zoom in', 'Zoom out', 'Reset zoom']) {
      expect(screen.getByRole('button', { name })).not.toBeNull()
    }
    // On by default, and remembered in this browser.
    expect(screen.getByRole('button', { name: /Scroll zoom/ }).getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-chart-position-rail]')).toBeNull()
  })

  it('keeps the navigator after zooming and thickens the line', () => {
    const { container } = renderChart(91)
    const chart = container.querySelector<SVGElement>('svg[data-chart-line-weight-mode="viewport-adaptive"]')
    const fullWidth = Number(chart?.getAttribute('data-chart-primary-line-width'))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(container.querySelector('[data-hub-chart-navigator]')).not.toBeNull()
    expect(container.querySelector('[data-session-chart-navigator]')?.getAttribute('data-chart-range-state'))
      .toBe('zoomed')
    expect(container.querySelector('[data-hub-chart-navigator] strong')?.textContent).toBe('Zoomed view')
    const zoomedWidth = Number(chart?.getAttribute('data-chart-primary-line-width'))
    expect(fullWidth).toBeGreaterThan(0)
    expect(zoomedWidth).toBeGreaterThan(fullWidth)
    expect(zoomedWidth).toBeLessThan(2.5)
  })

  it('moves the plotted x-axis and viewer path, not just the readout', () => {
    const { container } = renderChart(91)
    const axis = () =>
      [...container.querySelectorAll('[data-chart-x-axis-label]')].map(node => node.textContent)
    const viewerPath = () =>
      container.querySelector('[data-viewer-layer="idle"]')?.getAttribute('d')

    const fullAxis = axis()
    const fullPath = viewerPath()
    expect(fullAxis.length).toBeGreaterThan(1)

    // A click on the track zooms to the first preset (15m on a 91-minute stream).
    clickNavigatorTrack(container, 450)

    // The readout updating is not enough — a range control that reports a new
    // window while the plot stays put is worse than no control at all.
    expect(navigatorHeading(container)).toBe('Zoomed view')
    expect(axis()).not.toEqual(fullAxis)
    expect(viewerPath()).not.toBe(fullPath)
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
    expect(screen.getByRole('button', { name: /Scroll zoom/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Reset zoom' }).hasAttribute('disabled')).toBe(true)
    expect(navigatorHeading(container)).toBe('Full stream')
  })

  it('keeps the plot under the pointer while the navigator window is dragged with motion on', () => {
    motion.enabled = true
    // Hold every animation frame: a tween would leave the plot on its old range.
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {
      frames.set(++frameId, callback)
      return frameId
    })
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(key => { frames.delete(key) })
    const flush = () => {
      for (let round = 0; round < 4; round += 1) {
        act(() => {
          const pending = [...frames.values()]
          frames.clear()
          pending.forEach(callback => callback(performance.now() + 1000))
        })
      }
    }
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
    const scrollZoom = screen.getByRole('button', { name: /Scroll zoom/ })
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
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {
      frames.set(++frameId, callback)
      return frameId
    })
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(key => { frames.delete(key) })
    const flush = () => {
      for (let round = 0; round < 4; round += 1) {
        act(() => {
          const pending = [...frames.values()]
          frames.clear()
          pending.forEach(callback => callback(performance.now() + 1000))
        })
      }
    }
    const { container } = renderChart(91)
    fireEvent.click(screen.getByRole('button', { name: /Scroll zoom/ }))
    expect(screen.getByRole('button', { name: /Scroll zoom/ }).getAttribute('aria-pressed')).toBe('false')
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

  it('discloses the activity bar bucket size in the navigator readout on long streams', () => {
    const { container } = renderChart(748)
    // jsdom has no layout, so the chart uses its 1000-unit width: 5-minute bars.
    expect(container.querySelector('svg[data-activity-bucket-minutes]')?.getAttribute('data-activity-bucket-minutes'))
      .toBe('5')
    const note = container.querySelector('[data-chart-bar-bucket-minutes]')
    expect(note?.getAttribute('data-chart-bar-bucket-minutes')).toBe('5')
    expect(note?.textContent).toContain('bars 5-min avg')
    const readout = container.querySelector('[data-session-chart-navigator] [role="status"]')
    expect(readout?.contains(note!)).toBe(true)
    expect(readout?.querySelector('.hx-chart-navigator__bucket-count')?.textContent)
      .toBe('748 of 748 minutes · bars 5-min avg')
    expect(note?.getAttribute('title')).toBe(
      'Each activity bar averages the measured minutes in its 5-minute slot so bars stay readable at this width; a thin cap marks a peak minute well above the average, and a faded bar had unmeasured minutes. Gaps are slots with no measurement.',
    )
  })

  it('re-buckets the bars as the view zooms and keeps the note live', () => {
    const { container } = renderChart(748)
    const level = () => container.querySelector('svg[data-activity-bucket-minutes]')?.getAttribute('data-activity-bucket-minutes')
    const note = () => container.querySelector('[data-chart-bar-bucket-minutes]')
    const levels = [level()]
    const notes = [note()?.textContent]
    // 748 -> 374 -> 187 -> 94 minutes over the 1000-unit jsdom plot. A level
    // changes only once its slot clears 5px by 15%, so 374 minutes keep 5-min bars.
    for (let click = 0; click < 3; click += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
      levels.push(level())
      notes.push(note()?.textContent)
    }
    expect(levels).toEqual(['5', '5', '2', '1'])
    expect(notes).toEqual(['bars 5-min avg', 'bars 5-min avg', 'bars 2-min avg', 'bars per minute'])
    expect(note()?.getAttribute('data-chart-bar-bucket-minutes')).toBe('1')
    // Zooming back out returns to 5-minute bars.
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }))
    expect(level()).toBe('5')
  })

  it('caps busy slots above 1-minute bars and draws no caps at 1-minute bars', () => {
    const { container } = renderChart(748)
    expect(container.querySelectorAll('rect[data-activity-bar-peak]').length).toBeGreaterThan(0)
    for (const cap of container.querySelectorAll('rect[data-activity-bar-peak]')) {
      // A sibling of its bar, never a wrapper around it.
      expect(cap.previousElementSibling?.hasAttribute('data-activity-bar')).toBe(true)
    }
    for (let click = 0; click < 3; click += 1) fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(container.querySelector('svg[data-activity-bucket-minutes]')?.getAttribute('data-activity-bucket-minutes')).toBe('1')
    expect(container.querySelectorAll('rect[data-activity-bar-peak]').length).toBe(0)
  })

  it('names the hovered bar above 1-minute bars in the second header row, and reads minutes exactly at 1-minute bars', () => {
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {
      frames.set(++frameId, callback)
      return frameId
    })
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(key => { frames.delete(key) })
    const flush = () => act(() => {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach(callback => callback(performance.now() + 1000))
    })
    const { container } = renderChart(748)
    const plot = container.querySelector<SVGRectElement>('[data-chart-touch-action]')!
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 1000, top: 0, bottom: 300, width: 1000, height: 300 } as DOMRect)
    expect(container.querySelector('svg[data-activity-bucket-minutes]')?.getAttribute('data-activity-bucket-minutes')).toBe('5')
    const hint = () => container.querySelector<HTMLElement>('[data-chart-selection-hint]')!

    // Minute 42 sits in the 00:40-00:45 bar. Chat there runs 14, 15, 16, 17, 18.
    fireEvent.pointerEnter(plot)
    fireEvent.mouseMove(plot, { clientX: (42 / 747) * 1000, clientY: 150 })
    flush()
    const readout = container.querySelector<HTMLElement>('[data-chart-bar-readout]')!
    expect(readout).not.toBeNull()
    expect(readout.getAttribute('data-bar-step')).toBe('5')
    expect(readout.getAttribute('data-bar-start')).toBe(String(Date.parse('2026-07-31T00:40:00.000Z')))
    expect(readout.getAttribute('data-bar-partial')).toBe('false')
    expect(readout.textContent).toMatch(/^Bar 00:40:00–00:45:00 · 5-min avg · chat 16\/min \(peak 18\) · emotes \d+\/min \(peak \d+\)$/)
    expect(readout.getAttribute('title')).toBe(readout.textContent)
    // The header readout above it stays minute-exact.
    expect(container.querySelector('[data-chart-hover-readout-row]')?.textContent).toContain('00:42')
    expect(container.querySelector('[data-chart-hover-readout-row]')?.textContent).not.toContain('avg')

    // Leaving the plot restores the usual hint.
    fireEvent.mouseLeave(plot)
    flush()
    expect(container.querySelector('[data-chart-bar-readout]')).toBeNull()
    expect(hint().textContent).toBe('Hover to preview a minute · click to select · press Esc to clear')

    // At 1-minute bars there is no bar summary: the row reads as before.
    for (let click = 0; click < 3; click += 1) fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    flush()
    expect(container.querySelector('svg[data-activity-bucket-minutes]')?.getAttribute('data-activity-bucket-minutes')).toBe('1')
    const start = Number(plot.getAttribute('data-chart-viewport-start'))
    const end = Number(plot.getAttribute('data-chart-viewport-end'))
    fireEvent.mouseMove(plot, { clientX: 500, clientY: 150 })
    flush()
    expect(start).toBeGreaterThan(0)
    expect(end).toBeLessThan(747 * 60)
    expect(container.querySelector('[data-chart-bar-readout]')).toBeNull()
    expect(hint().textContent).toBe('Hover to preview a minute · click to select · press Esc to clear')
  })

  it('offers a VOD jump beside the pinned minute', () => {
    const detail = detailWithMinutes(91)
    const selected = detail.rollups[20]!
    const { container, rerender } = render(
      <AnalyticsChart
        detail={detail}
        selectedEmotes={new Set()}
        onSelectEmote={vi.fn()}
        selectedRollup={null}
        onSelectRollup={vi.fn()}
        viewMode="overview"
        onViewModeChange={vi.fn()}
        vodJump={{ url: 'https://www.twitch.tv/videos/9?t=20m0s', offsetStr: '20m0s', seekOffsetSeconds: 1200 }}
      />,
    )
    // Nothing pinned yet, so no jump is offered.
    expect(container.querySelector('[data-chart-vod-jump]')).toBeNull()

    rerender(
      <AnalyticsChart
        detail={detail}
        selectedEmotes={new Set()}
        onSelectEmote={vi.fn()}
        selectedRollup={selected}
        onSelectRollup={vi.fn()}
        viewMode="overview"
        onViewModeChange={vi.fn()}
        vodJump={{ url: 'https://www.twitch.tv/videos/9?t=20m0s', offsetStr: '20m0s', seekOffsetSeconds: 1200 }}
      />,
    )
    const jump = container.querySelector<HTMLAnchorElement>('[data-chart-vod-jump]')
    expect(jump?.getAttribute('href')).toBe('https://www.twitch.tv/videos/9?t=20m0s')
    expect(jump?.textContent).toContain('20m0s')
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
