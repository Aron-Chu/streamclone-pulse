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

function renderChart(selectedRollup: AnalyticsStreamDetail['rollups'][number] | null = null, onSelectRollup = vi.fn()) {
  return render(
    <AnalyticsChart
      detail={detail}
      selectedEmotes={new Set(['Kappa'])}
      onSelectEmote={vi.fn()}
      selectedRollup={selectedRollup}
      onSelectRollup={onSelectRollup}
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

  it('provides a bounded minute table and announces the selected point', () => {
    const selected = detail.rollups[10]!
    const { container } = renderChart(selected)
    const alternative = container.querySelector('[data-chart-data-alternative]')
    expect(alternative?.querySelectorAll('tbody tr')).toHaveLength(121)
    expect(alternative?.textContent).toContain('120 of 180')
    expect(alternative?.querySelector('[data-chart-selected-data-row]')?.textContent).toContain('(pinned)')
    // Pages are named by their minutes and count from the stream start, so the
    // newest page (shown first) is the last one.
    const pageLabel = () => alternative?.querySelector('[data-chart-data-page-label]')?.textContent
    expect(pageLabel()).toBe('01:00:00–02:59:00 · 2 of 2')
    const later = screen.getByRole('button', { name: 'Later minutes' }) as HTMLButtonElement
    expect(later.disabled).toBe(true)
    expect(later.className).toContain('disabled:opacity-40')
    expect(later.className).toContain('border-white/10')
    fireEvent.click(screen.getByRole('button', { name: 'Earlier minutes' }))
    expect(pageLabel()).toBe('00:00:00–00:59:00 · 1 of 2')
    expect((screen.getByRole('button', { name: 'Earlier minutes' }) as HTMLButtonElement).disabled).toBe(true)
    expect(alternative?.querySelectorAll('tbody tr')).toHaveLength(60)
    // The summary shows a disclosure marker; the portal's flex summary hides the native one.
    expect(alternative?.querySelector('summary > [aria-hidden="true"]')?.textContent).toBe('▸')
    expect(container.querySelector('[data-chart-selection-announcement]')?.textContent).toContain('Selected 00:10:00–00:11:00')
  })

  it('keeps a pinned minute when the measured table is opened', () => {
    const onSelectRollup = vi.fn()
    const { container } = renderChart(detail.rollups[10]!, onSelectRollup)
    const alternative = container.querySelector('[data-chart-data-alternative]')!
    const summary = alternative.querySelector('summary')!
    fireEvent.pointerDown(summary)
    fireEvent.click(summary)
    expect(onSelectRollup).not.toHaveBeenCalled()
    expect(alternative.querySelector('[data-chart-selected-data-row]')?.textContent).toContain('(pinned)')
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

  it('leaves no blank band under the chart while nothing is pinned', () => {
    const { container } = renderChart()
    const slot = container.querySelector<HTMLElement>('[data-chart-selected-detail-slot]')!
    expect(slot).not.toBeNull()
    expect(slot.className).toBe('')
    expect(slot.childElementCount).toBe(0)

    cleanup()
    const pinned = render(
      <AnalyticsChart
        detail={detail}
        selectedEmotes={new Set(['Kappa'])}
        onSelectEmote={vi.fn()}
        selectedRollup={detail.rollups[20]!}
        onSelectRollup={vi.fn()}
        viewMode="overview"
        onViewModeChange={vi.fn()}
        selectedDetail={<p>Pinned minute</p>}
      />,
    )
    const pinnedSlot = pinned.container.querySelector<HTMLElement>('[data-chart-selected-detail-slot]')!
    expect(pinnedSlot.className).toBe('mt-3')
    expect(pinnedSlot.querySelector('[data-chart-selected-detail]')?.textContent).toBe('Pinned minute')
  })
})
