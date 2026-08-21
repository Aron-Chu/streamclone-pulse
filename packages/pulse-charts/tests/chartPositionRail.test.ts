import { describe, expect, it } from 'vitest'
import {
  LONG_STREAM_OVERVIEW_SECONDS,
  jumpViewportToOffset,
  magnitudeActivitySeries,
  railGeometry,
  resizeViewportEdge,
  shouldShowChartRail,
} from '../src/ChartPositionRail.tsx'

describe('chart position rail math', () => {
  it('shows the overview rail for long streams even when fully zoomed out', () => {
    const full = { startSeconds: 0, endSeconds: LONG_STREAM_OVERVIEW_SECONDS }
    expect(shouldShowChartRail(full, LONG_STREAM_OVERVIEW_SECONDS)).toBe(true)
    expect(shouldShowChartRail({ startSeconds: 0, endSeconds: 600 }, 1200)).toBe(true)
    expect(shouldShowChartRail({ startSeconds: 0, endSeconds: 1200 }, 1200)).toBe(false)
  })

  it('maps the viewport to a thumb that stays inside the rail', () => {
    const geo = railGeometry({ startSeconds: 900, endSeconds: 1800 }, 3600, 200)
    expect(geo.thumbX).toBeGreaterThan(0)
    expect(geo.thumbX + geo.thumbWidth).toBeLessThanOrEqual(200)
    expect(geo.thumbWidth).toBeGreaterThanOrEqual(8)
  })

  it('jumps the current zoom window to an offset and resizes one edge', () => {
    expect(jumpViewportToOffset(
      { startSeconds: 0, endSeconds: 600 },
      1800,
      3600,
      600,
    )).toEqual({ startSeconds: 1500, endSeconds: 2100 })
    expect(resizeViewportEdge(
      { startSeconds: 600, endSeconds: 1200 },
      'end',
      300,
      3600,
    )).toEqual({ startSeconds: 600, endSeconds: 1500 })
  })

  it('builds a magnitude silhouette from chat, emotes, and viewers', () => {
    const series = magnitudeActivitySeries([
      { chatCount: 2, totalEmoteCount: 1, viewerAvg: 10, viewerSamples: 1 },
      { chatCount: 0, totalEmoteCount: 0, viewerAvg: 0, viewerSamples: 1 },
    ])
    expect(series[0]).toBeGreaterThan(series[1] ?? 0)
    expect(series).toHaveLength(2)
  })
})
