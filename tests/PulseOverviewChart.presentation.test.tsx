import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  buildPresentationTrend,
  presentationPointBudget,
} from '@streampulse/pulse-charts'
import {
  overviewViewerLanePixelHeights,
  PulseOverviewChart,
} from '../src/ui/PulseOverviewChart.tsx'
import {
  presentationTrendLinePathInBand,
} from '../src/ui/presentationPathInBand.ts'
import type { ExtensionRollup } from '../src/shared/messages.ts'

function rollup(offsetSeconds: number, overrides: Partial<ExtensionRollup> = {}): ExtensionRollup {
  return {
    offsetSeconds,
    chatCount: 10 + (offsetSeconds % 17),
    sevenTvEmoteCount: 3,
    viewerAvg: 1000 + (offsetSeconds % 50),
    viewerSamples: 1,
    missing: false,
    ...overrides,
  }
}

function longRollups(count: number): ExtensionRollup[] {
  return Array.from({ length: count }, (_, index) => {
    if (index >= 80 && index < 90) {
      return rollup(index * 60, {
        missing: true,
        chatCount: 0,
        viewerSamples: 0,
        viewerAvg: undefined,
      })
    }
    return rollup(index * 60, {
      chatCount: 20 + (index % 9),
      viewerAvg: index === 40 ? 0 : 900 + (index % 40),
      viewerSamples: 1,
    })
  })
}

describe('PulseOverviewChart_usesSharedTrendPipeline', () => {
  it('renders the viewer trend stroke through the width-bounded presentation pipeline', () => {
    const markup = renderToStaticMarkup(
      <PulseOverviewChart
        rollups={longRollups(240)}
        durationSeconds={240 * 60}
        reducedMotion
        width={320}
        height={184}
        showViewerStrip
      />,
    )
    expect(markup).toContain('data-testid="pulse-overview-chart"')
    expect(markup).toContain('data-viewer-axis-max=')
    expect(markup).toContain('data-presentation-trend="true"')
    expect(markup).toContain('data-lod-mode="intermediate"')
    const viewerPoints = Number(markup.match(/data-viewer-presentation-points="(\d+)"/)?.[1])
    expect(viewerPoints).toBeLessThanOrEqual(presentationPointBudget(304, 'intermediate'))
  })

  it('closes the Helix warmup gap by carrying the first sample back across earlier chat minutes', () => {
    const rollups: ExtensionRollup[] = [
      { offsetSeconds: 0, chatCount: 40, sevenTvEmoteCount: 4, viewerSamples: 0 },
      { offsetSeconds: 60, chatCount: 48, sevenTvEmoteCount: 5, viewerSamples: 0 },
      {
        offsetSeconds: 120,
        chatCount: 52,
        sevenTvEmoteCount: 6,
        viewerAvg: 40_000,
        viewerCount: 40_000,
        viewerSamples: 1,
      },
      {
        offsetSeconds: 180,
        chatCount: 55,
        sevenTvEmoteCount: 6,
        viewerAvg: 41_000,
        viewerCount: 41_000,
        viewerSamples: 1,
      },
      {
        offsetSeconds: 240,
        chatCount: 50,
        sevenTvEmoteCount: 5,
        viewerAvg: 40_500,
        viewerCount: 40_500,
        viewerSamples: 1,
      },
    ]
    const markup = renderToStaticMarkup(
      <PulseOverviewChart
        rollups={rollups}
        durationSeconds={300}
        reducedMotion
        width={320}
        height={184}
        showViewerStrip
        activityExpanded
      />,
    )
    expect(markup).toContain('data-chart-series="viewers"')
    const viewerGroup = markup.split('data-chart-series="viewers"')[1]?.split('</g>')[0] ?? ''
    // Target the core trend stroke: the group also carries deviation hairlines,
    // which legitimately start at the first observed sample.
    const trendPath = viewerGroup
      .split('<path')
      .find(fragment => fragment.includes('data-progressive-layer="overview"')) ?? ''
    const startX = Number(trendPath.match(/d="M\s*([\d.]+)/)?.[1] ?? NaN)
    expect(startX).toBeLessThan(40)
  })
})

describe('PulseOverviewChart_expandNeverShrinksViewerLane', () => {
  it('keeps expanded viewer pixels at least collapsed height for LiveStatsBand sizes', () => {
    const collapsedPlot = 184 - 2 - 18
    const expandedPlot = 268 - 2 - 18
    const collapsed = overviewViewerLanePixelHeights({
      plotHeight: collapsedPlot,
      showViewerStrip: true,
      activityExpanded: false,
      focusedSeriesKey: null,
    })
    const expanded = overviewViewerLanePixelHeights({
      plotHeight: expandedPlot,
      showViewerStrip: true,
      activityExpanded: true,
      focusedSeriesKey: null,
    })
    expect(expanded.activePx).toBeGreaterThanOrEqual(collapsed.activePx)
  })
})

describe('PulseOverviewChart_pathCountRemainsBounded', () => {
  it('bounds presentation commands for 720 and 1440 minute sessions in ~300px', () => {
    for (const minutes of [720, 1440]) {
      const values = Array.from({ length: minutes }, (_, index) => 50 + (index % 13))
      const trend = buildPresentationTrend(values, {
        plotWidth: 300,
        sampleCount: minutes,
        mode: 'overview',
      })
      expect(trend.pointCount).toBeLessThanOrEqual(presentationPointBudget(300, 'overview'))
      const source = values.map((value, index) =>
        rollup(index * 60, { viewerAvg: value, chatCount: value }),
      )
      const path = presentationTrendLinePathInBand(
        trend,
        source,
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
  })
})

describe('PulseOverviewChart_missingGapRemainsVisibleAfterSmoothing', () => {
  it('does not draw a continuous presentation path through a coverage gap', () => {
    const values = Array.from({ length: 120 }, (_, index) =>
      index >= 40 && index < 55 ? null : 100 + index,
    )
    const trend = buildPresentationTrend(values, { plotWidth: 300, mode: 'overview' })
    expect(trend.segments.length).toBeGreaterThanOrEqual(2)
  })
})

describe('PulseOverviewChart_preservesObservedZero', () => {
  it('keeps observed viewer zero in presentation trend', () => {
    const values: Array<number | null> = [10, 0, 12]
    const trend = buildPresentationTrend(values, { plotWidth: 100, mode: 'exact' })
    expect(trend.segments[0]?.points.some((point) => point.value === 0)).toBe(true)
  })
})

describe('PulseOverviewChart_reducedMotionStillRenders', () => {
  it('still renders the overview chart with reducedMotion', () => {
    const markup = renderToStaticMarkup(
      <PulseOverviewChart
        rollups={longRollups(120)}
        durationSeconds={120 * 60}
        reducedMotion
        pinnedOffsetSeconds={60 * 30}
        width={320}
        height={184}
        showViewerStrip
      />,
    )
    expect(markup).toContain('data-testid="pulse-overview-chart"')
    expect(markup).toContain('data-viewer-axis-max=')
  })
})

describe('PulseOverviewChart.omitsSeriesDotsOnPin', () => {
  it('keeps the pin line without series-value dots on the plot', () => {
    const markup = renderToStaticMarkup(
      <PulseOverviewChart
        rollups={longRollups(8)}
        durationSeconds={8 * 60}
        reducedMotion
        selectedOffsetSeconds={60}
        selectedIndex={1}
        width={320}
        height={184}
        showViewerStrip
      />,
    )
    expect(markup).toContain('data-chart-pin-line="true"')
    expect(markup).toContain('data-chart-pin-anchor="true"')
    expect(markup).toContain('stroke-dasharray="3 4"')
    expect(markup).toContain('var(--pulse-accent-text-subtle, #c4b5fd)')
    expect(markup).not.toContain('data-chart-raw-marker')
    expect(markup).not.toContain('data-chart-raw-markers')
  })
})

describe('PulseOverviewChart.reactionPinSnapsToBarColumn', () => {
  it('places a 1s-onset pin on the chart with an HH:MM chip, not onset seconds', () => {
    const markup = renderToStaticMarkup(
      <PulseOverviewChart
        rollups={longRollups(40)}
        durationSeconds={40 * 60}
        reducedMotion
        selectedOffsetSeconds={1832}
        selectedIndex={30}
        reactionPoints={[
          {
            offsetSeconds: 1800,
            score: 80,
            reasons: ['emote_spike'],
            dominantSignal: 'emotes',
            reactionOnsetOffsetSeconds: 1832,
            precisionSeconds: 1,
            seekOffsetSeconds: 1750,
          },
        ]}
        width={320}
        height={184}
        showViewerStrip
      />,
    )
    expect(markup).toContain('data-chart-pin-line="true"')
    expect(markup).toContain('>00:30<')
    expect(markup).not.toContain('>00:30:32<')
  })
})

describe('PulseOverviewChart.reactionCrosshairDoesNotPretendSecondLevelMetrics', () => {
  it('pins a refined reaction without series dots or per-second metric labels', () => {
    const markup = renderToStaticMarkup(
      <PulseOverviewChart
        rollups={longRollups(8)}
        durationSeconds={8 * 60}
        reducedMotion
        selectedOffsetSeconds={183}
        reactionPoints={[
          {
            offsetSeconds: 180,
            score: 80,
            reasons: ['emote_spike'],
            dominantSignal: 'emotes',
            reactionOnsetOffsetSeconds: 183,
            precisionSeconds: 1,
            seekOffsetSeconds: 175,
          },
        ]}
        width={320}
        height={184}
        showViewerStrip
      />,
    )
    expect(markup).toContain('data-testid="pulse-overview-chart"')
    expect(markup).not.toContain('data-chart-raw-marker')
    expect(markup).not.toMatch(/per second/i)
  })
})

describe('PulseOverviewChart_hoverReadsCanonicalMinute', () => {
  it('keeps analytical peak identity separate from presentation averages', () => {
    const values = Array.from({ length: 100 }, (_, index) => index)
    values[77] = 500
    const trend = buildPresentationTrend(values, { plotWidth: 200, mode: 'overview' })
    for (const segment of trend.segments) {
      for (const point of segment.points) {
        if (point.sourceEndExclusive - point.sourceStartIndex > 1) {
          expect(point.presentationMidIndex).not.toBe(77)
        }
      }
    }
  })
})

describe('PulseOverviewChart.draw-on animation gates to overview mode', () => {
  it('applies the trend draw class to overview-mode lines only', () => {
    const overview = renderToStaticMarkup(
      <PulseOverviewChart
        rollups={longRollups(120)}
        durationSeconds={120 * 60}
        smoothFullStreamOverview
        reducedMotion={false}
        width={320}
        height={184}
        showViewerStrip
      />,
    )
    // Overview mode → trend paths carry the draw class.
    expect(overview).toContain('pulse-chart-trend-draw')
    expect(overview).toContain('pulse-chart-trend-draw--chat')
    expect(overview).toContain('pulse-chart-trend-draw--emote')
    // The detail-mode variants do not carry it.
    expect(overview).not.toMatch(/data-progressive-layer="detail"[^>]*class="[^"]*pulse-chart-trend-draw/)

    const detail = renderToStaticMarkup(
      <PulseOverviewChart
        rollups={longRollups(120)}
        durationSeconds={120 * 60}
        smoothFullStreamOverview={false}
        reducedMotion={false}
        width={320}
        height={184}
        showViewerStrip
      />,
    )
    // Detail mode (bars at rest) → no draw-on animation on the overview layer.
    expect(detail).not.toContain('pulse-chart-trend-draw')
  })

  it('keeps 12h and 24h chart markup width-bounded while preserving the exact pin', () => {
    const markups = [720, 1440].map(minutes => renderToStaticMarkup(
      <PulseOverviewChart
        rollups={longRollups(minutes)}
        durationSeconds={minutes * 60}
        reducedMotion
        selectedOffsetSeconds={77 * 60}
        selectedIndex={77}
        width={320}
        height={184}
        showViewerStrip
      />,
    ))

    for (const markup of markups) {
      expect(markup).toContain('data-lod-mode="overview"')
      expect(markup).toContain('data-chart-pin-line="true"')
      for (const signal of ['viewer', 'chat', 'emote']) {
        const count = Number(markup.match(new RegExp(`data-${signal}-presentation-points="(\\d+)"`))?.[1])
        expect(count).toBeLessThanOrEqual(presentationPointBudget(304, 'overview'))
      }
    }
    expect(markups[1]!.length).toBeLessThan(markups[0]!.length * 1.35)
  })
})
