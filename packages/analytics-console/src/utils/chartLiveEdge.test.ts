import { describe, expect, it } from 'vitest'
import type { AnalyticsMinuteRollup } from '../api.ts'
import { formatHeatOffset } from '@streampulse/pulse-core'
import {
  isUnfinishedLiveMinute,
  liveEdgeLabel,
  newestPlottedMinute,
  rollupsThroughMinute,
} from './chartLiveEdge.ts'

const START = Date.parse('2026-10-09T23:46:31.000Z')
const minute = (index: number, data = true): AnalyticsMinuteRollup => ({
  minuteTs: new Date(START + index * 60_000).toISOString(),
  chatCount: data ? 500 : 0,
  totalEmoteCount: data ? 80 : 0,
  viewerAvg: data ? 48_000 : 0,
  viewerSamples: data ? 1 : 0,
  emotes: {},
} as unknown as AnalyticsMinuteRollup)

describe('live edge of the session plot', () => {
  it('ends on the newest finished minute while the newest one is still measured', () => {
    const minutes = Array.from({ length: 21 }, (_, index) => minute(index))
    const measuredThrough = START + 20 * 60_000 + 23_000
    expect(isUnfinishedLiveMinute(minutes[20]!, measuredThrough)).toBe(true)
    expect(isUnfinishedLiveMinute(minutes[19]!, measuredThrough)).toBe(false)
    expect(newestPlottedMinute(minutes, measuredThrough)).toBe(minutes[19])
    expect(rollupsThroughMinute(minutes, minutes[19]!)).toHaveLength(20)
  })

  it('ends on the newest minute with data, never on trailing empty minutes', () => {
    const minutes = [...Array.from({ length: 10 }, (_, index) => minute(index)), minute(10, false), minute(11, false)]
    expect(newestPlottedMinute(minutes, null)).toBe(minutes[9])
    expect(rollupsThroughMinute(minutes, minutes[9]!)).toHaveLength(10)
  })

  it('leaves off at most the one minute still being measured', () => {
    // A read stamped long before its minutes (a stale timestamp) never hides more than one.
    const minutes = Array.from({ length: 10 }, (_, index) => minute(index))
    expect(newestPlottedMinute(minutes, START + 2 * 60_000)).toBe(minutes[8])
    // The only minute with data is plotted even while it is measured.
    expect(newestPlottedMinute([minute(0)], START + 5_000)).toEqual(minute(0))
    expect(newestPlottedMinute([], START)).toBeNull()
  })

  it('says "updating" while fresh and names the last measured time when collection falls behind', () => {
    const last = minute(19)
    const fresh = liveEdgeLabel({ lastMinute: last, measuredThroughMs: START + 20 * 60_000 + 40_000, streamStartedAt: new Date(START).toISOString(), formatOffset: formatHeatOffset })
    expect(fresh).toBe('Live · updating')
    const stale = liveEdgeLabel({ lastMinute: last, measuredThroughMs: START + 31 * 60_000, streamStartedAt: new Date(START).toISOString(), formatOffset: formatHeatOffset })
    expect(stale).toBe('Live · last data 00:20:00')
  })
})
