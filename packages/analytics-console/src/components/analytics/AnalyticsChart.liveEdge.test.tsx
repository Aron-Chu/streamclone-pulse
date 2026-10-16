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

/** Renders the chart; with liveMarker, ticks Show on chart's Live edge when the stream offers it. */
function renderChart(data: AnalyticsStreamDetail, isLive: boolean, liveMarker = true) {
  const view = render(
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
  const box = view.container.querySelector<HTMLInputElement>('[data-session-marker="live"]')
  if (liveMarker && box) fireEvent.click(box)
  return view
}

/**
 * Largest x among the M/L/C points of SVG paths (SpChart draws lines in index
 * units; the session lanes smooth with C, whose control points never pass the end point).
 */
function maxPathX(paths: Iterable<string | null | undefined>): number {
  let max = Number.NaN
  for (const d of paths) {
    for (const m of (d ?? '').matchAll(/[MLC]([^MLCZ]*)/g)) {
      const nums = m[1]!.trim().split(/[\s,]+/).map(Number)
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = nums[i]!
        if (!(x <= max)) max = x
      }
    }
  }
  return max
}

function geometry(container: HTMLElement) {
  const plot = container.querySelector('[data-chart-touch-action]')!
  const plotEnd = Number(plot.getAttribute('width'))
  // Bars and lines sit in one group scaled from index units to px:
  // translate(tx 0) scale(sx 1), so px = tx + sx * index.
  const scaled = container.querySelector('g[data-spc-scaled]')!
  const match = /translate\((-?[\d.e+-]+) 0\) scale\((-?[\d.e+-]+) 1\)/.exec(scaled.getAttribute('transform') ?? '')
  const tx = Number(match?.[1]), sx = Number(match?.[2])
  const px = (u: number) => tx + sx * u
  // the viewers lane's line (session-original lanes), not its fill
  const viewerEnd = px(maxPathX([...container.querySelectorAll('g[data-lane="viewers"] path:not(.spc-lane-fill)')].map(p => p.getAttribute('d'))))
  // session-original lanes centre each bar in its slot (prod's width rule)
  const bars = [...container.querySelectorAll('rect.spc-bar')]
    .map(bar => px(Number(bar.getAttribute('x')) + Number(bar.getAttribute('width')) / 2))
  const slotMinutes = Number(container.querySelector('[data-bench-plot]')?.getAttribute('data-activity-bucket-minutes')) || 1
  return {
    plotEnd,
    /** px width of one plotted minute */
    minutePx: sx,
    /** px width of one bar slot */
    slotPx: sx * slotMinutes,
    viewerEnd,
    lastBarCentre: Math.max(...bars),
    viewportEnd: Number(plot.getAttribute('data-chart-viewport-end')),
  }
}

/** Every series reaches the right edge: the last bar is centred in the last slot, the line ends inside the last minute. */
function expectAtRightEdge(g: ReturnType<typeof geometry>) {
  expect(Math.abs(g.lastBarCentre - (g.plotEnd - g.slotPx / 2))).toBeLessThan(0.5)
  expect(g.viewerEnd).toBeGreaterThan(g.plotEnd - g.minutePx)
  expect(g.viewerEnd).toBeLessThanOrEqual(g.plotEnd + 0.01)
}

describe('AnalyticsChart live edge', () => {
  it('ends a live plot on the newest finished minute, with every series at the right edge', () => {
    // 21 minutes; the 21st (00:20:00) is still being measured.
    const { container } = renderChart(detail({ minutes: 21, live: true, updatedAt: START + 20 * 60_000 + 25_000 }), true)
    const g = geometry(container)
    expect(g.viewportEnd).toBe(19 * 60)
    expectAtRightEdge(g)
    // The axis and the navigator describe the same span: 20 plotted minutes.
    const navigator = container.querySelector('[data-hub-chart-navigator]')!
    // session-original: "Full stream · 1-min bars" on screen, the counts for screen readers.
    expect(navigator.querySelector('[data-chart-bar-size-label]')?.textContent).toBe('1-min bars')
    expect(navigator.querySelector('.hx-chart-navigator__bucket-count')?.textContent).toBe(', 20 of 20 minutes')
    expect(screen.getByRole('slider', { name: 'Chart view end' }).getAttribute('aria-valuetext'))
      .toBe('End 00:19:00; showing 00:00:00 to 00:19:00')
    // An honest marker above the right end says the chart is live.
    expect(container.querySelector('[data-chart-live-edge]')?.textContent).toBe('Live · updating')
    // The minute still being measured stays in the data table, marked.
    const updatingRows = [...container.querySelectorAll('[data-chart-data-updating]')]
    expect(updatingRows).toHaveLength(1)
    expect(updatingRows[0]!.closest('tr')?.textContent).toContain('00:20:00')
    expect(container.querySelector('[data-chart-data-alternative] > summary')?.textContent).toBe('▸Minute-by-minute table')
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
    const g = geometry(container)
    expect(g.viewportEnd).toBe(29 * 60)
    expectAtRightEdge(g)
    expect(container.querySelector('[data-chart-live-edge]')).toBeNull()
    expect(container.querySelector('[data-chart-data-updating]')).toBeNull()
  })

  it('keeps a 12-hour stream aligned at the right edge with bucketed bars', () => {
    const { container } = renderChart(detail({ minutes: 748 }), false)
    const g = geometry(container)
    expect(g.viewportEnd).toBe(747 * 60)
    // session-original lanes: 748 minutes still fit 1-minute bars on the 944 px plot,
    // and the last bar sits centred in the last slot
    expect(Math.abs(g.lastBarCentre - (g.plotEnd - g.slotPx / 2))).toBeLessThan(0.5)
    expect(Number(container.querySelector('[data-bench-plot]')?.getAttribute('data-activity-bucket-minutes'))).toBe(1)
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
    const g = geometry(container)
    expect(g.viewportEnd).toBe(13 * 60)
    expectAtRightEdge(g)
    expect(container.querySelector('[data-hub-chart-navigator] .hx-chart-navigator__bucket-count')?.textContent)
      .toBe(', 14 of 14 minutes')
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
    const g = geometry(container)
    expect(g.viewportEnd).toBe(13 * 60)
    expectAtRightEdge(g)
    expect(container.querySelector('[data-chart-live-edge]')?.textContent).toBe('Live · last data 00:14:00')
    expect(container.querySelector('[data-chart-live-edge]')?.getAttribute('data-chart-live-edge-tone')).toBe('live')
  })

  // d3-v2 session-original: every chart marker is off on each load.
  it('draws the live edge only with the Show on chart Live edge marker, offered only while there is one', () => {
    const { container } = renderChart(detail({ minutes: 21, live: true, updatedAt: START + 20 * 60_000 + 25_000 }), true, false)
    expect(container.querySelector('[data-chart-live-edge]')).toBeNull()
    const box = container.querySelector<HTMLInputElement>('[data-session-marker="live"]')!
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    expect(container.querySelector('[data-chart-live-edge]')?.textContent).toBe('Live · updating')
    cleanup()
    const ended = renderChart(detail({ minutes: 30 }), false, false)
    expect(ended.container.querySelector('[data-session-marker="live"]')).toBeNull()
    expect(ended.container.querySelector('[data-session-marker="moments"]')).not.toBeNull()
  })

  it('keeps the last minute of a confirmed ended stream, with no marker', () => {
    const data = detail({ minutes: 15, live: true, state: 'historical', lifecycleState: 'confirmed_ended', updatedAt: START + 25 * 60_000 })
    const { container } = renderChart(data, false)
    expect(geometry(container).viewportEnd).toBe(14 * 60)
    expect(container.querySelector('[data-chart-live-edge]')).toBeNull()
    expect(container.querySelector('[data-chart-data-updating]')).toBeNull()
  })
})
