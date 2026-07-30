import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PulseOverviewChart } from '../src/ui/PulseOverviewChart.tsx'

describe('PulseOverviewChart progressive disclosure', () => {
  const rollups = [
    { offsetSeconds: 0, viewerCount: 100, chatCount: 10, sevenTvEmoteCount: 3 },
    { offsetSeconds: 60, viewerCount: 140, chatCount: 25, sevenTvEmoteCount: 9 },
    { offsetSeconds: 120, viewerCount: 120, chatCount: 18, sevenTvEmoteCount: 5 },
  ]

  it('renders one dominant overview line with dormant detail layers at rest', () => {
    const html = renderToStaticMarkup(
      <PulseOverviewChart
        reducedMotion
        rollups={rollups}
      />,
    )

    expect(html).toContain('data-chart-layer="overview"')
    expect(html).toContain('data-chart-layer="detail-past"')
    expect(html).toContain('data-chart-layer="detail-future"')
    expect(html).toContain('data-chart-scrubber="true"')
    expect(html).toContain('data-chart-primary-signals="chat emotes"')
    expect(html).toContain('data-chart-context-signals="viewers"')
    expect(html).toContain('fill="none" stroke="#22d3ee"')
    expect(html).toContain('data-chart-mode="overview"')
    expect(html).toContain('data-chart-layer="detail" opacity="0"')
    expect(html).toContain('data-chart-layer="detail-annotations" opacity="0"')
    expect(html).toContain('stroke-width="2.6" opacity="0.96"')
  })

  it('fully replaces the overview with detailed past and faded future after selection', () => {
    const html = renderToStaticMarkup(
      <PulseOverviewChart
        reducedMotion
        rollups={rollups}
        selectedIndex={1}
      />,
    )

    expect(html).toContain('data-chart-mode="detail"')
    expect(html).toContain('data-chart-layer="detail" opacity="1"')
    expect(html).toContain('data-chart-layer="detail-annotations" opacity="1"')
    expect(html).toContain('data-chart-layer="detail-future"')
    expect(html).toContain('stroke="rgba(161, 161, 170, 0.52)"')
  })
})
