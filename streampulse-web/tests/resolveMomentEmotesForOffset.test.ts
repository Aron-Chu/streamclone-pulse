import { describe, expect, it } from 'vitest'

import {
  resolveBurstDisplayEmote,
  resolveMomentEmotesForOffset,
} from '@streampulse/analytics-console/utils/recapEmoteEnrich'

describe('resolveBurstDisplayEmote', () => {
  const catalog = [
    {
      key: 'seventv:7cinema-id:7Cinema',
      name: '7Cinema',
      id: '7cinema-id',
      provider: 'seventv',
      imageUrl: 'https://cdn.7tv.app/emote/7Cinema/4x.webp',
      count: 7,
    },
  ]

  it('keeps minute burst count when catalog has higher session total', () => {
    const out = resolveBurstDisplayEmote(
      { code: '7Cinema', count: 1, provider: 'seventv' },
      catalog,
    )
    expect(out.count).toBe(1)
    expect(out.id).toBe('7cinema-id')
    expect(out.code).toBe('7Cinema')
  })
})

describe('resolveMomentEmotesForOffset', () => {
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

  const streamStartedAt = '2026-07-07T12:00:00.000Z'
  const rollups = [
    {
      minuteTs: '2026-07-07T12:05:00.000Z',
      chatCount: 12,
      emotes: { 'twitch:dino-id:DinoDance': 3 },
    },
  ]

  it('prefers moment.topEmotes when present', () => {
    const out = resolveMomentEmotesForOffset({
      moment: {
        offsetSeconds: 300,
        score: 80,
        topEmotes: [{ code: 'EZ', count: 2, provider: 'seventv' }],
      },
      rollups,
      streamStartedAt,
      topEmotesCatalog: catalog,
    })
    expect(out).toHaveLength(1)
    expect(out[0].code).toBe('EZ')
    expect(out[0].count).toBe(2)
  })

  it('falls back to minute rollup emotes when moment has no topEmotes', () => {
    const out = resolveMomentEmotesForOffset({
      moment: { offsetSeconds: 300, score: 80 },
      rollups,
      streamStartedAt,
      topEmotesCatalog: catalog,
    })
    expect(out).toHaveLength(1)
    expect(out[0].code).toBe('DinoDance')
    expect(out[0].count).toBe(3)
    expect(out[0].id).toBe('dino-id')
  })

  it('falls back to heatmap point emotes when rollup has no emote map', () => {
    const out = resolveMomentEmotesForOffset({
      moment: { offsetSeconds: 300, score: 80 },
      rollups: [{ minuteTs: '2026-07-07T12:05:00.000Z', chatCount: 5 }],
      streamStartedAt,
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
    })
    expect(out).toHaveLength(1)
    expect(out[0].code).toBe('DinoDance')
    expect(out[0].count).toBe(2)
  })
})
