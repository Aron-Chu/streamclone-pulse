import { describe, expect, it } from 'vitest'
import {
  aggregateTopEmotesFromExtensionRollups,
  deriveLiveStats,
  splitEmoteProviderRates,
  toLiveStatsInputFromExtension,
  toLiveHeatInputFromExtension,
  deriveLiveHeat,
} from '@streampulse/pulse-core'
import type { PulsePayload } from '../src/shared/messages.ts'

describe('extension adapter integration', () => {
  it('derives live stats from pulse payload', () => {
    const payload: PulsePayload = {
      login: 'test',
      isLive: true,
      tracking: true,
      currentOffsetSeconds: 3600,
      startedAt: '2026-06-11T12:00:00.000Z',
      rollups: Array.from({ length: 10 }, (_, i) => ({
        offsetSeconds: i * 60,
        chatCount: i + 1,
        sevenTvEmoteCount: i,
        totalEmoteCount: i + 1,
      })),
      lanes: { composite: [1, 2, 3], chat: [], seventv: [] },
      peaks: [],
      recap: null,
    }
    const stats = deriveLiveStats(toLiveStatsInputFromExtension(payload))
    // Live strips the open trailing minute (chatCount 10) → prior completed (9).
    expect(stats.chatPerMin1m).toBe(9)
    expect(stats.confidence).toBe('Synced')
    expect(stats.sparkline).toHaveLength(9)
  })

  it('derives live heat from pulse payload', () => {
    const payload: PulsePayload = {
      login: 'test',
      isLive: true,
      tracking: true,
      currentOffsetSeconds: 420,
      startedAt: '2026-06-11T12:00:00.000Z',
      rollups: Array.from({ length: 7 }, (_, i) => ({
        offsetSeconds: i * 60,
        chatCount: 10 + i,
        sevenTvEmoteCount: 2,
        totalEmoteCount: 4 + i,
      })),
      lanes: { composite: [], chat: [], seventv: [] },
      peaks: [],
      recap: null,
    }
    const heat = deriveLiveHeat(toLiveHeatInputFromExtension(payload))
    expect(heat.visible).toBe(true)
    expect(heat.points.length).toBeGreaterThan(0)
  })
})

describe('aggregateTopEmotesFromExtensionRollups', () => {
  it('merges counts across minutes', () => {
    const merged = aggregateTopEmotesFromExtensionRollups([
      {
        offsetSeconds: 0,
        chatCount: 1,
        sevenTvEmoteCount: 1,
        topEmotes: [{ name: 'A', count: 2, id: '1' }],
      },
      {
        offsetSeconds: 60,
        chatCount: 1,
        sevenTvEmoteCount: 1,
        topEmotes: [{ name: 'A', count: 3, id: '1' }],
      },
    ])
    expect(merged[0]?.count).toBe(5)
  })

  it('keeps metadata that arrives in a later rollup for the same local emote', () => {
    const merged = aggregateTopEmotesFromExtensionRollups([
      {
        offsetSeconds: 0,
        topEmotes: [{ name: 'A', count: 1, id: 'local-id', provider: '7tv' }],
      },
      {
        offsetSeconds: 60,
        topEmotes: [{
          name: 'A',
          count: 2,
          id: 'local-id',
          provider: '7tv',
          providerEmoteId: '01F00Z3A9G0007E4VV006YKSK9',
          imageUrl: 'https://cdn.7tv.app/emote/01F00Z3A9G0007E4VV006YKSK9/4x.webp',
        }],
      },
    ])

    expect(merged[0]).toMatchObject({
      count: 3,
      id: 'local-id',
      providerEmoteId: '01F00Z3A9G0007E4VV006YKSK9',
      imageUrl: 'https://cdn.7tv.app/emote/01F00Z3A9G0007E4VV006YKSK9/4x.webp',
    })
  })
})

describe('splitEmoteProviderRates', () => {
  it('splits emote provider rates', () => {
    const input = toLiveStatsInputFromExtension({
      isLive: true,
      rollups: [{ offsetSeconds: 0, chatCount: 3, sevenTvEmoteCount: 2, totalEmoteCount: 4 }],
    })
    expect(splitEmoteProviderRates(input.rollups[0])).toEqual([
      { provider: '7TV', perMinute: 2 },
      { provider: 'Other', perMinute: 2 },
    ])
  })
})
