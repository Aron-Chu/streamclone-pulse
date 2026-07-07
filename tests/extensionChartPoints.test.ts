import { describe, expect, it } from 'vitest'
import {
  chartPointsFromExtensionRollups,
  downsampleRollupsForChart,
  nearestChartPointIndex,
} from '../src/ui/extensionChartPoints.ts'
import type { ExtensionRollup } from '../src/shared/messages.ts'

function rollup(offsetSeconds: number, chatCount: number, emotes = 0): ExtensionRollup {
  return { offsetSeconds, chatCount, sevenTvEmoteCount: emotes }
}

describe('extensionChartPoints', () => {
  it('returns empty array for no rollups', () => {
    expect(chartPointsFromExtensionRollups([])).toEqual([])
  })

  it('normalizes a single minute to full scale', () => {
    const points = chartPointsFromExtensionRollups([rollup(120, 50, 10)])
    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({
      offsetSeconds: 120,
      chatNorm: 100,
      emotesNorm: 100,
      chatCount: 50,
      emoteCount: 10,
    })
    expect(points[0]?.heat).toBeGreaterThan(0)
  })

  it('downsample preserves the peak minute in a long session', () => {
    const rollups: ExtensionRollup[] = Array.from({ length: 240 }, (_, i) =>
      rollup(i * 60, i === 137 ? 999 : 1, 0),
    )
    const sampled = downsampleRollupsForChart(rollups, 60)
    expect(sampled.length).toBeLessThanOrEqual(60)
    expect(sampled.some(point => (point.chatCount ?? 0) === 999)).toBe(true)
  })

  it('finds nearest chart point by offset', () => {
    const points = chartPointsFromExtensionRollups([
      rollup(0, 1),
      rollup(60, 2),
      rollup(120, 3),
    ])
    expect(nearestChartPointIndex(points, 55)).toBe(1)
    expect(nearestChartPointIndex(points, 0)).toBe(0)
  })
})
