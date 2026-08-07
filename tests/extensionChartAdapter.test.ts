import { describe, expect, it } from 'vitest'
import {
  chartHighlightedGameKey,
  chartRollupIndexForOffset,
  extensionGamesForOverviewChart,
  extensionGamesToChartGames,
  extensionRollupsToChartMinutes,
} from '../src/ui/extensionChartAdapter.ts'
import type { ExtensionRollup } from '../src/shared/messages.ts'
import { gameSegmentKey } from '@streampulse/pulse-charts'

describe('extensionRollupsToChartMinutes', () => {
  it('maps offsetSeconds to minuteTs from startedAt', () => {
    const rollups: ExtensionRollup[] = [
      { offsetSeconds: 0, chatCount: 10, viewerCount: 100, topEmotes: [] },
      { offsetSeconds: 60, chatCount: 20, viewerCount: 120, topEmotes: [] },
    ]
    const out = extensionRollupsToChartMinutes(rollups, '2026-01-01T12:00:00.000Z')
    expect(out).toHaveLength(2)
    expect(out[1]!.minuteTs).toBe('2026-01-01T12:01:00.000Z')
    expect(out[1]!.chatCount).toBe(20)
  })
})

describe('extensionGamesForOverviewChart', () => {
  it('synthesizes a live category segment when backend games are missing', () => {
    expect(extensionGamesForOverviewChart([], 'Fortnite', 5400)).toEqual([
      { gameName: 'Fortnite', offsetSeconds: 0, durationSeconds: 5400 },
    ])
  })

  it('keeps backend segments when present', () => {
    const games = [{ gameName: 'Valorant', offsetSeconds: 0, durationSeconds: 1200 }]
    expect(extensionGamesForOverviewChart(games, 'Fortnite', 5400)).toEqual(games)
  })
})

describe('extensionGamesToChartGames', () => {
  it('keeps a single named full-stream game for Games played / hover', () => {
    const games = extensionGamesToChartGames(
      [{ gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 3600 }],
      3600,
    )
    expect(games).toEqual([
      {
        gameName: 'Just Chatting',
        boxArtUrl: undefined,
        offsetSeconds: 0,
        durationSeconds: 3600,
      },
    ])
  })
})

describe('chartRollupIndexForOffset', () => {
  it('finds nearest rollup index', () => {
    const chartRollups = extensionRollupsToChartMinutes(
      [
        { offsetSeconds: 0, chatCount: 1, topEmotes: [] },
        { offsetSeconds: 120, chatCount: 2, topEmotes: [] },
      ],
      '2026-01-01T12:00:00.000Z',
    )
    expect(chartRollupIndexForOffset(chartRollups, '2026-01-01T12:00:00.000Z', 125)).toBe(1)
  })
})

describe('chartHighlightedGameKey', () => {
  const games = [{ gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 7200 }]
  const key = gameSegmentKey(games[0]!)

  it('highlights while chart range is still loading', () => {
    expect(chartHighlightedGameKey(key, games, 7200, null)).toBe(key)
  })

  it('highlights when the game overlaps the visible range', () => {
    expect(
      chartHighlightedGameKey(key, games, 7200, { startOffset: 0, endOffset: 3600 }),
    ).toBe(key)
  })

  it('skips games outside the visible range', () => {
    const later = [{ gameName: 'Valorant', offsetSeconds: 4000, durationSeconds: 1200 }]
    const laterKey = gameSegmentKey(later[0]!)
    expect(
      chartHighlightedGameKey(laterKey, later, 7200, { startOffset: 0, endOffset: 3000 }),
    ).toBeNull()
  })
})
