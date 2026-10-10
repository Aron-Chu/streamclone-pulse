import { describe, expect, it } from 'vitest'
import type { AnalyticsMinuteRollup } from '../api.ts'
import { formatHeatOffset } from '@streampulse/pulse-core'
import {
  isUnfinishedLiveMinute,
  liveEdgeLabel,
  newestPlottedMinute,
  plotEndMinutes,
  resolveLiveEdgeMode,
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

  it('treats a stream the API reports live as open while its live status is unconfirmed', () => {
    expect(resolveLiveEdgeMode({ state: 'historical' }, true)).toBe('live')
    expect(resolveLiveEdgeMode({ state: 'live', stream: { lifecycleState: 'unknown' } as never }, false)).toBe('unconfirmed')
    expect(resolveLiveEdgeMode({ state: 'unknown', availability: { liveDvrState: 'live' } as never }, false)).toBe('unconfirmed')
    expect(resolveLiveEdgeMode({ state: 'live', stream: { lifecycleState: 'confirmed_ended' } as never }, false)).toBeNull()
    expect(resolveLiveEdgeMode({ state: 'live', stream: { endedAt: '2026-10-10T01:00:00Z' } as never }, false)).toBeNull()
    expect(resolveLiveEdgeMode({ state: 'historical' }, false)).toBeNull()
    expect(resolveLiveEdgeMode(null, false)).toBeNull()
  })

  it('leaves off the minute collection stopped in (chat, no viewer sample) however old the read is', () => {
    // The reported stream: the newest minute has 355 chat and no viewer sample, read 53 minutes later.
    const minutes = [...Array.from({ length: 84 }, (_, index) => minute(index)), {
      ...minute(84),
      chatCount: 355,
      viewerAvg: 0,
      viewerSamples: 0,
    }]
    const readAt = START + 137 * 60_000
    expect(plotEndMinutes(minutes, readAt, true)).toEqual({ newest: minutes[84], plotted: minutes[83], leftOff: 'partial' })
    // An ended stream keeps its last minute.
    expect(plotEndMinutes(minutes, null, false)).toEqual({ newest: minutes[84], plotted: minutes[84], leftOff: null })
    // A chat-only stream (no viewer samples anywhere) has nothing to line up with, so nothing is left off.
    const chatOnly = minutes.map(point => ({ ...point, viewerAvg: 0, viewerSamples: 0 }))
    expect(plotEndMinutes(chatOnly, readAt, true).leftOff).toBeNull()
    // A minute still being measured is "updating", not "partial".
    expect(plotEndMinutes(minutes, START + 84 * 60_000 + 20_000, true).leftOff).toBe('updating')
  })

  it('leads the marker with "Unconfirmed" and names the last data when the live status is unconfirmed', () => {
    const args = { lastMinute: minute(83), streamStartedAt: new Date(START).toISOString(), formatOffset: formatHeatOffset, mode: 'unconfirmed' as const }
    expect(liveEdgeLabel({ ...args, measuredThroughMs: START + 137 * 60_000 })).toBe('Unconfirmed · last data 01:24:00')
    // Nothing confirms more data is coming, so it never says "updating".
    expect(liveEdgeLabel({ ...args, measuredThroughMs: START + 85 * 60_000 })).toBe('Unconfirmed · last data 01:24:00')
    expect(liveEdgeLabel({ ...args, measuredThroughMs: null })).toBe('Unconfirmed · last data 01:24:00')
  })
})
