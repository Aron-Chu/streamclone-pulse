import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StreamActivityChartHeader } from '../src/ui/StreamActivityChartHeader.tsx'

describe('StreamActivityChartHeader overlay legend row', () => {
  it('reserves the overlay legend row even when empty so plotting cannot shift the chart', () => {
    const markup = renderToStaticMarkup(
      <StreamActivityChartHeader overlayLegend={undefined} />,
    )
    expect(markup).toContain('data-chart-overlay-legend-row="empty"')
    // The row always exists with a fixed min-height.
    const row = markup.match(/style="([^"]+)" data-chart-overlay-legend-row/)?.[1] ?? ''
    expect(row).toContain('min-height:26px')
    expect(row).toContain('display:flex')
  })

  it('renders chips inside the same reserved row when content is present', () => {
    const markup = renderToStaticMarkup(
      <StreamActivityChartHeader
        overlayLegend={
          <span data-overlay-legend-chip="1">Chip</span>
        }
      />,
    )
    expect(markup).toContain('data-chart-overlay-legend-row="content"')
    expect(markup).toContain('data-overlay-legend-chip="1"')
    const row = markup.match(/style="([^"]+)" data-chart-overlay-legend-row/)?.[1] ?? ''
    expect(row).toContain('min-height:26px')
  })

  it('keeps the legend row absent of extra height when empty is indistinguishable from content height', () => {
    const empty = renderToStaticMarkup(<StreamActivityChartHeader />)
    const full = renderToStaticMarkup(
      <StreamActivityChartHeader overlayLegend={<span>Emoji</span>} />,
    )
    // Same reserved row contract in both states.
    expect(empty).toContain('data-chart-overlay-legend-row="empty"')
    expect(full).toContain('data-chart-overlay-legend-row="content"')
    expect(empty).toContain('min-height:26px')
    expect(full).toContain('min-height:26px')
  })
})