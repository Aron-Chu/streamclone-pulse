import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsStreamDetail } from '../../api.ts'
import AnalyticsChart from './AnalyticsChart.tsx'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({
  useConsoleMotion: () => ({ motionEnabled: false }),
}))

afterEach(() => cleanup())

// Owner report (2026-10-09, a ~21-minute live stream): the axis, the dashed
// live edge and the purple zoom bar ran to the right edge, but the viewer line
// and the last bars stopped well short of it.
const START = Date.parse('2026-10-09T23:46:31.000Z')

function detail(args: {
  minutes: number
  emptyTail?: number
  updatedAt?: number
  live?: boolean
  state?: string
  lifecycleState?: 'unknown' | 'confirmed_live' | 'confirmed_ended'
}): AnalyticsStreamDetail {
  const rows = Array.from({ length: args.minutes + (args.emptyTail ?? 0) }, (_, index) => {
    const hasData = index < args.minutes
    // The newest minute of a live stream is partial: short chat, no viewer sample yet.
    const partial = args.live && index === args.minutes - 1
    return {
      minuteTs: new Date(START + index * 60_000).toISOString(),
      viewerAvg: hasData && !partial ? 48_000 + index * 100 : undefined,
      viewerSamples: hasData && !partial ? 2 : 0,
      chatCount: hasData ? (partial ? 120 : 600) : undefined,
      totalEmoteCount: hasData ? 90 : 0,
      emotes: hasData ? { Kappa: 9 } : {},
    }
  })
  return {
    state: args.state,
    stream: {
      streamId: 'live-edge',
      startedAt: new Date(START).toISOString(),
      peakViewers: 50_000,
      avgViewers: 48_000,
      ...(args.lifecycleState ? { lifecycleState: args.lifecycleState } : {}),
    },
    rollups: rows,
    topEmotes: [],
    sources: [],
    updatedAt: args.updatedAt,
  } as unknown as AnalyticsStreamDetail
}

function renderChart(data: AnalyticsStreamDetail, isLive: boolean) {
  return render(
    <AnalyticsChart
      detail={data}
      isLive={isLive}
      selectedEmotes={new Set()}
      onSelectEmote={vi.fn()}
      selectedRollup={null}
      onSelectRollup={vi.fn()}
      viewMode="overview"
      onViewModeChange={vi.fn()}
    />,
  )
}

/** x of the last vertex of an SVG path. */
function lastPathX(d: string | null | undefined): number {
  const numbers = (d ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
  return numbers[numbers.length - 2] ?? Number.NaN
}

function geometry(container: HTMLElement) {
  const plot = container.querySelector('[data-chart-touch-action]')!
  const plotStart = Number(plot.getAttribute('x'))
  const plotEnd = plotStart + Number(plot.getAttribute('width'))
  const viewerEnd = lastPathX(container.querySelector('[data-viewer-layer="idle"]')?.getAttribute('d'))
  // The last bar is centred on the last minute, so its right half is clipped at the plot's end.
  const bars = [...container.querySelectorAll('rect[data-activity-bar="chat"]')]
    .map(bar => Number(bar.getAttribute('x')) + Number(bar.getAttribute('width')))
  return {
    plotEnd,
    viewerEnd,
    lastBarRight: Math.max(...bars),
    viewportEnd: Number(plot.getAttribute('data-chart-viewport-end')),
  }
}

describe('AnalyticsChart live edge', () => {
  it('ends a live plot on the newest finished minute, with every series at the right edge', () => {
    // 21 minutes; the 21st (00:20:00) is still being measured.
    const { container } = renderChart(detail({ minutes: 21, live: true, updatedAt: START + 20 * 60_000 + 25_000 }), true)
    const { plotEnd, viewerEnd, lastBarRight, viewportEnd } = geometry(container)
    expect(viewportEnd).toBe(19 * 60)
    expect(viewerEnd).toBeCloseTo(plotEnd, 0)
    expect(lastBarRight).toBeCloseTo(plotEnd, 0)
    // The axis and the navigator describe the same span: 20 plotted minutes.
    const navigator = container.querySelector('[data-hub-chart-navigator]')!
    expect(navigator.querySelector('.hx-chart-navigator__bucket-count')?.textContent).toBe('20 of 20 minutes')
    expect(screen.getByRole('slider', { name: 'Chart view end' }).getAttribute('aria-valuetext'))
      .toBe('End 00:19:00; showing 00:00:00 to 00:19:00')
    // An honest marker above the right end says the chart is live.
    expect(container.querySelector('[data-chart-live-edge]')?.textContent).toBe('Live · updating')
    // The minute still being measured stays in the data table, marked.
    const updatingRows = [...container.querySelectorAll('[data-chart-data-updating]')]
    expect(updatingRows).toHaveLength(1)
    expect(updatingRows[0]!.closest('tr')?.textContent).toContain('00:20:00')
    expect(container.textContent).toContain('View measured minute data (21 of 21 minutes)')
  })

  it('names the last measured time at the live edge when collection has fallen behind', () => {
    const { container } = renderChart(detail({ minutes: 21, updatedAt: START + 30 * 60_000 }), true)
    expect(geometry(container).viewportEnd).toBe(20 * 60)
    expect(container.querySelector('[data-chart-live-edge]')?.textContent).toBe('Live · last data 00:21:00')
  })

  it('hides the live marker while the view is zoomed away from the live edge', () => {
    const { container } = renderChart(detail({ minutes: 60, live: true, updatedAt: START + 59 * 60_000 + 10_000 }), true)
    expect(container.querySelector('[data-chart-live-edge]')).not.toBeNull()
    const start = screen.getByRole('slider', { name: 'Chart view end' })
    fireEvent.keyDown(start, { key: 'ArrowLeft', shiftKey: true })
    expect(container.querySelector('[data-chart-live-edge]')).toBeNull()
  })

  it('ends an ended plot on its last minute with data, not on empty trailing minutes', () => {
    const { container } = renderChart(detail({ minutes: 30, emptyTail: 3 }), false)
    const { plotEnd, viewerEnd, lastBarRight, viewportEnd } = geometry(container)
    expect(viewportEnd).toBe(29 * 60)
    expect(viewerEnd).toBeCloseTo(plotEnd, 0)
    expect(lastBarRight).toBeCloseTo(plotEnd, 0)
    expect(container.querySelector('[data-chart-live-edge]')).toBeNull()
    expect(container.querySelector('[data-chart-data-updating]')).toBeNull()
  })

  it('keeps a 12-hour stream aligned at the right edge with bucketed bars', () => {
    const { container } = renderChart(detail({ minutes: 748 }), false)
    const { plotEnd, viewerEnd, lastBarRight, viewportEnd } = geometry(container)
    expect(viewportEnd).toBe(747 * 60)
    expect(viewerEnd).toBeCloseTo(plotEnd, 0)
    expect(lastBarRight).toBeCloseTo(plotEnd, 0)
    expect(container.querySelector('[data-hub-chart-navigator] .hx-chart-navigator__bucket-count')?.textContent)
      .toContain('748 of 748 minutes')
  })

  // Review finding (2026-10-09): the reported stream, read later, shows "Live status
  // unconfirmed" (the API says state "live", lifecycle "unknown") because collection
  // stopped. The client does not confirm it live, yet the plot must still line up.
  it('lines up an open stream whose live status is unconfirmed, and says when its data stops', () => {
    // 15 minutes; the 15th (00:14:00) is the partial minute collection stopped in, read 10 minutes later.
    const data = detail({ minutes: 15, live: true, state: 'live', lifecycleState: 'unknown', updatedAt: START + 25 * 60_000 })
    const { container } = renderChart(data, false)
    const { plotEnd, viewerEnd, lastBarRight, viewportEnd } = geometry(container)
    expect(viewportEnd).toBe(13 * 60)
    expect(viewerEnd).toBeCloseTo(plotEnd, 0)
    expect(lastBarRight).toBeCloseTo(plotEnd, 0)
    expect(container.querySelector('[data-hub-chart-navigator] .hx-chart-navigator__bucket-count')?.textContent)
      .toBe('14 of 14 minutes')
    const marker = container.querySelector('[data-chart-live-edge]')
    expect(marker?.textContent).toBe('Unconfirmed · last data 00:14:00')
    expect(marker?.getAttribute('data-chart-live-edge-tone')).toBe('unconfirmed')
    const partialRows = [...container.querySelectorAll('[data-chart-data-updating="partial"]')]
    expect(partialRows).toHaveLength(1)
    expect(partialRows[0]!.closest('tr')?.textContent).toContain('00:14:00 (partial)')
  })

  it('lines up a confirmed live stream whose newest minute stopped long ago', () => {
    const data = detail({ minutes: 15, live: true, state: 'live', lifecycleState: 'confirmed_live', updatedAt: START + 25 * 60_000 })
    const { container } = renderChart(data, true)
    const { plotEnd, viewerEnd, viewportEnd } = geometry(container)
    expect(viewportEnd).toBe(13 * 60)
    expect(viewerEnd).toBeCloseTo(plotEnd, 0)
    expect(container.querySelector('[data-chart-live-edge]')?.textContent).toBe('Live · last data 00:14:00')
    expect(container.querySelector('[data-chart-live-edge]')?.getAttribute('data-chart-live-edge-tone')).toBe('live')
  })

  it('keeps the last minute of a confirmed ended stream, with no marker', () => {
    const data = detail({ minutes: 15, live: true, state: 'historical', lifecycleState: 'confirmed_ended', updatedAt: START + 25 * 60_000 })
    const { container } = renderChart(data, false)
    expect(geometry(container).viewportEnd).toBe(14 * 60)
    expect(container.querySelector('[data-chart-live-edge]')).toBeNull()
    expect(container.querySelector('[data-chart-data-updating]')).toBeNull()
  })
})
