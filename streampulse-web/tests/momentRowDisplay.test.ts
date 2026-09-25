import { describe, expect, it } from 'vitest'

import { resolveMomentRowStats, resolveRollupDisplayEmotes } from '@streampulse/analytics-console/utils/momentRowDisplay'

describe('resolveMomentRowStats', () => {
  it('preserves exact measured zero instead of an older positive detection snapshot', () => {
    const stats = resolveMomentRowStats({
      moment: { offsetSeconds: 30, score: 10, chatCount: 700, emoteCount: 500, viewerCount: 2000 },
      streamStartedAt: '2026-09-05T12:00:30Z',
      rollups: [{ minuteTs: '2026-09-05T12:01:00Z', chatCount: 0, totalEmoteCount: 0, viewerAvg: 0, viewerLatest: 0, viewerSamples: 1 }],
    })
    expect(stats).toEqual({ chatPerMin: 0, emotesPerMin: 0, viewers: 0 })
  })
  it('falls back only to a unique exact minute, using the actual stream origin', () => {
    const args = { moment: { offsetSeconds: 30, score: 10 }, streamStartedAt: '2026-09-05T12:00:30Z' }
    const exact = { minuteTs: '2026-09-05T12:01:00Z', chatCount: 279, totalEmoteCount: 34, viewerAvg: 3600, viewerLatest: 3600, viewerSamples: 1 }
    const nearby = { ...exact, minuteTs: '2026-09-05T12:02:00Z', chatCount: 900 }
    expect(resolveMomentRowStats({ ...args, rollups: [nearby, exact] })).toEqual({ chatPerMin: 279, emotesPerMin: 34, viewers: 3600 })
    for (const rollups of [[nearby], [{ ...exact, missing: true }, nearby], [exact, exact]]) {
      expect(resolveMomentRowStats({ ...args, rollups })).toEqual({ chatPerMin: null, emotesPerMin: null, viewers: null })
    }
    expect(resolveMomentRowStats({ ...args, streamStartedAt: undefined, rollups: [exact] })).toEqual({ chatPerMin: null, emotesPerMin: null, viewers: null })
  })
  it('keeps absent and invalid metric values unavailable', () => {
    expect(resolveMomentRowStats({ moment: { offsetSeconds: 30, score: 10, chatCount: NaN, emoteCount: -1, viewerCount: Infinity } })).toEqual({ chatPerMin: null, emotesPerMin: null, viewers: null })
  })
  it('does not turn a pre-stream row or absent emote map into a measured zero', () => {
    const args = { moment: { offsetSeconds: 0, score: 10 }, streamStartedAt: '2026-09-05T12:00:30Z' }
    expect(resolveMomentRowStats({ ...args, rollups: [{ minuteTs: '2026-09-05T11:59:00Z', chatCount: 900, totalEmoteCount: 700 }] })).toEqual({ chatPerMin: null, emotesPerMin: null, viewers: null })
    expect(resolveMomentRowStats({ ...args, rollups: [{ minuteTs: '2026-09-05T12:00:00Z', chatCount: 0 }] })).toEqual({ chatPerMin: 0, emotesPerMin: null, viewers: null })
  })
  it('uses exact minute measurements without filling unknown values from the detection snapshot', () => {
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
    expect(stats.chatPerMin).toBe(1)
    expect(stats.emotesPerMin).toBeNull()
    expect(stats.viewers).toBe(10)
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
