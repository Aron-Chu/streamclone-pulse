import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsStreamDetail } from '../../api.ts'
import AnalyticsChart from './AnalyticsChart.tsx'
import { setStackWidth } from './__fixtures__/sessionChartHarness.ts'

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
  it('keeps one 40 px toolbar row: series seg, one range seg, Expand and Show on chart; the readout sits above Games played', () => {
    const { container } = renderChart()
    const part = container.querySelector('[data-session-chart-part]')!
    const bar = part.querySelector('[data-chart-focus-bar]')!
    expect(container.querySelectorAll('[data-chart-focus-bar]')).toHaveLength(1)
    expect(bar.classList.contains('ssc-tool')).toBe(true)
    // session-original .cb-tool: series seg, range seg, Expand, Show on chart, in that order
    const order = [
      '[data-session-series-seg]',
      '[data-session-range-seg]',
      '[data-session-expand]',
      '[data-session-show-toggle]',
    ].map(sel => [...bar.querySelectorAll('*')].indexOf(bar.querySelector(sel)!))
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(bar.querySelectorAll('[data-session-series-seg] button')).toHaveLength(4)
    expect(container.querySelectorAll('[data-session-range-seg]')).toHaveLength(1)
    // The readout is the selection hint (one row, polite live region), on its
    // own line above Games played (session-original .po-ro-row), not in the toolbar.
    expect(bar.querySelector('[data-session-readout]')).toBeNull()
    const row = container.querySelector('[data-chart-header-block] [data-chart-hover-readout-row]')!
    const readout = row.querySelector('[data-session-readout]')!
    expect(readout.hasAttribute('data-chart-selection-hint')).toBe(true)
    expect(readout.getAttribute('aria-live')).toBe('polite')
    expect(row.compareDocumentPosition(part) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Clear shows only while something is pinned.
    expect((row.querySelector('[data-session-readout-clear]') as HTMLButtonElement).hidden).toBe(true)
    // No "Games played" header: each poster carries its run time.
    expect(container.querySelector('[data-games-played-header]')).toBeNull()
    // Spikes, the overlay focus row and the plot-on-chart strip are gone (plan §1.2).
    expect(screen.queryByRole('button', { name: /spikes/i })).toBeNull()
    expect(container.querySelector('[data-chart-overlay-focus-row]')).toBeNull()
    expect(container.querySelector('[data-chart-overlay-selector]')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Expand' })).toHaveLength(1)
    expect(container.querySelector('[data-selected-moment-shell]')).toBeNull()
    // The plotted emotes moved to the Emotes on chart line under the chart (session-original .po-eo).
    expect(bar.querySelector('[data-session-overlay-toggle], [data-session-emotes-on-chart]')).toBeNull()
    const line = part.querySelector('[data-session-emotes-on-chart]')!
    const stack = part.querySelector('[data-session-chart-stack]')!
    expect(stack.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps series, range, Expand and Show on chart in the one toolbar row above the plot at every width', () => {
    // d3-v2 session-original .cb-tool: the row wraps on narrow parts instead of
    // moving controls under the plot (prod's centre column is 1090 px at 2048).
    for (const width of [340, 1090, 1400]) {
      const restore = setStackWidth(width)
      try {
        const { container } = renderChart()
        const part = container.querySelector('[data-session-chart-part]')!
        expect(part.getAttribute('data-session-controls'), `${width}`).toBe('toolbar')
        expect(part.querySelector('.ssc-tool2'), `${width}`).toBeNull()
        const bar = part.querySelector('[data-chart-focus-bar]')!
        expect(container.querySelectorAll('[data-session-range-seg]')).toHaveLength(1)
        expect(screen.getAllByRole('button', { name: 'Expand' })).toHaveLength(1)
        for (const sel of ['[data-session-series-seg]', '[data-session-range-seg]', '[data-session-expand]', '[data-session-show-toggle]']) {
          expect(bar.querySelector(sel), `${width} ${sel} in the toolbar`).not.toBeNull()
        }
        const stack = part.querySelector('[data-session-chart-stack]')!
        expect(bar.compareDocumentPosition(stack) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      } finally {
        cleanup()
        restore()
      }
    }
  })

  it('provides a bounded minute table and announces the selected point', () => {
    const selected = detail.rollups[10]!
    const { container } = renderChart(selected)
    const alternative = container.querySelector('[data-chart-data-alternative]')
    expect(alternative?.querySelectorAll('tbody tr')).toHaveLength(121)
    // session-original .po-md: no counts in the summary; the pager names the page.
    expect(alternative?.querySelector('summary')?.textContent).toBe('▸Minute-by-minute table')
    expect(alternative?.querySelector('[data-chart-selected-data-row]')?.textContent).toContain('(pinned)')
    // Pages are named by their minutes and count from the stream start, so the
    // newest page (shown first) is the last one.
    const pageLabel = () => alternative?.querySelector('[data-chart-data-page-label]')?.textContent
    expect(pageLabel()).toBe('01:00:00–02:59:00 · 2 of 2')
    const later = screen.getByRole('button', { name: 'Later minutes' }) as HTMLButtonElement
    expect(later.disabled).toBe(true)
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

  it('draws the session-original lanes: viewers, chat and emotes, each with its caption', () => {
    const { container } = render(
      <AnalyticsChart
        detail={detail}
        selectedEmotes={new Set(['Kappa'])}
        onSelectEmote={vi.fn()}
        selectedRollup={null}
        onSelectRollup={vi.fn()}
        viewMode="overview"
        onViewModeChange={vi.fn()}
        viewerCaption={{ peak: 200, avg: 120 }}
      />,
    )
    const plot = container.querySelector<HTMLElement>('.spc-plot')!
    expect(plot.style.height).toBe('440px')
    // One lane per series under the 22 px category band (no shift when games arrive),
    // each captioned at its top; the rates panel is gone.
    const caption = (key: string) => container.querySelector<HTMLElement>(`[data-chart-lane-caption="${key}"]`)!
    expect([...container.querySelectorAll('[data-chart-lane-caption]')].map(el => el.getAttribute('data-chart-lane-caption')))
      .toEqual(['viewers', 'chat', 'emotes'])
    // viewers first, just under the band; each lower lane starts lower, all inside the plot
    const tops = ['viewers', 'chat', 'emotes'].map(key => parseFloat(caption(key).style.top))
    expect(tops[0]).toBe(22 + 1)
    expect(tops[1]!).toBeGreaterThan(tops[0]!)
    expect(tops[2]!).toBeGreaterThan(tops[1]!)
    expect(tops[2]!).toBeLessThan(440)
    expect(container.querySelector('[data-chart-scale-row="rates"]')).toBeNull()
    // The viewers caption is the header's peak (D5), not a chart-side figure; the
    // average joins it only with Show on chart's Averages (off on every load).
    expect(caption('viewers').textContent?.replace(/\s+/g, ' ')).toContain('peak 200')
    // No peak caps (F3): bars only, no tick marks above them.
    expect(container.querySelectorAll('rect.spc-bar').length).toBeGreaterThan(0)
    expect(container.querySelector('[data-activity-peak-cap], .spc-cap')).toBeNull()
  })

  it('expands the plot 440 -> 580 px and back without being forced open', () => {
    const { container } = renderChart()
    const plot = () => container.querySelector<HTMLElement>('.spc-plot')!
    const expand = screen.getByRole('button', { name: 'Expand' })
    expect(plot().style.height).toBe('440px')
    expect(expand.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(expand)
    expect(plot().style.height).toBe('580px')
    expect(expand.getAttribute('aria-pressed')).toBe('true')
    // Expand changes height only: the bars keep their D2 level.
    const level = container.querySelector('[data-bench-plot]')?.getAttribute('data-activity-bucket-minutes')
    fireEvent.click(expand)
    expect(plot().style.height).toBe('440px')
    expect(expand.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('[data-bench-plot]')?.getAttribute('data-activity-bucket-minutes')).toBe(level)
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

  it("ends the posters' run times with the newest measured minute, not a stale games segment (session-original DATA_END)", () => {
    const { container } = render(
      <AnalyticsChart
        detail={detail}
        games={[
          { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 1_800 },
          // The games API's last segment runs on for ~35 h past the 180 measured minutes.
          { gameName: 'Grand Theft Auto V', offsetSeconds: 1_800, durationSeconds: 125_000 },
        ]}
        selectedEmotes={new Set(['Kappa'])}
        onSelectEmote={vi.fn()}
        selectedRollup={null}
        onSelectRollup={vi.fn()}
        viewMode="overview"
        onViewModeChange={vi.fn()}
      />,
    )
    const runTimes = [...container.querySelectorAll('[data-games-played-run-time]')].map(el => el.textContent)
    // (fix, 10-30) GP-3: the cut-off game says its length is not known ("+").
    expect(runTimes).toEqual(['30m', '2h 30m+'])
  })
})
