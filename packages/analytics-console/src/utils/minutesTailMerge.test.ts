import { describe, expect, it } from 'vitest'
import { maxRollupOffsetSeconds, mergeMinutesTailIntoDetail } from './minutesTailMerge.ts'
import type { AnalyticsStreamDetail } from '../apiTypes.ts'

const startedAt = '2026-07-26T15:00:00.000Z'

const base: AnalyticsStreamDetail = {
  channel: 'nmplol',
  state: 'live',
  stream: {
    streamId: '319549121886',
    login: 'nmplol',
    startedAt,
  },
  rollups: [
    { minuteTs: '2026-07-26T15:05:00.000Z', chatCount: 1 },
    { minuteTs: '2026-07-26T15:06:00.000Z', chatCount: 2 },
  ],
  topEmotes: [{ name: 'Kappa', key: 'twitch:1:Kappa', count: 1 }],
  sources: [],
  updatedAt: 1,
}

describe('mergeMinutesTailIntoDetail', () => {
  it('replaces the open minute and appends newer offsets', () => {
    const merged = mergeMinutesTailIntoDetail(base, {
      rollups: [
        { minuteTs: '2026-07-26T15:06:00.000Z', chatCount: 9 },
        { minuteTs: '2026-07-26T15:07:00.000Z', chatCount: 3 },
      ],
      topEmotes: [{ name: 'Pog', key: 'seventv:2:Pog', count: 4 }],
      updatedAt: 2,
    })
    expect(merged.rollups?.map((r) => [r.minuteTs, r.chatCount])).toEqual([
      ['2026-07-26T15:05:00.000Z', 1],
      ['2026-07-26T15:06:00.000Z', 9],
      ['2026-07-26T15:07:00.000Z', 3],
    ])
    expect(merged.topEmotes?.some((e) => e.key === 'seventv:2:Pog')).toBe(true)
    expect(merged.updatedAt).toBe(2)
  })

  it('maxRollupOffsetSeconds reads the live edge', () => {
    expect(maxRollupOffsetSeconds(base)).toBe(360)
    expect(maxRollupOffsetSeconds(undefined)).toBe(-1)
  })
})
