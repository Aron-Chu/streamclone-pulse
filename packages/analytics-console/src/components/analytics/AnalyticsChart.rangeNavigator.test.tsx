import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsStreamDetail } from '../../api.ts'
import AnalyticsChart from './AnalyticsChart.tsx'
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
  it('counts whole minutes and round-trips the full stream', () => {
    expect(sessionNavigatorPointCount(91 * 60, 0)).toBe(91)
    const full = sessionNavigatorRangeForViewport({ startSeconds: 0, endSeconds: 91 * 60 }, 91 * 60, 0)
    expect(full).toEqual({ startIndex: 0, endIndex: 90 })
    expect(sessionViewportForNavigatorRange(full, 91 * 60, 0)).toEqual({ startSeconds: 0, endSeconds: 91 * 60 })
  })

  it('maps a zoomed window to the minutes it contains and back', () => {
    const range = sessionNavigatorRangeForViewport({ startSeconds: 600, endSeconds: 1500 }, 91 * 60, 0)
    expect(range).toEqual({ startIndex: 10, endIndex: 24 })
    expect(sessionViewportForNavigatorRange(range, 91 * 60, 0)).toEqual({ startSeconds: 600, endSeconds: 1500 })
  })

  it('counts from the first charted minute and clamps offsets', () => {
    expect(sessionNavigatorPointCount(3600, 600)).toBe(50)
    expect(sessionNavigatorIndexForOffset(605, 3600, 600)).toBe(0)
    expect(sessionNavigatorIndexForOffset(10_000, 3600, 600)).toBe(49)
    expect(sessionNavigatorIndexForOffset(null, 3600, 600)).toBeNull()
  })

  it('offers the hub-style one-click zoom sizes by stream length', () => {
    // Two hours or less: 15m first, then 1h (a 2h stream is 120 steps).
    expect(sessionNavigatorPresets(2 * 3600, 0)).toEqual([
      { label: '15m', pointCount: 15 },
      { label: '1h', pointCount: 60 },
    ])
    // Longer streams: 1h first, then 4h when it still fits.
    expect(sessionNavigatorPresets(3 * 3600, 0)).toEqual([{ label: '1h', pointCount: 60 }])
    expect(sessionNavigatorPresets(12 * 3600, 0)).toEqual([
      { label: '1h', pointCount: 60 },
      { label: '4h', pointCount: 240 },
    ])
    // A preset that is not smaller than the whole navigator is dropped.
    expect(sessionNavigatorPresets(45 * 60, 0)).toEqual([{ label: '15m', pointCount: 15 }])
    expect(sessionNavigatorPresets(10 * 60, 0)).toEqual([])
    // Spans count from the first charted minute.
    expect(sessionNavigatorPresets(70 * 60, 30 * 60)).toEqual([{ label: '15m', pointCount: 15 }])
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
      .toContain('With the chart focused, + and − zoom and 0 resets the view.')
  })

  it('zooms to the first preset around a click on the track at full range, as the hub does', () => {
    const { container } = renderChart(748)
    const track = container.querySelector<HTMLElement>('.hx-chart-navigator__track')!
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 747 } as DOMRect)
    const target = container.querySelector<HTMLElement>('.hx-chart-navigator__window')!
    fireEvent.pointerDown(target, { pointerId: 4, button: 0, clientX: 400 })
    fireEvent.pointerUp(target, { pointerId: 4, clientX: 400 })
    // 748 minutes is over 2h, so presets[0] is 1h: a 60-minute window around minute 400.
    expect(navigatorWindowSpan(container)).toBe(60)
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
    expect(start.getAttribute('aria-valuetext')).toBe('Start 00:00:00; showing 00:00:00 to 01:31:00')
    expect(screen.getByRole('slider', { name: 'Chart view end' })).not.toBeNull()
    expect(navigator.querySelector('strong')?.textContent).toBe('Full stream')
    expect(navigator.querySelector('.hx-chart-navigator__bucket-count')?.textContent).toBe('91 of 91 minutes')
    for (const name of ['Zoom in', 'Zoom out', 'Reset zoom']) {
      expect(screen.getByRole('button', { name })).not.toBeNull()
    }
    expect(screen.getByRole('button', { name: /Scroll zoom/ }).getAttribute('aria-pressed')).toBe('false')
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
    expect(navigatorWindowSpan(container)).toBe(15)
  })

  it('drives the plotted viewport from the navigator sliders and resets', () => {
    const { container } = renderChart(91)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    const zoomed = viewportOf(container)
    const end = screen.getByRole('slider', { name: 'Chart view end' })
    fireEvent.keyDown(end, { key: 'ArrowLeft', shiftKey: true })
    const shrunk = viewportOf(container)
    expect(shrunk[1]! - shrunk[0]!).toBeCloseTo(zoomed[1]! - zoomed[0]! - 5 * 60, 0)

    fireEvent.click(screen.getByRole('button', { name: /Scroll zoom/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }))
    expect(viewportOf(container)).toEqual([0, 91 * 60])
    expect(screen.getByRole('button', { name: /Scroll zoom/ }).getAttribute('aria-pressed')).toBe('false')
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
    expect(viewportOf(container)).not.toEqual([0, 91 * 60])
    flush()
    expect(viewportOf(container)).toEqual([0, 91 * 60])
  })

  it('turns Scroll zoom off on Escape from the focused plot and keeps the pin', () => {
    const detail = detailWithMinutes(91)
    const onSelectRollup = vi.fn()
    const { container } = render(
      <AnalyticsChart
        detail={detail}
        selectedEmotes={new Set()}
        onSelectEmote={vi.fn()}
        selectedRollup={detail.rollups[20]!}
        onSelectRollup={onSelectRollup}
        viewMode="overview"
        onViewModeChange={vi.fn()}
      />,
    )
    clickNavigatorTrack(container, 450)
    const scrollZoom = screen.getByRole('button', { name: /Scroll zoom/ })
    fireEvent.click(scrollZoom)
    expect(scrollZoom.getAttribute('aria-pressed')).toBe('true')
    const plot = container.querySelector<HTMLElement>('[data-chart-touch-action]')!
    fireEvent.keyDown(plot, { key: 'Escape' })
    expect(scrollZoom.getAttribute('aria-pressed')).toBe('false')
    expect(viewportOf(container)).toEqual([0, 91 * 60])
    expect(onSelectRollup).not.toHaveBeenCalled()

    // With Scroll zoom already off, Escape on the plot clears the pin as before.
    fireEvent.keyDown(plot, { key: 'Escape' })
    expect(onSelectRollup).toHaveBeenCalledWith(null)
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
    const plot = container.querySelector('[data-chart-touch-action]')!
    const stack = container.querySelector('[data-session-chart-stack]')!
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 1000 } as DOMRect)
    vi.spyOn(stack, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 1000 } as DOMRect)
    const full = viewportOf(container)

    expect(fireEvent.wheel(plot, { deltaY: -400, clientX: 500, altKey: true })).toBe(false)
    flush()
    const zoomed = viewportOf(container)
    expect(zoomed[1]! - zoomed[0]!).toBeLessThan(full[1]! - full[0]!)

    // Shift + wheel is the navigator's pan gesture; it must not also zoom.
    expect(fireEvent.wheel(plot, { deltaY: 300, clientX: 500, shiftKey: true })).toBe(false)
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
      'Each activity bar averages 5 measured minutes so bars stay readable at this width. Gaps are minutes with no measurement.',
    )
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
