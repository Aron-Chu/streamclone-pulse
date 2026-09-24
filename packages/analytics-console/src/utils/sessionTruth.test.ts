import { describe, expect, it } from 'vitest'
import type { AnalyticsStream } from '../apiTypes.ts'
import { duration, durationFromDetail, formatDateTime, relativeTime } from './consoleFormat.ts'
import { analyticsStreamPathSlug } from './syncedLiveStream.ts'
import { isActiveLiveCollectorStream, resolveChannelActuallyLive } from './analyticsStreamRow.ts'

const stream = (streamId: string, startedAt: string, endedAt?: string): AnalyticsStream => ({
  streamId, login: 'example', startedAt, endedAt,
})

describe('session truth formatting', () => {
  it('explicit lifecycle outranks legacy live state and measured activity', () => {
    for (const lifecycleState of ['unknown', 'confirmed_ended'] as const) {
      const row = { ...stream('one', '2026-09-04T00:00:00Z'), title: 'Measured stream', viewerSamples: 10, currentViewers: 20, lifecycleState }
      expect(isActiveLiveCollectorStream(row, 'live')).toBe(false)
      expect(resolveChannelActuallyLive({ channel: 'example', state: 'live', stream: row, rollups: [], topEmotes: [], sources: [], updatedAt: 0 })).toBe(false)
    }
    expect(isActiveLiveCollectorStream({ ...stream('one', '2026-09-04T00:00:00Z'), title: 'Legacy', viewerSamples: 1 }, 'live')).toBe(true)
  })
  it('does not turn an unknown end into a duration through now', () => {
    expect(duration(stream('one', '2026-09-04T00:00:00Z'))).toBe('-')
    expect(duration({ ...stream('one', '2026-09-04T00:00:00Z', '2026-09-04T01:00:00Z'), lifecycleState: 'unknown' })).toBe('-')
  })

  it('never treats a stored end as exact even on confirmed-ended and legacy rows', () => {
    expect(duration({ ...stream('one', '2026-09-04T00:00:00Z', '2026-09-04T01:00:00Z'), lifecycleState: 'confirmed_ended' })).toBe('-')
    expect(duration(stream('legacy', '2026-09-04T00:00:00Z', '2026-09-04T01:00:00Z'))).toBe('-')
  })

  it('keeps backend measured span separate from wall-clock duration', () => {
    expect(durationFromDetail({
      channel: 'example', state: 'unknown', rollups: [], topEmotes: [], sources: [], updatedAt: 0,
      stream: { ...stream('one', '2026-09-04T00:00:00Z'), lifecycleState: 'unknown', measuredSpanSeconds: 3_600 },
    })).toBe('1h 0m')
    expect(duration({ ...stream('one', '2026-09-04T00:00:00Z'), lifecycleState: 'unknown', measuredSpanSeconds: 3_600 })).toBe('1h 0m')
    for (const measuredSpanSeconds of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(duration({ ...stream('one', '2026-09-04T00:00:00Z'), measuredSpanSeconds })).toBe('-')
    }
  })

  it('rejects invalid and sentinel timestamps', () => {
    expect(formatDateTime('not-a-date')).toBe('-')
    expect(relativeTime(Number.NaN)).toBe('-')
    expect(duration(stream('one', '2026-09-04T02:00:00Z', '2026-09-04T01:00:00Z'))).toBe('-')
  })

  it('uses immutable stream IDs for new links even across local-day collisions', () => {
    const first = stream('stream-a', '2026-09-04T00:30:00-07:00')
    const second = stream('stream-b', '2026-09-04T23:30:00-07:00')
    expect(analyticsStreamPathSlug(first, [first, second])).toBe('stream-a')
    expect(analyticsStreamPathSlug(second, [first, second])).toBe('stream-b')
  })
})
