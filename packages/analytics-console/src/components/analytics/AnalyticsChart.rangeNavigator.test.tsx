import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsStreamDetail } from '../../api.ts'
import AnalyticsChart from './AnalyticsChart.tsx'
import {
  sessionNavigatorIndexForOffset,
  sessionNavigatorPointCount,
  sessionNavigatorRangeForViewport,
  sessionViewportForNavigatorRange,
} from '../../utils/sessionChartNavigator.ts'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({
  useConsoleMotion: () => ({ motionEnabled: false }),
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

afterEach(() => { cleanup(); vi.restoreAllMocks() })

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
})

describe('AnalyticsChart range controls and navigator', () => {
  it('puts the range controls in their own row above the plot', () => {
    const { container } = renderChart(91)
    const row = container.querySelector<HTMLElement>('[data-chart-range-row]')!
    const stack = container.querySelector('[data-session-chart-stack]')!
    const controls = container.querySelector<HTMLElement>('[data-chart-viewport-controls]')!
    expect(row).not.toBeNull()
    // The row sits before the plot and outside it, and nothing in it floats.
    expect(stack.contains(row)).toBe(false)
    expect(row.compareDocumentPosition(stack) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const element of [row, controls]) {
      expect(element.className).not.toMatch(/\b(absolute|fixed|sticky)\b/)
    }
    expect([...controls.querySelectorAll('button')].map(button => button.textContent?.trim()))
      .toEqual(['−', '+', '15m', '1h', 'Full'])
    expect(container.querySelector('[data-chart-viewport-readout]')?.textContent).toBe('Full stream')
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
    fireEvent.click(screen.getByRole('button', { name: 'Zoom chart in' }))
    expect(container.querySelector('[data-hub-chart-navigator]')).not.toBeNull()
    expect(container.querySelector('[data-chart-viewport-readout]')?.textContent).not.toBe('Full stream')
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

    fireEvent.click(screen.getByRole('button', { name: '15m' }))

    // The readout updating is not enough — a range control that reports a new
    // window while the plot stays put is worse than no control at all.
    expect(container.querySelector('[data-chart-viewport-readout]')?.textContent).toBe('15m')
    expect(axis()).not.toEqual(fullAxis)
    expect(viewerPath()).not.toBe(fullPath)
    expect(container.querySelector('[data-hub-chart-navigator]')?.getAttribute('data-hub-chart-navigator-window'))
      .toMatch(/^\d+:\d+$/)
    const [startIndex, endIndex] = container.querySelector('[data-hub-chart-navigator]')!
      .getAttribute('data-hub-chart-navigator-window')!.split(':').map(Number)
    expect(endIndex! - startIndex! + 1).toBe(15)
  })

  it('drives the plotted viewport from the navigator sliders and resets', () => {
    const { container } = renderChart(91)
    fireEvent.click(screen.getByRole('button', { name: '1h' }))
    const zoomed = viewportOf(container)
    const end = screen.getByRole('slider', { name: 'Chart view end' })
    fireEvent.keyDown(end, { key: 'ArrowLeft', shiftKey: true })
    const shrunk = viewportOf(container)
    expect(shrunk[1]! - shrunk[0]!).toBeCloseTo(zoomed[1]! - zoomed[0]! - 5 * 60, 0)

    fireEvent.click(screen.getByRole('button', { name: /Scroll zoom/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }))
    expect(viewportOf(container)).toEqual([0, 91 * 60])
    expect(screen.getByRole('button', { name: /Scroll zoom/ }).getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('[data-chart-viewport-readout]')?.textContent).toBe('Full stream')
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

  it('discloses the activity bar bucket size beside the range readout on long streams', () => {
    const { container } = renderChart(748)
    // jsdom has no layout, so the chart uses its 1000-unit width: 5-minute bars.
    expect(container.querySelector('svg[data-activity-bucket-minutes]')?.getAttribute('data-activity-bucket-minutes'))
      .toBe('5')
    const note = container.querySelector('[data-chart-bar-bucket-minutes]')
    expect(note?.getAttribute('data-chart-bar-bucket-minutes')).toBe('5')
    expect(note?.textContent).toContain('bars 5-min avg')
    expect(container.querySelector('[data-chart-range-row]')?.contains(note!)).toBe(true)
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
