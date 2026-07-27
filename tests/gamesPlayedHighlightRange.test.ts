import { describe, expect, it } from 'vitest'
import {
  chartHighlightedGameKey,
  chartVisibleRangeFromRollups,
} from '../src/ui/extensionChartAdapter.ts'

describe('chartVisibleRangeFromRollups', () => {
  it('uses exclusive end of the last minute bucket (+60s)', () => {
    expect(
      chartVisibleRangeFromRollups([
        { offsetSeconds: 14_460 },
        { offsetSeconds: 21_540 },
      ]),
    ).toEqual({ startOffset: 14_460, endOffset: 21_600 })
  })
})

describe('chartHighlightedGameKey', () => {
  const games = [
    { gameName: 'Battlefield 6', offsetSeconds: 17_717, durationSeconds: 3_899 },
    { gameName: 'Welcome to the Jungle', offsetSeconds: 21_617, durationSeconds: 7_183 },
  ]

  it('highlights a mid-window game against a non-full chart range', () => {
    const visible = chartVisibleRangeFromRollups([
      { offsetSeconds: 14_460 },
      { offsetSeconds: 18_000 },
      { offsetSeconds: 21_540 },
      { offsetSeconds: 28_800 },
    ])
    const key = 'battlefield 6:17717'
    expect(chartHighlightedGameKey(key, games, 28_800, visible)).toBe(key)
  })

  it('returns null when the hovered game is outside the chart window', () => {
    const visible = chartVisibleRangeFromRollups([
      { offsetSeconds: 25_200 },
      { offsetSeconds: 26_400 },
      { offsetSeconds: 28_800 },
    ])
    expect(chartHighlightedGameKey('battlefield 6:17717', games, 28_800, visible)).toBeNull()
  })

  it('still highlights when visibleRange collapses and strip falls back to full duration', () => {
    // Degenerate single-offset window: strip uses full duration via resolveGamesPlayedTimelineRange.
    const visible = { startOffset: 28_800, endOffset: 28_800 }
    const key = 'battlefield 6:17717'
    expect(chartHighlightedGameKey(key, games, 28_800, visible)).toBe(key)
  })
})
