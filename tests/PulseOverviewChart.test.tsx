import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ComponentProps } from 'react'
import type { ExtensionRollup } from '../src/shared/messages.ts'
import { PulseOverviewChart } from '../src/ui/PulseOverviewChart.tsx'

/**
 * Morph-layer inspection attributes (`data-morph-layer`) were retired from
 * PulseOverviewChart when the chart moved to lane/bar rendering. MorphPath
 * remains available for other surfaces, but overview observability now uses
 * data-testid / data-chart-series / domain + viewer axis attributes.
 */

const rollups: ExtensionRollup[] = [
  { offsetSeconds: 0, chatCount: 10, sevenTvEmoteCount: 2, viewerCount: 100 },
  { offsetSeconds: 60, chatCount: 40, sevenTvEmoteCount: 8, viewerCount: 140 },
  { offsetSeconds: 120, chatCount: 15, sevenTvEmoteCount: 3, viewerCount: 120 },
]

function renderChart(
  selectedIndex: number | null = null,
  overrides: Partial<ComponentProps<typeof PulseOverviewChart>> = {},
) {
  return renderToStaticMarkup(
    <PulseOverviewChart
      rollups={rollups}
      detailRollups={rollups}
      durationSeconds={180}
      selectedIndex={selectedIndex}
      {...overrides}
      showViewerStrip
      onSelectIndex={() => undefined}
      onClearSelection={() => undefined}
      reducedMotion
    />,
  )
}

function renderLateChart() {
  return renderToStaticMarkup(
    <PulseOverviewChart
      rollups={[
        { offsetSeconds: 180, chatCount: 12, sevenTvEmoteCount: 2, viewerCount: 100 },
        { offsetSeconds: 240, chatCount: 18, sevenTvEmoteCount: 3, viewerCount: 120 },
        { offsetSeconds: 300, chatCount: 9, sevenTvEmoteCount: 1, viewerCount: 110 },
      ]}
      durationSeconds={600}
      selectedIndex={null}
      showViewerStrip
      onSelectIndex={() => undefined}
      onClearSelection={() => undefined}
      reducedMotion
    />,
  )
}

function renderSparseChart() {
  return renderToStaticMarkup(
    <PulseOverviewChart
      rollups={[{ offsetSeconds: 300, chatCount: 18, sevenTvEmoteCount: 4 }]}
      durationSeconds={360}
      showViewerStrip={false}
      reducedMotion
    />,
  )
}

describe('PulseOverviewChart current contract', () => {
  it('exposes overview observability attributes without morph inspection layers', () => {
    const markup = renderChart()

    expect(markup).toContain('data-testid="pulse-overview-chart"')
    expect(markup).toContain('data-chart-series="chat-bars"')
    expect(markup).toContain('data-chart-series="emote-bars"')
    expect(markup).toContain('data-viewer-axis-max=')
    expect(markup).toContain('data-viewer-raw-max=')
    expect(markup).not.toContain('data-morph-layer=')
    expect(markup.toLowerCase()).not.toContain('tooltip')
  })

  it('keeps chat and emote lanes paintable for ordinary samples', () => {
    const markup = renderChart()
    const chatGroup = markup.split('data-chart-series="chat-bars"')[1]?.split('</g>')[0] ?? ''
    const emoteGroup = markup.split('data-chart-series="emote-bars"')[1]?.split('</g>')[0] ?? ''
    expect((chatGroup.match(/<rect/g) ?? []).length).toBeGreaterThan(0)
    expect((emoteGroup.match(/<rect/g) ?? []).length).toBeGreaterThan(0)
  })

  it('keeps selection props from crashing the SSR contract', () => {
    const preview = renderChart(null, { previewIndex: 1 })
    const pinned = renderChart(1)
    expect(preview).toContain('data-testid="pulse-overview-chart"')
    expect(pinned).toContain('data-testid="pulse-overview-chart"')
  })

  it('keeps a late coverage chart on the full domain', () => {
    const markup = renderLateChart()
    expect(markup).toContain('data-testid="pulse-overview-chart"')
    const chatGroup = markup.split('data-chart-series="chat-bars"')[1]?.split('</g>')[0] ?? ''
    const bars = [...chatGroup.matchAll(/<rect[^>]*\sx="([\d.]+)"[^>]*\swidth="([\d.]+)"/g)]
      .map(match => ({ x: Number(match[1]), width: Number(match[2]) }))
    expect(bars.length).toBeGreaterThan(0)
    expect(bars.every(bar => Number.isFinite(bar.x) && Number.isFinite(bar.width) && bar.width >= 0)).toBe(true)
  })

  it('keeps a sparse valid sample paintable', () => {
    const markup = renderSparseChart()
    const chatGroup = markup.split('data-chart-series="chat-bars"')[1]?.split('</g>')[0] ?? ''
    expect((chatGroup.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(1)
  })

  it('keeps ordinary coarse samples paintable instead of empty lanes', () => {
    const markup = renderToStaticMarkup(
      <PulseOverviewChart
        rollups={[
          { offsetSeconds: 0, chatCount: 10, sevenTvEmoteCount: 2 },
          { offsetSeconds: 900, chatCount: 20, sevenTvEmoteCount: 4 },
          { offsetSeconds: 1800, chatCount: 15, sevenTvEmoteCount: 3 },
          { offsetSeconds: 2700, chatCount: 25, sevenTvEmoteCount: 5 },
        ]}
        durationSeconds={3600}
        showViewerStrip={false}
        reducedMotion
      />,
    )
    const chatGroup = markup.split('data-chart-series="chat-bars"')[1]?.split('</g>')[0] ?? ''
    expect((chatGroup.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(1)
  })

  it('does not revive morph inspection attributes on overview', () => {
    const markup = renderChart(1)
    expect(markup).not.toMatch(/data-morph-layer=/)
    expect(markup).not.toMatch(/data-morph-series=/)
  })
})
