import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsStreamDetail } from '../../api.ts'
import AnalyticsChart from './AnalyticsChart.tsx'
import { ChartNavigator } from './ChartNavigator.tsx'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({
  useConsoleMotion: () => ({ motionEnabled: false }),
}))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function detailWithMinutes(minuteCount: number): AnalyticsStreamDetail {
  return {
    stream: { streamId: 'zoom-parity-stream', startedAt: '2026-07-31T00:00:00.000Z', peakViewers: 200, avgViewers: 120 },
    rollups: Array.from({ length: minuteCount }, (_, index) => ({
      minuteTs: new Date(Date.parse('2026-07-31T00:00:00.000Z') + index * 60_000).toISOString(),
      viewerAvg: 100 + (index % 40),
      chatCount: 10 + (index % 12),
      totalEmoteCount: 2 + (index % 9),
      emotes: {},
    })),
    topEmotes: [],
    sources: [],
  } as unknown as AnalyticsStreamDetail
}

function renderChart(minuteCount = 91) {
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

const navigatorWindow = (container: HTMLElement) =>
  container.querySelector('[data-hub-chart-navigator]')!.getAttribute('data-hub-chart-navigator-window')!
const spanOf = (window: string) => {
  const [start, end] = window.split(':').map(Number)
  return end! - start! + 1
}

describe('ChartNavigator minimum span', () => {
  function renderNavigator(range: [number, number], minVisibleCount?: number) {
    const onChange = vi.fn()
    render(
      <ChartNavigator
        pointCount={240}
        startIndex={range[0]}
        endIndex={range[1]}
        startLabel="a"
        endLabel="b"
        scrollZoomEnabled={false}
        onScrollZoomChange={vi.fn()}
        onChange={onChange}
        onReset={vi.fn()}
        {...(minVisibleCount == null ? {} : { minVisibleCount })}
      />,
    )
    return onChange
  }

  it('keeps the hub default: Zoom in stops at two buckets', () => {
    renderNavigator([120, 122])
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement
    expect(zoomIn.disabled).toBe(false)
    cleanup()
    renderNavigator([120, 121])
    expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables Zoom in at the floor and never emits a span below it', () => {
    let onChange = renderNavigator([100, 109], 5)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0]![0] as { startIndex: number; endIndex: number }
    expect(next.endIndex - next.startIndex + 1).toBe(5)
    cleanup()
    onChange = renderNavigator([100, 104], 5)
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement
    expect(zoomIn.disabled).toBe(true)
    fireEvent.click(zoomIn)
    expect(onChange).not.toHaveBeenCalled()
    // The handles cannot squeeze the view below the floor either.
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Chart view start' }), { key: 'ArrowRight' })
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Chart view end' }), { key: 'ArrowLeft' })
    for (const call of onChange.mock.calls) {
      const range = call[0] as { startIndex: number; endIndex: number }
      expect(range.endIndex - range.startIndex + 1).toBeGreaterThanOrEqual(5)
    }
  })
})

describe('stream chart zoom matches the Global activity chart', () => {
  it('stops Zoom in at five minutes, disables it, and does not creep the window', () => {
    const { container } = renderChart(748)
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement
    const windows: string[] = []
    for (let click = 0; click < 16 && !zoomIn.disabled; click += 1) {
      fireEvent.click(zoomIn)
      windows.push(navigatorWindow(container))
    }
    expect(zoomIn.disabled).toBe(true)
    // Five minutes hold six minute steps (both edge minutes are plotted).
    expect(spanOf(windows[windows.length - 1]!)).toBe(6)
    // Every click halved the view until the floor; none was a same-size nudge.
    for (let index = 1; index < windows.length; index += 1) {
      expect(spanOf(windows[index]!)).toBeLessThan(spanOf(windows[index - 1]!))
    }
    const plot = container.querySelector('[data-chart-touch-action]')!
    const viewport = Number(plot.getAttribute('data-chart-viewport-end')) - Number(plot.getAttribute('data-chart-viewport-start'))
    expect(viewport).toBe(300)
  })

  it('steps the plot + / - / 0 keys exactly like Zoom in / Zoom out / Reset zoom', () => {
    const viaButtons = renderChart(748)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    const afterButtonIn = navigatorWindow(viaButtons.container)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    const afterButtonOut = navigatorWindow(viaButtons.container)
    cleanup()

    const { container } = renderChart(748)
    const plot = container.querySelector('svg[role="group"]')!
    fireEvent.keyDown(plot, { key: '+' })
    expect(navigatorWindow(container)).toBe(afterButtonIn)
    fireEvent.keyDown(plot, { key: '=' })
    fireEvent.keyDown(plot, { key: '-' })
    expect(navigatorWindow(container)).toBe(afterButtonOut)
    // Scroll zoom on, then 0: the same full reset as the button, mode off.
    const scrollZoom = screen.getByRole('button', { name: /Scroll zoom/ })
    fireEvent.click(scrollZoom)
    expect(scrollZoom.getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(plot, { key: '0' })
    expect(navigatorWindow(container)).toBe('0:747')
    expect(scrollZoom.getAttribute('aria-pressed')).toBe('false')
    // At the floor, + does nothing (Zoom in is disabled there).
    for (let press = 0; press < 12; press += 1) fireEvent.keyDown(plot, { key: '+' })
    const floor = navigatorWindow(container)
    expect(spanOf(floor)).toBe(6)
    fireEvent.keyDown(plot, { key: '+' })
    expect(navigatorWindow(container)).toBe(floor)
  })

  it('zooms one Alt+wheel notch over the plot by the navigator step, not the plot step', () => {
    const { container } = renderChart(748)
    const plot = container.querySelector('[data-chart-touch-action]')!
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 1000, top: 0, height: 300 } as DOMRect)
    fireEvent.wheel(plot, { deltaY: -100, clientX: 500, altKey: true })
    // The hub's navigator: round(748 * exp(-0.25)) = 583 of 748.
    expect(spanOf(navigatorWindow(container))).toBe(583)
    // Scroll zoom on: a plain notch is the same step.
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }))
    fireEvent.click(screen.getByRole('button', { name: /Scroll zoom/ }))
    fireEvent.wheel(plot, { deltaY: -100, clientX: 500 })
    expect(spanOf(navigatorWindow(container))).toBe(583)
  })
})
