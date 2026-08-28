import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PulseMultiSignalChartInner } from '../src/PulseMultiSignalChart.tsx'
import { viewerHistoryValues, resolveViewerInteractionState } from '../src/viewerInteraction.ts'

const rollups = [
  { minuteTs: '2026-07-31T00:00:00.000Z', viewerAvg: 100, viewerSamples: 2, chatCount: 10, totalEmoteCount: 2 },
  { minuteTs: '2026-07-31T00:01:00.000Z', viewerAvg: 130, viewerSamples: 2, chatCount: 12, totalEmoteCount: 3 },
  { minuteTs: '2026-07-31T00:02:00.000Z', viewerAvg: 115, viewerSamples: 2, chatCount: 9, totalEmoteCount: 1 },
  { minuteTs: '2026-07-31T00:03:00.000Z', viewerAvg: 140, viewerSamples: 2, chatCount: 14, totalEmoteCount: 4 },
]

function renderChart(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <PulseMultiSignalChartInner
      rollups={rollups}
      motionEnabled={false}
      variant="console"
      chromeless
      {...props}
    />,
  )
}

function layerElement(markup: string, layer: string): string {
  const escaped = layer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return markup.match(new RegExp(`<[^>]*data-viewer-layer="${escaped}"[^>]*>`))?.[0] ?? ''
}

function attribute(markup: string, layer: string, name: string): string | null {
  const element = layerElement(markup, layer)
  return element.match(new RegExp(`${name}="([^"]+)"`))?.[1] ?? null
}

describe('viewer static inspection layers', () => {
  it('keeps one idle, before, after, area, and cursor node at rest', () => {
    const markup = renderChart()

    for (const layer of ['idle', 'before-cursor', 'after-cursor', 'area', 'cursor']) {
      expect((markup.match(new RegExp(`data-viewer-layer="${layer}"`, 'g')) ?? [])).toHaveLength(1)
    }
    expect(attribute(markup, 'idle', 'opacity')).toBe('0.85')
    expect(attribute(markup, 'before-cursor', 'opacity')).toBe('0')
    expect(attribute(markup, 'after-cursor', 'opacity')).toBe('0')
    expect(attribute(markup, 'cursor', 'opacity')).toBe('0')
    expect(markup).not.toContain('viewer-dot')
    expect(markup).not.toContain('sc-viewer-primary-line')
    expect(markup).toContain('mask=')
    expect(markup).toContain('vector-effect="non-scaling-stroke"')
  })

  it('shows both clipped detail layers with the same immutable d while inspecting', () => {
    const markup = renderChart({ selectedRollup: rollups[1] })
    const before = layerElement(markup, 'before-cursor')
    const after = layerElement(markup, 'after-cursor')
    const beforeD = before.match(/d="([^"]+)"/)?.[1]
    const afterD = after.match(/d="([^"]+)"/)?.[1]

    expect(beforeD).toBeTruthy()
    expect(afterD).toBe(beforeD)
    expect(attribute(markup, 'before-cursor', 'opacity')).toBe('0.85')
    // Selection is not a coverage signal: valid history keeps the active hue,
    // while its later portion is deliberately quieter than the focused past.
    expect(Number(attribute(markup, 'after-cursor', 'opacity'))).toBeLessThan(0.85)
    expect(Number(attribute(markup, 'after-cursor', 'opacity'))).toBeGreaterThan(0.2)
    expect(attribute(markup, 'after-cursor', 'stroke')).toBe('#22d3ee')
    expect(attribute(markup, 'cursor', 'stroke-dasharray')).toBe('2 5')
    expect(attribute(markup, 'cursor', 'opacity')).toBe('1')
  })

  it('applies the shared future fade to viewer and activity lanes while pinned', () => {
    const markup = renderChart({ selectedRollup: rollups[1] })
    expect(Number(attribute(markup, 'after-cursor', 'opacity'))).toBeLessThan(0.85)
    expect(markup).toContain('data-activity-future-fade="true"')
    expect(markup).toContain('activityFadeMaskApply')
  })

  it('keeps the raw selected value in the readout while display geometry is fitted', () => {
    const markup = renderChart({
      variant: 'compact',
      chromeless: false,
      // Plot/hover use sampled average; KPI latest stays separate.
      selectedRollup: { ...rollups[1], viewerAvg: 77, viewerSamples: 3, viewerLatest: 99 },
    })
    expect(markup).toContain('viewers 77')
  })

  it('uses full-resolution detail rollups on the shared timestamp axis', () => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={[
          { minuteTs: '2026-07-31T00:00:00.000Z', viewerAvg: 100, viewerSamples: 2, chatCount: 10 },
          { minuteTs: '2026-07-31T00:03:00.000Z', viewerAvg: 110, viewerSamples: 2, chatCount: 12 },
        ]}
        detailRollups={[
          { minuteTs: '2026-07-31T00:00:00.000Z', viewerAvg: 100, viewerSamples: 2, chatCount: 10 },
          { minuteTs: '2026-07-31T00:01:00.000Z', viewerAvg: 900, viewerSamples: 2, chatCount: 20 },
          { minuteTs: '2026-07-31T00:02:00.000Z', viewerAvg: 120, viewerSamples: 2, chatCount: 16 },
          { minuteTs: '2026-07-31T00:03:00.000Z', viewerAvg: 110, viewerSamples: 2, chatCount: 12 },
        ]}
        motionEnabled={false}
        variant="console"
        chromeless
      />,
    )

    expect(markup).toContain('>927<')
  })
})

describe('viewer interaction state helpers', () => {
  it('preserves null gaps instead of converting after-cursor values to zero', () => {
    expect(viewerHistoryValues([10, 20, null, 40], 1)).toEqual([10, 20, null, null])
    expect(viewerHistoryValues([10, 20], null)).toEqual([])
  })

  it('resolves preview, scrub, and lock states without a path morph', () => {
    expect(resolveViewerInteractionState({ hoverIndex: null, selectedIndex: null })).toBe('rest')
    expect(resolveViewerInteractionState({ hoverIndex: 1, selectedIndex: null })).toBe('hover-preview')
    expect(resolveViewerInteractionState({ hoverIndex: 1, selectedIndex: 1 })).toBe('locked')
    expect(resolveViewerInteractionState({ hoverIndex: 2, selectedIndex: 1 })).toBe('locked-preview')
    expect(resolveViewerInteractionState({ hoverIndex: 2, selectedIndex: 1, scrubbing: true })).toBe('scrub')
  })
})
