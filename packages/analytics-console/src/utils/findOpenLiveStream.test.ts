import { describe, expect, it } from 'vitest'
import type { AnalyticsStream } from '../api.ts'
import { findOpenLiveStream } from './analyticsStreamRow.ts'

const now = Date.parse('2026-10-21T20:00:00.000Z')
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString()

function stream(over: Partial<AnalyticsStream>): AnalyticsStream {
  return { streamId: 's', login: 'saltydune', displayName: 'Saltydune', title: 'Blitz', category: 'Chess', startedAt: hoursAgo(2), endedAt: '', currentViewers: 0, chatMessages: 40, viewerSamples: 3, ...over } as AnalyticsStream
}

describe('findOpenLiveStream (session-who W1 "Live now")', () => {
  it('is the newest broadcast while it has no end', () => {
    const live = stream({ streamId: 'live' })
    expect(findOpenLiveStream([live, stream({ streamId: 'old', startedAt: hoursAgo(30), endedAt: hoursAgo(26) })], now)).toBe(live)
  })

  it('is nothing once the newest broadcast has ended, even with an older row left open', () => {
    expect(findOpenLiveStream([
      stream({ streamId: 'ended', endedAt: hoursAgo(1) }),
      stream({ streamId: 'stuck', startedAt: hoursAgo(30) }),
    ], now)).toBeUndefined()
    expect(findOpenLiveStream([], now)).toBeUndefined()
  })

  it('drops a row open for over 48 h, a sync stub, and anything the backend calls ended', () => {
    expect(findOpenLiveStream([stream({ startedAt: hoursAgo(49) })], now)).toBeUndefined()
    expect(findOpenLiveStream([stream({ title: 'Syncing...', chatMessages: 0, viewerSamples: 0 })], now)).toBeUndefined()
    expect(findOpenLiveStream([stream({ lifecycleState: 'confirmed_ended' })], now)).toBeUndefined()
    expect(findOpenLiveStream([stream({ lifecycleState: 'confirmed_live', startedAt: hoursAgo(60) })], now)?.streamId).toBe('s')
  })
})
