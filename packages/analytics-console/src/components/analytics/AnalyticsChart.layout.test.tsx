import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsStreamDetail } from '../../api.ts'
import AnalyticsChart from './AnalyticsChart.tsx'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({
  useConsoleMotion: () => ({ motionEnabled: false }),
}))

const detail = {
  stream: {
    streamId: 'layout-chart-stream',
    startedAt: '2026-07-31T00:00:00.000Z',
    peakViewers: 200,
    avgViewers: 120,
  },
  rollups: Array.from({ length: 180 }, (_, index) => ({
    minuteTs: new Date(Date.parse('2026-07-31T00:00:00.000Z') + index * 60_000).toISOString(),
    viewerAvg: 100 + (index % 40),
    chatCount: 10 + (index % 12),
    totalEmoteCount: 2 + (index % 9),
    emotes: { Kappa: 4 + (index % 8) },
  })),
  topEmotes: [{ key: 'Kappa', name: 'Kappa', count: 11, provider: '7tv' }],
  sources: [],
} as unknown as AnalyticsStreamDetail

afterEach(() => cleanup())

function renderChart() {
  return render(
    <AnalyticsChart
      detail={detail}
      selectedEmotes={new Set(['Kappa'])}
      onSelectEmote={vi.fn()}
      selectedRollup={null}
      onSelectRollup={vi.fn()}
      viewMode="overview"
      onViewModeChange={vi.fn()}
    />,
  )
}

describe('AnalyticsChart stable regions', () => {
  it('separates the readout from controls and reserves the moment shell', () => {
    const { container } = renderChart()
    const readout = container.querySelector('[data-chart-hover-readout-row]')

    expect(readout?.className).toContain('h-5')
    expect(container.querySelectorAll('[data-chart-overlay-selector]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-chart-focus-bar]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-chart-primary-focus-row]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-chart-focus-utilities]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-chart-overlay-focus-row]')).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Show chart spikes' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Expand activity detail' })).toHaveLength(1)
    expect(container.querySelector('[data-selected-moment-shell]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Expand activity detail' })).toBeTruthy()
  })

  it('gives the portal viewer, chat, and emote lanes equal height', () => {
    const { container } = renderChart()
    const chart = container.querySelector('[data-chart-layout-mode="equal-signals"]')
    const viewer = Number(chart?.getAttribute('data-viewer-lane-height'))
    const chat = Number(chart?.getAttribute('data-chat-lane-height'))
    const emotes = Number(chart?.getAttribute('data-emote-lane-height'))
    const plottedEmotes = Number(chart?.getAttribute('data-plotted-emote-lane-height'))

    expect(viewer).toBeGreaterThan(0)
    expect(Math.abs(viewer - chat)).toBeLessThan(0.02)
    expect(Math.abs(viewer - emotes)).toBeLessThan(0.02)
    expect(plottedEmotes).toBeGreaterThan(0)
    expect(plottedEmotes).toBeLessThan(viewer)
    expect(chart?.getAttribute('data-plotted-emote-lane-position')).toBe('after-bars')
    expect(container.querySelector('[data-plotted-emote-lane="true"]')).toBeTruthy()
  })

  it('expands and collapses the activity geometry without being forced back open', () => {
    const { container } = renderChart()
    const activity = () => container.querySelector('[data-activity-zone-height]')?.getAttribute('data-activity-zone-height')
    const collapsedHeight = activity()
    const chartSvg = () => container.querySelector('svg[aria-label="Analytics timeline chart"]') as SVGSVGElement | null
    const collapsedSvgHeight = chartSvg()?.style.height

    const collapsedBars = container.querySelectorAll('[data-activity-bar]')

    fireEvent.click(screen.getByRole('button', { name: 'Expand activity detail' }))
    expect(activity()).not.toBe(collapsedHeight)
    expect(chartSvg()?.style.height).not.toBe(collapsedSvgHeight)
    // Shorter timelines already render every available bucket while collapsed;
    // Expand grows the lanes without fabricating additional bars.
    expect(container.querySelectorAll('[data-activity-bar]').length).toBeGreaterThanOrEqual(collapsedBars.length)
    expect(screen.getByRole('button', { name: 'Collapse activity detail' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse activity detail' }))
    expect(activity()).toBe(collapsedHeight)
    expect(chartSvg()?.style.height).toBe(collapsedSvgHeight)
    expect(screen.getByRole('button', { name: 'Expand activity detail' }).getAttribute('aria-pressed')).toBe('false')
  })
})
