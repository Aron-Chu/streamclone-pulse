import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PulseOverviewChart } from '../src/ui/PulseOverviewChart.tsx'

describe('PulseOverviewChart signal disclosure', () => {
  const rollups = [
    { offsetSeconds: 0, viewerCount: 100, chatCount: 10, sevenTvEmoteCount: 3 },
    { offsetSeconds: 60, viewerCount: 140, chatCount: 25, sevenTvEmoteCount: 9 },
    { offsetSeconds: 120, viewerCount: 120, chatCount: 18, sevenTvEmoteCount: 5 },
  ]

  it('keeps viewer, chat, and emote trends visible at rest without bars or composite overview', () => {
    const html = renderToStaticMarkup(<PulseOverviewChart reducedMotion rollups={rollups} />)

    expect(html).toContain('data-chart-mode="signals"')
    expect(html).toContain('data-chart-layer="signals" opacity="1"')
    expect(html).toContain('data-chart-layer="interaction" opacity="0"')
    expect(html).toContain('data-chart-series="viewers"')
    expect(html).toContain('data-chart-series="chat"')
    expect(html).toContain('data-chart-series="emotes"')
    expect(html).not.toContain('data-chart-layer="overview"')
    expect(html).toContain('data-chart-scrubber="true"')
  })

  it('keeps bars, marker, and committed time identity visible after pointer leave', () => {
    const html = renderToStaticMarkup(
      <PulseOverviewChart reducedMotion rollups={rollups} selectedIndex={1} />,
    )

    expect(html).toContain('data-chart-mode="detail"')
    expect(html).toContain('data-chart-active-index="1"')
    expect(html).toContain('data-chart-locked-index="1"')
    expect(html).toContain('data-chart-layer="interaction" opacity="1"')
    expect(html).toContain('stroke="rgba(var(--pulse-accent-soft-rgb, 196, 181, 253), 0.88)"')
    expect(html).toContain('>00:01:00<')
  })

  it('keeps the committed lock primary while another bucket is a muted preview', () => {
    const html = renderToStaticMarkup(
      <PulseOverviewChart
        reducedMotion
        rollups={rollups}
        selectedIndex={0}
        previewIndex={2}
      />,
    )

    expect(html).toContain('data-chart-active-index="0"')
    expect(html).toContain('data-chart-locked-index="0"')
    expect(html).toContain('data-chart-preview-index="2"')
    expect(html).toContain('data-chart-hover-band="muted"')
    expect(html).toContain('>00:00:00<')
  })
})
