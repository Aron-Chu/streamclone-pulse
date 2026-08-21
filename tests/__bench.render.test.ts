import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  buildPresentationTrend,
  presentationPointBudget,
} from '@streampulse/pulse-charts'
import type { ExtensionRollup } from '../src/shared/messages.ts'
import { PulseOverviewChart } from '../src/ui/PulseOverviewChart.tsx'
import { presentationTrendLinePathInBand } from '../src/ui/presentationPathInBand.ts'

function makeRollups(count: number): ExtensionRollup[] {
  const out: ExtensionRollup[] = []
  for (let i = 0; i < count; i += 1) {
    out.push({
      offsetSeconds: i * 60,
      chatCount: Math.round(200 + Math.sin(i / 7) * 180),
      sevenTvEmoteCount: Math.round(60 + Math.cos(i / 5) * 55),
      totalEmoteCount: Math.round(90 + Math.cos(i / 5) * 80),
      viewerAvg: Math.round(40000 + Math.sin(i / 21) * 15000),
      viewerSamples: 1,
    })
  }
  return out
}

function time(label: string, iterations: number, fn: () => void): void {
  fn()
  const start = performance.now()
  for (let i = 0; i < iterations; i += 1) fn()
  const total = performance.now() - start
  // eslint-disable-next-line no-console
  console.log(`${label.padEnd(44)} ${(total / iterations).toFixed(3)} ms/op`)
}

describe('chart render benchmark', () => {
  it('measures chart element cost', () => {
    const rollups = makeRollups(240)
    const props = {
      rollups,
      durationSeconds: 14_400,
      height: 150,
      showViewerStrip: true,
      activityExpanded: true,
      viewport: { startSeconds: 0, endSeconds: 14_400 },
      onViewportChange: () => {},
    }
    const markup = renderToStaticMarkup(createElement(PulseOverviewChart, props as never))
    const rects = (markup.match(/<rect/g) ?? []).length
    const paths = (markup.match(/<path/g) ?? []).length
    const total = (markup.match(/<[a-z]/g) ?? []).length
    // eslint-disable-next-line no-console
    console.log(`DOM nodes: ${total} (rect=${rects} path=${paths})  markup=${(markup.length / 1024).toFixed(1)} kB`)

    time('chart SSR render (240 buckets)', 200, () => {
      renderToStaticMarkup(createElement(PulseOverviewChart, props as never))
    })
    time('chart SSR render w/ hoverIndex-like pin', 200, () => {
      renderToStaticMarkup(createElement(PulseOverviewChart, { ...props, selectedIndex: 120 } as never))
    })
  })

  it('keeps presentation path commands bounded for 12–24h streams', () => {
    for (const minutes of [720, 1440]) {
      for (const expanded of [false, true]) {
        const values = Array.from({ length: minutes }, (_, index) => 50 + (index % 17))
        const trend = buildPresentationTrend(values, {
          plotWidth: 300,
          sampleCount: minutes,
          mode: 'overview',
        })
        expect(trend.pointCount).toBeLessThanOrEqual(presentationPointBudget(300, 'overview'))

        const rollups = makeRollups(minutes)
        const markup = renderToStaticMarkup(
          createElement(PulseOverviewChart, {
            rollups,
            durationSeconds: minutes * 60,
            width: 320,
            height: expanded ? 268 : 184,
            showViewerStrip: true,
            activityExpanded: expanded,
            reducedMotion: true,
            pinnedOffsetSeconds: expanded ? 3600 : null,
            viewport: { startSeconds: 0, endSeconds: minutes * 60 },
            onViewportChange: () => {},
          } as never),
        )
        expect(markup).toContain('data-testid="pulse-overview-chart"')
        expect(markup).toContain('data-viewer-axis-max=')
        const path = presentationTrendLinePathInBand(
          trend,
          rollups,
          { startSeconds: 0, endSeconds: minutes * 60 },
          100,
          300,
          0,
          40,
          true,
          4,
        )
        const commands = (path.match(/[MLC]/g) ?? []).length
        expect(commands).toBeLessThanOrEqual(trend.pointBudget * 3)
      }
    }
  })

  it('measures fragmented-series presentation cost', () => {
    const values = Array.from({ length: 1440 }, (_, index) => (index % 4 === 3 ? null : (index % 17) + 1))
    time('presentationTrend fragmented 24h', 80, () => {
      buildPresentationTrend(values, { plotWidth: 320, mode: 'overview' })
    })
    const trend = buildPresentationTrend(values, { plotWidth: 320, mode: 'overview' })
    expect(trend.pointCount).toBeLessThanOrEqual(trend.pointBudget)
    expect(trend.segments.length).toBeGreaterThan(10)
  })
})
