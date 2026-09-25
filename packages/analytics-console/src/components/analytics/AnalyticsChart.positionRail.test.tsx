import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsStreamDetail } from '../../api.ts'
import AnalyticsChart from './AnalyticsChart.tsx'

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

afterEach(() => cleanup())

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

describe('AnalyticsChart position rail', () => {
  it('hides the overview rail below the five-minute interaction threshold', () => {
    const { container } = renderChart(4)
    expect(container.querySelector('[data-chart-position-rail="true"]')).toBeNull()
  })

  it('shows the purple overview rail for long streams', () => {
    const { container } = renderChart(91)
    const rail = container.querySelector<HTMLElement>('[data-chart-position-rail="true"]')
    expect(rail).not.toBeNull()
    expect(rail?.getAttribute('role')).toBe('slider')
    expect(rail?.getAttribute('aria-valuetext')).toContain('Viewing minutes')
    expect(rail?.style.background).toContain('rgba(255, 255, 255, 0.035)')
    expect(rail?.style.marginLeft).toBe('9%')
    expect(rail?.parentElement?.hasAttribute('data-session-chart-rail')).toBe(true)
    expect(rail?.closest('[data-session-chart-stack]')).not.toBeNull()
    expect(rail?.parentElement?.className).not.toContain('mt-1')
    expect(container.querySelector('[data-chart-x-axis="true"]')).not.toBeNull()
    expect(container.querySelector('[data-session-chart-range]')?.textContent)
      .toContain('Full stream')
    expect(container.querySelector('[data-chart-visible-range]')?.textContent)
      .toBe('00:00:00–01:31:00 / 01:31:00')
    expect(container.querySelector('[data-chart-rail-thumb]')?.getAttribute('style')).toContain('rgba(139, 92, 246')
    expect(screen.queryByRole('button', { name: 'End' })).toBeNull()
  })

  it('keeps the rail after zooming into a long stream', () => {
    const { container } = renderChart(91)
    const chart = container.querySelector<SVGElement>('svg[data-chart-line-weight-mode="viewport-adaptive"]')
    const fullWidth = Number(chart?.getAttribute('data-chart-primary-line-width'))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom chart in' }))
    expect(container.querySelector('[data-chart-position-rail="true"]')).not.toBeNull()
    expect(container.querySelector('[data-chart-viewport-readout]')?.textContent).not.toBe('Full')
    expect(container.querySelector('[data-session-chart-range]')?.getAttribute('data-chart-range-state'))
      .toBe('zoomed')
    expect(container.querySelector('[data-session-chart-range]')?.textContent)
      .toContain('Visible range')
    expect(container.querySelector('[data-chart-visible-range]')?.textContent)
      .toMatch(/^\d\d:\d\d:\d\d–\d\d:\d\d:\d\d \/ 01:31:00$/)
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
