import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  placePlotEdgeLabels,
  polylineObstacles,
  scaleChipWidth,
} from '../src/plotEdgeLabels.ts'
import { PulseMultiSignalChartInner } from '../src/PulseMultiSignalChart.tsx'
import type { ChartMinuteRollup } from '../src/types.ts'

const box = { plotLeft: 0, plotRight: 400, top: 34, bottom: 200 }

describe('placePlotEdgeLabels', () => {
  it('puts a label just inside the left edge when nothing is under it', () => {
    const [placed] = placePlotEdgeLabels([{ key: 'avg', y: 100, width: 80, height: 20 }], { ...box, obstacles: [] })
    expect(placed).toMatchObject({ key: 'avg', side: 'start', x: 4, y: 90 })
  })

  it('moves to the right edge when a line passes the left one, and gives up when both are taken', () => {
    const left = { x0: 0, x1: 60, y0: 95, y1: 105 }
    const right = { x0: 340, x1: 400, y0: 95, y1: 105 }
    const [moved] = placePlotEdgeLabels([{ key: 'avg', y: 100, width: 80, height: 20 }], { ...box, obstacles: [left] })
    expect(moved).toMatchObject({ side: 'end', x: 400 - 4 - 80 })
    const [dropped] = placePlotEdgeLabels([{ key: 'avg', y: 100, width: 80, height: 20 }], { ...box, obstacles: [left, right] })
    expect(dropped!.side).toBeNull()
  })

  it('keeps clear space around marks and never stacks two labels', () => {
    // A mark 2px below the chip is inside the 3px clearance.
    const [tight] = placePlotEdgeLabels([{ key: 'avg', y: 100, width: 80, height: 20 }], {
      ...box,
      obstacles: [{ x0: 0, x1: 400, y0: 112, y1: 113 }],
    })
    expect(tight!.side).toBeNull()
    const [first, second] = placePlotEdgeLabels([
      { key: 'a', y: 100, width: 80, height: 20 },
      { key: 'b', y: 105, width: 80, height: 20 },
    ], { ...box, obstacles: [] })
    expect(first!.side).toBe('start')
    expect(second!.side).toBe('end')
  })

  it('keeps a label inside the band it may use', () => {
    const [placed] = placePlotEdgeLabels([{ key: 'min', y: 199, width: 60, height: 20 }], { ...box, obstacles: [] })
    expect(placed!.y + placed!.height).toBeLessThanOrEqual(200)
  })

  it('turns a polyline into one box per segment', () => {
    const boxes = polylineObstacles([[{ x: 0, y: 10 }, { x: 10, y: 30 }, { x: 20, y: null }], [{ x: 50, y: 5 }]], 1)
    expect(boxes).toEqual([
      { x0: -1, x1: 11, y0: 9, y1: 31 },
      { x0: 49, x1: 51, y0: 4, y1: 6 },
    ])
  })

  it('estimates a chip wide enough for its text', () => {
    expect(scaleChipWidth('AVG', '26.0K')).toBeGreaterThan(70)
  })
})

const START = Date.parse('2026-09-20T00:00:00.000Z')
const rollupsWith = (viewers: (minute: number) => number): ChartMinuteRollup[] =>
  Array.from({ length: 60 }, (_, minute) => ({
    minuteTs: new Date(START + minute * 60_000).toISOString(),
    viewerAvg: viewers(minute),
    viewerSamples: 1,
    chatCount: 20 + (minute % 7),
    totalEmoteCount: 5 + (minute % 3),
  }))

const renderChart = (rollups: ChartMinuteRollup[], variant: 'console' | 'compact') => renderToStaticMarkup(
  <PulseMultiSignalChartInner
    rollups={rollups}
    streamStartedAt={new Date(START).toISOString()}
    durationSeconds={60 * 60}
    variant={variant}
    chromeless={variant === 'console'}
    motionEnabled={false}
  />,
)

describe('console chart width', () => {
  it('draws the console plot across the whole SVG with the peak in the scale row', () => {
    const markup = renderChart(rollupsWith(minute => 1000 + minute * 10), 'console')
    const plot = markup.match(/<rect x="([^"]+)"[^>]*width="([^"]+)"[^>]*data-chart-touch-action/)
    expect(plot?.slice(1, 3)).toEqual(['0', '1000'])
    expect(markup).toMatch(/data-chart-x-axis-line/)
    expect(markup).toMatch(/data-chart-scale-row/)
    expect(markup).toMatch(/data-chart-scale-value="peak"/)
    // No value is drawn outside the plot any more.
    expect(markup).not.toMatch(/>PEAK<\/text>/)
  })

  it('places AVG inside the plot edge when the viewer line leaves room, else in the scale row', () => {
    // A line that rises steeply at both ends crosses the average height at
    // both edges, so AVG reads in the row above the plot.
    const crossing = renderChart(rollupsWith(minute => (minute < 3 || minute > 56 ? 4000 : 1000) + (minute % 2) * 10), 'console')
    const chipsCrossing = [...crossing.matchAll(/data-chart-scale-chip="(\w+)"/g)].map(match => match[1])
    const rowCrossing = [...crossing.matchAll(/data-chart-scale-value="(\w+)"/g)].map(match => match[1])
    expect(chipsCrossing.concat(rowCrossing)).toContain('peak')
    // Every requested value is shown exactly once, chip or row.
    for (const key of ['avg', 'min']) {
      expect(chipsCrossing.filter(k => k === key).length + rowCrossing.filter(k => k === key).length).toBeLessThanOrEqual(1)
    }
    // A flat line high in the band leaves the band's lower half free.
    const high = renderChart(rollupsWith(minute => (minute < 30 ? 1000 : 5000)), 'console')
    expect(high).toMatch(/data-chart-scale-chip="avg"/)
    expect(high).not.toMatch(/data-chart-scale-value="avg"/)
  })

  it('keeps the live game cap fully inside the gutterless plot', () => {
    const live = (variant: 'console' | 'compact') => renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={rollupsWith(minute => 1000 + minute * 10)}
        streamStartedAt={new Date(START).toISOString()}
        durationSeconds={60 * 60}
        games={[{ gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 3600 }]}
        isLive
        variant={variant}
        chromeless={variant === 'console'}
        motionEnabled={false}
      />,
    )
    const capX = (markup: string) => Number(markup.match(/<line x1="([^"]+)"[^>]*data-active-game-cap="true"/)?.[1])
    // 1.25px stroke: drawn 1.5px in from the SVG's right edge on the console.
    expect(capX(live('console'))).toBe(998.5)
    // The extension's cap stays on its plot end (1000 - 34).
    expect(capX(live('compact'))).toBe(966)
  })

  it('leaves the extension compact chart and its gutter labels as they were', () => {
    const markup = renderChart(rollupsWith(minute => 1000 + minute * 10), 'compact')
    const plot = markup.match(/<rect x="([^"]+)"[^>]*width="([^"]+)"[^>]*data-chart-touch-action/)
    expect(plot?.slice(1, 3)).toEqual(['90', '876'])
    expect(markup).toMatch(/>PEAK<\/text>/)
    expect(markup).not.toMatch(/data-chart-scale-row/)
  })
})
