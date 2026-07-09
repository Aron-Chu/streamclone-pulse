import { describe, expect, it } from 'vitest'
import {
  findNearestRollupByOffset,
  parseDeepLinkOffset,
  parseMomentHash,
  rollupOffsetSeconds,
} from '@streampulse/analytics-console'
import type { AnalyticsMinuteRollup } from '@streampulse/analytics-console'

function minute(minuteTs: string, chatCount: number, missing?: boolean): AnalyticsMinuteRollup {
  return {
    minuteTs,
    viewerAvg: 0,
    viewerMax: 0,
    viewerLatest: 0,
    viewerSamples: 0,
    chatCount,
    totalEmoteCount: 0,
    seventvEmoteCount: 0,
    emotes: {},
    missing,
  }
}

describe('parseMomentHash', () => {
  it('reads #t= offsets', () => {
    expect(parseMomentHash('#t=120')).toBe(120)
    expect(parseMomentHash('')).toBeNull()
    expect(parseMomentHash('#other')).toBeNull()
  })
})

describe('parseDeepLinkOffset', () => {
  it('reads hash and legacy query offsets', () => {
    expect(parseDeepLinkOffset('#t=18840', '')).toBe(18840)
    expect(parseDeepLinkOffset('', '?offset=18840')).toBe(18840)
    expect(parseDeepLinkOffset('', '?t=120')).toBe(120)
    expect(parseDeepLinkOffset('', '')).toBeNull()
  })
})

describe('findNearestRollupByOffset', () => {
  const startedAt = '2026-06-30T12:00:00.000Z'
  const rollups: AnalyticsMinuteRollup[] = [
    minute('2026-06-30T12:01:00.000Z', 10),
    minute('2026-06-30T12:05:00.000Z', 20),
    minute('2026-06-30T12:10:00.000Z', 30, true),
  ]

  it('computes rollup offsets from startedAt', () => {
    expect(rollupOffsetSeconds(rollups[0], startedAt)).toBe(60)
    expect(rollupOffsetSeconds(rollups[1], startedAt)).toBe(300)
  })

  it('selects nearest non-missing rollup', () => {
    const nearest = findNearestRollupByOffset(rollups, startedAt, 280)
    expect(nearest?.minuteTs).toBe('2026-06-30T12:05:00.000Z')
  })
})
