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

  it('switches geometry atomically without a path crossfade', () => {
    const html = renderToStaticMarkup(
      <PulseOverviewChart rollups={rollups} selectedIndex={1} />,
    )

    expect(html).toContain('data-chart-path-state="overview"')
    expect(html).toContain('data-chart-path-state="detail"')
    expect(html).toContain('class="pulse-chart-overview-path"')
    expect(html).toContain('class="pulse-chart-detail-path"')
    expect(html).not.toContain('pulse-chart-motion-enabled')
    expect(html).toContain('data-chart-geometry="single"')
    expect(html).toMatch(/data-chart-path-state="overview"[^>]*opacity="0"/)
    expect(html).toMatch(/data-chart-layer="detail-overlay"[^>]*opacity="0.95"/)
    expect(shadowStyles).not.toContain('.pulse-chart-overview-path.pulse-chart-motion-enabled')
    expect(shadowStyles).not.toContain('.sc-chart-root .sc-chart-plot')
    expect(shadowStyles).not.toContain('transition: d')
  })

  it('shows one exact trace and one bucket band during transient preview', () => {
    const html = renderToStaticMarkup(
      <PulseOverviewChart rollups={rollups} previewIndex={1} />,
    )

    expect(html).toContain('data-chart-mode="preview"')
    expect(html).toContain('data-chart-presentation="preview"')
    expect(html).toContain('data-chart-geometry="single"')
    expect(html).toContain('data-chart-layer="detail-overlay"')
    expect(html).toMatch(/data-chart-path-state="overview"[^>]*opacity="0"/)
    expect(html).toMatch(/data-chart-layer="detail-overlay"[^>]*opacity="0.86"/)
    expect(html).toContain('data-chart-selection-band="preview"')
    expect(shadowStyles).toContain('[data-chart-selection-band="preview"]')
    expect(shadowStyles).toContain('pulse-selection-band 90ms')
    expect(html).not.toContain('data-chart-hover-marker')
    expect(html).not.toContain('data-chart-hover-band')
  })

  it('keeps a locked bucket on one same-color detail trace', () => {
    const html = renderToStaticMarkup(
      <PulseOverviewChart rollups={rollups} selectedIndex={1} />,
    )

    expect(html).toContain('data-chart-presentation="locked"')
    expect(html).toContain('data-chart-geometry="single"')
    expect(html).toContain('data-chart-bar-highlight="locked"')
    expect(html).toContain('opacity="0.98"')
    expect(html).not.toContain('rgba(161, 161, 170, 0.52)')
    expect(html).not.toContain('data-chart-layer="detail-future"')
    expect(html).not.toContain('data-chart-layer="detail-past"')
    expect(html).toContain('data-chart-bar-highlight="locked"')
    expect(html).not.toContain('data-chart-selection-halo=')
    expect(html).toContain('data-chart-locked-index="1"')
    expect(html).toContain('data-chart-selection-band="locked"')
    expect(shadowStyles).toContain('[data-chart-selection-band="locked"]')
    expect(shadowStyles).toContain('pulse-selection-band 180ms')
    expect(html).not.toContain('data-chart-hover-marker')
  })

  it('keeps detail hidden in the idle state', () => {
    const html = renderToStaticMarkup(<PulseOverviewChart rollups={rollups} />)

    expect(html).toContain('data-chart-presentation="idle"')
    expect(html).toMatch(/data-chart-layer="detail-overlay"[^>]*opacity="0"/)
  })

  it('keeps chart paths transition-free for reduced motion', () => {
    const html = renderToStaticMarkup(
      <PulseOverviewChart rollups={rollups} selectedIndex={1} reducedMotion />,
    )

    expect(html).not.toContain('pulse-chart-motion-enabled')
    expect(shadowStyles).toContain('.pulse-chart-overview-path,')
    expect(shadowStyles).toContain('.pulse-chart-detail-path {\n      transition: none !important;')
  })
})
