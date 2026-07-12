import { describe, expect, it } from 'vitest'

import { resolveMomentRowStats, resolveRollupDisplayEmotes } from '@streampulse/analytics-console/utils/momentRowDisplay'

describe('resolveMomentRowStats', () => {
  it('prefers recap minute stats over rollup', () => {
    const stats = resolveMomentRowStats({
      moment: {
        offsetSeconds: 300,
        score: 80,
        chatCount: 99,
        emoteCount: 44,
        viewerCount: 1200,
      },
      rollups: [{ minuteTs: '2026-07-07T12:05:00.000Z', chatCount: 1, viewerAvg: 10 }],
      streamStartedAt: '2026-07-07T12:00:00.000Z',
    })
    expect(stats.chatPerMin).toBe(99)
    expect(stats.emotesPerMin).toBe(44)
    expect(stats.viewers).toBe(1200)
  })
})

describe('resolveRollupDisplayEmotes', () => {
  const catalog = [
    {
      key: 'twitch:dino-id:DinoDance',
      name: 'DinoDance',
      id: 'dino-id',
      provider: 'twitch',
      imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/dino/3.0',
      count: 42,
    },
  ]

  const rollup = { minuteTs: '2026-07-07T12:05:00.000Z', chatCount: 5 }

  it('falls back to heatmap emotes when rollup emote map is empty', () => {
    const emotes = resolveRollupDisplayEmotes({
      rollup,
      heatmapPoints: [
        {
          offsetSeconds: 300,
          durationSeconds: 60,
          score: 70,
          confidence: 0.9,
          reason: 'chat_spike',
          topEmotes: [
            {
              id: 'dino-id',
              name: 'DinoDance',
              imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/dino/3.0',
              count: 2,
              provider: 'twitch',
            },
          ],
          vodId: null,
          streamId: 's1',
          minuteTs: '2026-07-07T12:05:00.000Z',
        },
      ],
      topEmotesCatalog: catalog,
      limit: 3,
    })
    expect(emotes).toHaveLength(1)
    expect(emotes[0].name).toBe('DinoDance')
    expect(emotes[0].count).toBe(2)
  })

  it('uses recap topEmotes when rollup has no emote map', () => {
    const emotes = resolveRollupDisplayEmotes({
      rollup: { minuteTs: '2026-07-07T12:05:00.000Z', chatCount: 0 },
      recapMoment: {
        offsetSeconds: 300,
        score: 80,
        chatCount: 12,
        emoteCount: 6,
        topEmotes: [{ code: 'EZ', count: 3, provider: 'seventv' }],
      },
      limit: 3,
    })
    expect(emotes).toHaveLength(1)
    expect(emotes[0].name).toBe('EZ')
    expect(emotes[0].count).toBe(3)
  })
})
