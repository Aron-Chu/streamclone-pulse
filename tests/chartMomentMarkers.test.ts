import { describe, expect, it } from 'vitest'
import type { ExtensionPeak } from '../src/shared/messages.ts'
import {
  chartMomentMarkerPresentation,
  chartMomentMarkerY,
  MAX_CHART_MOMENT_MARKERS,
  selectVisibleChartMomentPeaks,
} from '../src/ui/chartMomentMarkers.ts'

function peak(offsetSeconds: number, score: number): ExtensionPeak {
  return {
    offsetSeconds,
    score,
    chatCount: score,
    emoteCount: score,
    reasons: ['chat_spike'],
    dominantSignal: 'chat',
  }
}

describe('chart moment marker selection', () => {
  it('filters by viewport before applying the display cap', () => {
    const peaks = Array.from({ length: 30 }, (_, index) => peak(index * 60, 100 - index))
    const selection = selectVisibleChartMomentPeaks(peaks, 600, 1380)

    expect(selection.inView.map(item => item.offsetSeconds)).toEqual(
      peaks.slice(9, 25).map(item => item.offsetSeconds),
    )
    expect(selection.visible).toHaveLength(MAX_CHART_MOMENT_MARKERS)
    expect(selection.visible[0]?.offsetSeconds).toBe(540)
  })

  it('keeps ranked ordering inside the visible window', () => {
    const selection = selectVisibleChartMomentPeaks([
      peak(1_000, 4),
      peak(500, 10),
      peak(700, 8),
    ], 450, 750, 2)

    expect(selection.visible.map(item => item.offsetSeconds)).toEqual([500, 700])
  })
})

describe('chart moment marker presentation', () => {
  it('places a marker on the relevant signal value instead of a fixed band position', () => {
    const band = { top: 10, bottom: 110 }

    expect(chartMomentMarkerY({ value: 75, axisMin: 0, axisMax: 100, band })).toBe(35)
    expect(chartMomentMarkerY({ value: 25, axisMin: 0, axisMax: 100, band })).toBe(85)
  })

  it('keeps missing signal values discoverable without claiming a sampled point', () => {
    const y = chartMomentMarkerY({ value: null, axisMin: 0, axisMax: 100, band: { top: 10, bottom: 110 } })

    expect(y).toBe(100)
    expect(y).toBeLessThan(110)
  })

  it('renders resting markers as subtle dots and reserves guides for active markers', () => {
    const resting = chartMomentMarkerPresentation(false)
    const active = chartMomentMarkerPresentation(true)

    expect(resting.showGuide).toBe(false)
    expect(resting.guideDasharray).toBeUndefined()
    expect(resting.dotRadius).toBeLessThan(active.dotRadius)
    expect(resting.dotOpacity).toBeLessThan(active.dotOpacity)
    expect(active.showGuide).toBe(true)
    expect(active.guideDasharray).toBe('2 3')
    expect(active.haloRadius).toBeGreaterThan(0)
  })
})
