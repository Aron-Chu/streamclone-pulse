import { describe, expect, it } from 'vitest'
import {
  chartRollupIndexForOffset,
  extensionGamesForOverviewChart,
  extensionGamesToChartGames,
  extensionRollupsToChartMinutes,
  rejectIncoherentGameTimeline,
} from '../src/ui/extensionChartAdapter.ts'
import type { ExtensionGameSegment, ExtensionRollup } from '../src/shared/messages.ts'

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

  it('does not turn placeholder live metadata into a Games played card', () => {
    expect(extensionGamesForOverviewChart([], 'Live', 600)).toEqual([])
    expect(extensionGamesForOverviewChart([
      { gameName: 'Live', offsetSeconds: 0, durationSeconds: 600 },
    ], 'Just Chatting', 600)).toEqual([
      { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 600 },
    ])
  })

  it('keeps backend segments when present', () => {
    const games = [{ gameName: 'Valorant', offsetSeconds: 0, durationSeconds: 1200 }]
    expect(extensionGamesForOverviewChart(games, 'Fortnite', 5400)).toEqual(games)
  })

  it('rejects a stale timeline whose last segment ends beyond the stream duration', () => {
    const staleGames: ExtensionGameSegment[] = [
      {
        gameName: 'Just Chatting',
        categoryId: '509658',
        boxArtUrl: 'https://static-cdn.jtvnw.net/a.png',
        offsetSeconds: 0,
        durationSeconds: 3600,
      },
      {
        gameName: 'Fortnite',
        categoryId: '33214',
        boxArtUrl: 'https://static-cdn.jtvnw.net/b.png',
        offsetSeconds: 3600,
        durationSeconds: 144000,
      },
    ]
    expect(rejectIncoherentGameTimeline(staleGames, 5400)).toBe(true)
    expect(extensionGamesForOverviewChart(staleGames, 'Minecraft', 5400)).toEqual([
      { gameName: 'Minecraft', offsetSeconds: 0, durationSeconds: 5400 },
    ])
  })

  it('rejects a timeline whose segment starts at or beyond the stream duration', () => {
    const games: ExtensionGameSegment[] = [
      { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 3600 },
      { gameName: 'Fortnite', offsetSeconds: 5400, durationSeconds: 600 },
    ]
    expect(rejectIncoherentGameTimeline(games, 5400)).toBe(true)
    expect(extensionGamesForOverviewChart(games, 'Minecraft', 5400)).toEqual([
      { gameName: 'Minecraft', offsetSeconds: 0, durationSeconds: 5400 },
    ])
  })

  it('rejects a timeline whose total covered time overruns the stream duration', () => {
    const games: ExtensionGameSegment[] = [
      { gameName: 'Fortnite', offsetSeconds: 0, durationSeconds: 1800 },
      { gameName: 'Fortnite', offsetSeconds: 100, durationSeconds: 1800 },
      { gameName: 'Fortnite', offsetSeconds: 200, durationSeconds: 1800 },
    ]
    expect(rejectIncoherentGameTimeline(games, 3600)).toBe(true)
  })

  it('passes a valid multi-game timeline through unchanged', () => {
    const games: ExtensionGameSegment[] = [
      {
        gameName: 'Just Chatting',
        categoryId: '509658',
        boxArtUrl: 'https://static-cdn.jtvnw.net/a.png',
        offsetSeconds: 0,
        durationSeconds: 3600,
      },
      {
        gameName: 'Fortnite',
        categoryId: '33214',
        boxArtUrl: 'https://static-cdn.jtvnw.net/b.png',
        offsetSeconds: 3600,
        durationSeconds: 1800,
      },
    ]
    expect(rejectIncoherentGameTimeline(games, 5400)).toBe(false)
    expect(extensionGamesForOverviewChart(games, 'Minecraft', 5400)).toEqual(games)
  })

  it('keeps backend segments when duration is unknown or zero', () => {
    const games: ExtensionGameSegment[] = [
      { gameName: 'Fortnite', categoryId: '33214', boxArtUrl: 'https://static-cdn.jtvnw.net/b.png', offsetSeconds: 7200, durationSeconds: 999999 },
    ]
    expect(rejectIncoherentGameTimeline(games, 0)).toBe(false)
    expect(extensionGamesForOverviewChart(games, 'Minecraft', 0)).toEqual(games)
  })

  it('accepts a segment ending within tolerance of the stream duration', () => {
    const boundaryGames: ExtensionGameSegment[] = [
      { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 3600 },
      { gameName: 'Fortnite', offsetSeconds: 3600, durationSeconds: 1920 },
    ]
    // Ends exactly at duration + GAME_TIMELINE_TOLERANCE_SECONDS (5400 + 120).
    expect(rejectIncoherentGameTimeline(boundaryGames, 5400)).toBe(false)
    expect(extensionGamesForOverviewChart(boundaryGames, 'Minecraft', 5400)).toEqual(boundaryGames)
  })
})

describe('extensionGamesToChartGames', () => {
  it('keeps a single named full-stream game for Games played / hover', () => {
    // Matches @streampulse/pulse-charts hasMeaningfulGameSegments (named segment kept).
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
