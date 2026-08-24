import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ChartPositionRail,
  LONG_STREAM_OVERVIEW_SECONDS,
  shouldShowChartRail,
} from '../src/ui/ChartPositionRail.tsx'

describe('ChartPositionRail', () => {
  it('shows a persistent rail once a timeline has meaningful coverage', () => {
    expect(shouldShowChartRail({ startSeconds: 0, endSeconds: 5 * 60 }, 5 * 60)).toBe(true)
    expect(shouldShowChartRail({ startSeconds: 0, endSeconds: 60 }, 60)).toBe(false)
    expect(shouldShowChartRail({ startSeconds: 0, endSeconds: 30 * 60 }, 60 * 60)).toBe(true)
  })

  it('shows the overview rail for long timelines at the full range', () => {
    const durationSeconds = LONG_STREAM_OVERVIEW_SECONDS
    expect(shouldShowChartRail({ startSeconds: 0, endSeconds: durationSeconds }, durationSeconds)).toBe(true)
  })

  it('renders an accessible rail with a bounded viewport thumb', () => {
    const html = renderToStaticMarkup(
      <ChartPositionRail
        viewport={{ startSeconds: 3_600, endSeconds: 7_200 }}
        durationSeconds={7_200}
        onViewportChange={() => undefined}
        ariaLabel="Chart zoom and position"
      />,
    )

    expect(html).toContain('data-chart-rail="true"')
    expect(html).toContain('data-chart-rail-thumb="true"')
    expect(html).toContain('aria-label="Chart zoom and position"')
    expect(html).toContain('aria-valuemax="7200"')
    expect(html).not.toContain('display:none')
  })

  it('can keep the visible range label with controls above the plot', () => {
    const html = renderToStaticMarkup(
      <ChartPositionRail
        viewport={{ startSeconds: 3_600, endSeconds: 7_200 }}
        durationSeconds={7_200}
        onViewportChange={() => undefined}
        hideRangeLabel
      />,
    )

    expect(html).toContain('data-chart-rail="true"')
    expect(html).not.toContain('Viewing 01:00:00')
  })

  it('renders an incoming stale viewport at the covered edge', () => {
    const html = renderToStaticMarkup(
      <ChartPositionRail
        viewport={{ startSeconds: 2_000, endSeconds: 4_000 }}
        durationSeconds={25_200}
        coverageStartSeconds={21_060}
        onViewportChange={() => undefined}
        ariaLabel="Chart zoom and position"
      />,
    )

    expect(html).toContain('aria-valuenow="21060"')
    expect(html).toContain('data-chart-rail-uncovered')
  })
})
