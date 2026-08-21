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

  it('downsample merges peak viewer counts from each bucket onto the activity leader', () => {
    const rollups: ExtensionRollup[] = Array.from({ length: 240 }, (_, i) =>
      rollup(i * 60, 100, 0),
    )
    rollups[50] = { offsetSeconds: 50 * 60, chatCount: 1, sevenTvEmoteCount: 0, viewerCount: 42_000 }

    const sampled = downsampleRollupsForChart(rollups, 60)
    expect(sampled.some(point => (point.viewerCount ?? 0) === 42_000)).toBe(true)
  })

  it('uses the requested signal to choose each bucket representative', () => {
    const rollups = [
      { offsetSeconds: 0, chatCount: 90, sevenTvEmoteCount: 1, viewerCount: 10 },
      { offsetSeconds: 60, chatCount: 1, sevenTvEmoteCount: 80, viewerCount: 20 },
      { offsetSeconds: 120, chatCount: 2, sevenTvEmoteCount: 2, viewerCount: 900 },
    ]

    expect(downsampleRollupsForChart(rollups, 1, 'chat')[0]?.offsetSeconds).toBe(0)
    expect(downsampleRollupsForChart(rollups, 1, 'emotes')[0]?.offsetSeconds).toBe(60)
    expect(downsampleRollupsForChart(rollups, 1, 'viewers')[0]?.offsetSeconds).toBe(120)
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
