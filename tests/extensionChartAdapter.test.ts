import { describe, expect, it } from 'vitest'
import {
  chartRollupIndexForOffset,
  extensionGamesForOverviewChart,
  extensionGamesToChartGames,
  extensionRollupsToChartMinutes,
} from '../src/ui/extensionChartAdapter.ts'
import type { ExtensionRollup } from '../src/shared/messages.ts'

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
  it('returns empty when only synthetic full-stream category', () => {
    const games = extensionGamesToChartGames(
      [{ gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 3600 }],
      3600,
    )
    expect(games).toEqual([])
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
