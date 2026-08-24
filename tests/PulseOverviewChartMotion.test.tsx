import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PulseOverviewChart } from '../src/ui/PulseOverviewChart.tsx'
import { shadowStyles } from '../src/ui/theme.ts'

describe('PulseOverviewChart bucket-lock motion', () => {
  const rollups = [
    { offsetSeconds: 0, viewerCount: 100, chatCount: 10, sevenTvEmoteCount: 3 },
    { offsetSeconds: 60, viewerCount: 140, chatCount: 25, sevenTvEmoteCount: 9 },
    { offsetSeconds: 120, viewerCount: 120, chatCount: 18, sevenTvEmoteCount: 5 },
  ]

  it('crossfades overview/detail layers without a path-geometry transition', () => {
    const html = renderToStaticMarkup(
      <PulseOverviewChart rollups={rollups} selectedIndex={1} />,
    )

    expect(html).toContain('data-chart-path-state="overview"')
    expect(html).toContain('data-chart-path-state="detail"')
    expect(html).toContain('pulse-chart-overview-path pulse-chart-motion-enabled')
    expect(html).toContain('pulse-chart-detail-path pulse-chart-motion-enabled')
    expect(shadowStyles).toContain('.pulse-chart-overview-path.pulse-chart-motion-enabled')
    expect(shadowStyles).toContain('transition: opacity 160ms cubic-bezier(0.22, 1, 0.36, 1);')
    expect(shadowStyles).not.toContain('.sc-chart-root .sc-chart-plot')
    expect(shadowStyles).not.toContain('transition: d')
  })

  it('keeps transient list preview on overview geometry', () => {
    const html = renderToStaticMarkup(
      <PulseOverviewChart rollups={rollups} previewIndex={1} />,
    )

    expect(html).toContain('data-chart-mode="signals"')
    expect(html).toMatch(/data-chart-path-state="overview"[^>]*opacity="0\.58"/)
    expect(html).toMatch(/data-chart-path-state="detail"[^>]*opacity="0"/)
  })

  it('disables the chart path transition for reduced motion', () => {
    const html = renderToStaticMarkup(
      <PulseOverviewChart rollups={rollups} selectedIndex={1} reducedMotion />,
    )

    expect(html).not.toContain('pulse-chart-motion-enabled')
    expect(shadowStyles).toContain('.pulse-chart-overview-path,')
    expect(shadowStyles).toContain('.pulse-chart-detail-path {\n      transition: none !important;')
  })
})
