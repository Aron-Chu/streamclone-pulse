import { describe, expect, it } from 'vitest'
import { chartRollupToLiveHeatPoint, resolvePinnedMomentPoint } from '../src/ui/chartSelectedMoment.ts'

describe('chartRollupToLiveHeatPoint', () => {
  it('builds a chat spike moment with top emotes and uses counts', () => {
    const rollups = [
      { offsetSeconds: 0, chatCount: 40, sevenTvEmoteCount: 10 },
      { offsetSeconds: 60, chatCount: 45, sevenTvEmoteCount: 12 },
      { offsetSeconds: 120, chatCount: 50, sevenTvEmoteCount: 11 },
      {
        offsetSeconds: 180,
        chatCount: 589,
        sevenTvEmoteCount: 80,
        totalEmoteCount: 115,
        topEmotes: [
          { name: 'GachiPls', count: 29, provider: 'seventv', id: 'g1' },
          { name: 'PepeHands', count: 16, provider: 'seventv', id: 'p1' },
          { name: 'BAND', count: 6, provider: 'twitch', id: 'b1' },
        ],
      },
    ]
    const point = chartRollupToLiveHeatPoint({
      rollup: rollups[3]!,
      rollups,
      startedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(point.offsetSeconds).toBe(180)
    expect(point.chatCount).toBe(589)
    expect(point.emoteCount).toBe(115)
    expect(point.reasonLabel.toLowerCase()).toContain('chat')
    expect(point.topEmotes).toHaveLength(3)
    expect(point.topEmotes[0]?.name).toBe('GachiPls')
    expect(point.topEmotes[0]?.count).toBe(29)
  })

  it('still returns reason and totals when minute emotes are missing', () => {
    const rollups = [
      { offsetSeconds: 0, chatCount: 20, sevenTvEmoteCount: 5 },
      { offsetSeconds: 60, chatCount: 200, sevenTvEmoteCount: 40, totalEmoteCount: 55 },
    ]
    const point = chartRollupToLiveHeatPoint({
      rollup: rollups[1]!,
      rollups,
      startedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(point.chatCount).toBe(200)
    expect(point.emoteCount).toBe(55)
    expect(point.topEmotes).toEqual([])
    expect(point.reasonLabel.length).toBeGreaterThan(0)
  })
})

describe('resolvePinnedMomentPoint', () => {
  const rollups = [
    { offsetSeconds: 60, chatCount: 45, sevenTvEmoteCount: 12 },
    { offsetSeconds: 120, chatCount: 200, sevenTvEmoteCount: 40, totalEmoteCount: 55 },
  ]
  const heatPoints = [
    {
      minuteTs: '2026-01-01T00:02:00.000Z',
      offsetSeconds: 120,
      score: 80,
      estimated: false,
      reason: 'chat_spike' as const,
      reasonLabel: 'Chat spike',
      chatCount: 200,
      emoteCount: 55,
      topEmotes: [],
      collecting: false,
    },
  ]

  it('returns matching heat point when pin aligns with a peak', () => {
    const point = resolvePinnedMomentPoint({
      pinOffsetSeconds: 125,
      heatPoints,
      rollups,
      chartRollups: rollups,
      startedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(point?.offsetSeconds).toBe(120)
    expect(point?.reasonLabel).toBe('Chat spike')
  })

  it('falls back to rollup scoring when pin is off-peak', () => {
    const point = resolvePinnedMomentPoint({
      pinOffsetSeconds: 60,
      heatPoints: [],
      rollups,
      chartRollups: rollups,
      startedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(point?.offsetSeconds).toBe(60)
    expect(point?.chatCount).toBe(45)
  })

  it('returns null when unpinned', () => {
    expect(
      resolvePinnedMomentPoint({
        pinOffsetSeconds: null,
        heatPoints,
        rollups,
        chartRollups: rollups,
      }),
    ).toBeNull()
  })
})
