import { describe, expect, it } from 'vitest'
import {
  OVERVIEW_CHART_MAX_BAR_WIDTH_PX,
  TARGET_BAR_PITCH_PX,
  overviewBarWidth,
  plotXForIndex,
  snappedBarGeometry,
  widthDerivedBucketCount,
} from '../src/ui/chartRollupUtils.ts'

const PAD_LEFT = 4
const PAD_RIGHT = 12

function plotWidth(width: number): number {
  return Math.max(1, width - PAD_LEFT - PAD_RIGHT)
}

function buildBars(plotW: number, pointCount: number): Array<{ x: number; width: number }> {
  const barWidth = overviewBarWidth(plotW, pointCount)
  const out: Array<{ x: number; width: number }> = []
  for (let i = 0; i < pointCount; i += 1) {
    const center = plotXForIndex(i, pointCount, PAD_LEFT, plotW)
    out.push(snappedBarGeometry(center, barWidth, plotW, PAD_LEFT))
  }
  return out
}

describe('widthDerivedBucketCount', () => {
  it('keeps long streams on a readable ~4px bucket pitch', () => {
    expect(widthDerivedBucketCount(364, 1000)).toBe(91)
    expect(widthDerivedBucketCount(800, 1000)).toBe(200)
  })

  it('clamps to 24 buckets at very narrow widths', () => {
    expect(widthDerivedBucketCount(200, 1000)).toBe(50)
    expect(widthDerivedBucketCount(28, 1000)).toBe(24)
  })

  it('returns pointCount when rollups are already sparser than the derived count', () => {
    expect(widthDerivedBucketCount(364, 40)).toBe(40)
    expect(widthDerivedBucketCount(800, 60)).toBe(60)
  })

  it('exports a readable bucket pitch instead of a hairline field', () => {
    expect(TARGET_BAR_PITCH_PX).toBe(4)
  })
})

describe('snappedBarGeometry', () => {
  it('snaps to integer width once bars are wide enough to benefit', () => {
    for (const n of [10, 30, 60, 100]) {
      const bars = buildBars(plotWidth(380), n)
      for (const bar of bars) {
        expect(bar.width % 1).toBe(0)
      }
    }
  })

  it('leaves a visible gap so neighbours read as separate buckets', () => {
    const bars = buildBars(plotWidth(380), 60)
    const gap = bars[1]!.x - (bars[0]!.x + bars[0]!.width)
    expect(gap).toBeGreaterThan(0.2)
    expect(bars[0]!.width).toBeGreaterThanOrEqual(2)
  })

  it('never renders a sub-pixel bar', () => {
    for (const bar of buildBars(plotWidth(380), 500)) {
      expect(bar.width).toBeGreaterThanOrEqual(1)
    }
  })

  it('gives every bar the same integer width in a 100-bucket chart at 364px plotWidth', () => {
    const bars = buildBars(plotWidth(380), 100)
    const widths = new Set(bars.map(bar => bar.width))
    expect(widths.size).toBe(1)
    const [onlyWidth] = [...widths]
    expect(onlyWidth).toBeGreaterThan(0)
    expect(onlyWidth % 1).toBe(0)
  })

  it('produces bars wide enough to read at 364px plotWidth with ~100 buckets', () => {
    const bars = buildBars(plotWidth(380), 100)
    expect(bars[0]!.width).toBeGreaterThanOrEqual(2)
  })

  it('keeps bars monotonic in x (no bars drift leftward as index increases)', () => {
    for (const n of [10, 60, 100, 200]) {
      const bars = buildBars(plotWidth(380), n)
      for (let i = 1; i < bars.length; i += 1) {
        const prev = bars[i - 1]!
        const curr = bars[i]!
        expect(curr.x).toBeGreaterThanOrEqual(prev.x - 1)
      }
    }
  })

  it('keeps bars inside the plot bounds (PAD_LEFT right edge)', () => {
    const plotW = plotWidth(380)
    const bars = buildBars(plotW, 200)
    for (const bar of bars) {
      expect(bar.x).toBeGreaterThanOrEqual(PAD_LEFT - bar.width / 2 - 1)
      expect(bar.x + bar.width).toBeLessThanOrEqual(PAD_LEFT + plotW + bar.width / 2 + 1)
    }
  })

  it('respects the existing max-bar cap so two-point charts are not half-width slabs', () => {
    const barWidth = overviewBarWidth(plotWidth(300), 2)
    expect(barWidth).toBe(OVERVIEW_CHART_MAX_BAR_WIDTH_PX)
    const center = plotXForIndex(0, 2, PAD_LEFT, plotWidth(300))
    const snapped = snappedBarGeometry(center, barWidth, plotWidth(300), PAD_LEFT)
    expect(snapped.width).toBe(OVERVIEW_CHART_MAX_BAR_WIDTH_PX)
  })
})
