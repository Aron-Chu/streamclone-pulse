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
})
