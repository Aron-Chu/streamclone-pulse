import { describe, expect, it } from 'vitest'
import { panViewport as panChartViewport } from '../src/ui/chartViewport.ts'
import { panDeltaSecondsFromPointer, panSecondsPerPixel } from '../src/ui/chartPanMath.ts'

describe('PulseOverviewChart.pansUsingVisibleDuration', () => {
  it('converts drag pixels with the visible viewport duration, not the full stream', () => {
    const visible = 15 * 60
    const full = 4 * 3600
    const plotWidth = 300
    expect(panSecondsPerPixel(visible, plotWidth)).toBe(visible / plotWidth)
    expect(panSecondsPerPixel(visible, plotWidth)).not.toBe(full / plotWidth)
    // Conventional grab/pan: drag right reveals earlier history.
    expect(panDeltaSecondsFromPointer(30, visible, plotWidth)).toBe(-90)
  })
})

describe('PulseOverviewChart.clampsPanAtBothEdges', () => {
  it('clamps a left-edge and right-edge pan', () => {
    const viewport = { startSeconds: 900, endSeconds: 1800 }
    const duration = 3600
    const left = panChartViewport(viewport, panDeltaSecondsFromPointer(10_000, 900, 300), duration)
    expect(left.startSeconds).toBe(0)
    expect(left.endSeconds - left.startSeconds).toBe(900)
    const right = panChartViewport(viewport, panDeltaSecondsFromPointer(-10_000, 900, 300), duration)
    expect(right.endSeconds).toBe(3600)
    expect(right.endSeconds - right.startSeconds).toBe(900)
  })
})
