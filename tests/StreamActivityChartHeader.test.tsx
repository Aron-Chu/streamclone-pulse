import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StreamActivityChartHeader } from '../src/ui/StreamActivityChartHeader.tsx'

describe('StreamActivityChartHeader', () => {
  it('shows Chat, Emotes, and Viewers as the legend', () => {
    const markup = renderToStaticMarkup(
      <StreamActivityChartHeader
        rightControl={<span>RANGE</span>}
        showViewerLegend
      />,
    )
    expect(markup).toContain('Stream activity')
    expect(markup).toContain('>Chat<')
    expect(markup).toContain('>Emotes<')
    expect(markup).toContain('>Viewers<')
    expect(markup).not.toContain('Chat trend')
    expect(markup).not.toContain('Emote trend')
    expect(markup).toContain('RANGE')
  })

  it('places Expand on the legend row, top-right outside the graph', () => {
    const markup = renderToStaticMarkup(
      <StreamActivityChartHeader
        expandControl={<button type="button">Expand</button>}
        rightControl={<span>RANGE</span>}
      />,
    )
    const titleAt = markup.indexOf('Stream activity')
    const rangeAt = markup.indexOf('RANGE')
    const expandSlotAt = markup.indexOf('data-chart-expand-slot="outside"')
    const legendAt = markup.indexOf('aria-label="Chart series legend"')
    expect(titleAt).toBeGreaterThanOrEqual(0)
    expect(rangeAt).toBeGreaterThan(titleAt)
    expect(legendAt).toBeGreaterThan(rangeAt)
    expect(expandSlotAt).toBeGreaterThan(legendAt)
    expect(markup).toContain('data-chart-header-controls="right"')
    expect(markup).toContain('>Expand<')
    expect(markup).not.toContain('data-chart-expand-slot="plot"')
  })
})
