import { describe, expect, it } from 'vitest'

import type { AnalyticsStreamDetail } from '@streampulse/analytics-console/apiTypes'
import { resolveChannelActuallyLive } from '@streampulse/analytics-console/utils/analyticsStreamRow'

function liveDetail(partial: Partial<AnalyticsStreamDetail> = {}): AnalyticsStreamDetail {
  const baseStream = {
    streamId: 'stale-open',
    broadcasterId: '123',
    login: 'kato_junichi0817',
    tags: [],
    startedAt: '2026-06-10T12:00:00.000Z',
    lastSeenAt: '2026-06-10T12:00:00.000Z',
    currentViewers: 0,
    avgViewers: 0,
    peakViewers: 0,
    viewerSamples: 0,
    chatMessages: 0,
    totalEmoteUses: 0,
    seventvEmoteUses: 0,
    title: 'Stale session',
    ...(partial.stream ?? {}),
  }
  return {
    channel: 'kato_junichi0817',
    state: partial.state ?? 'live',
    rollups: partial.rollups ?? [],
    topEmotes: partial.topEmotes ?? [],
    sources: partial.sources ?? [],
    updatedAt: partial.updatedAt ?? Date.now(),
    stream: baseStream,
  }
}

describe('resolveChannelActuallyLive', () => {
  it('returns false when API state is not live', () => {
    expect(resolveChannelActuallyLive(liveDetail({ state: 'historical' }))).toBe(false)
  })

  it('returns true when current viewers are present', () => {
    expect(
      resolveChannelActuallyLive(
        liveDetail({
          stream: {
            currentViewers: 42,
            title: 'Live now',
            broadcasterId: '123',
          } as AnalyticsStreamDetail['stream'],
        }),
      ),
    ).toBe(true)
  })

  it('returns true when minute rollups have activity', () => {
    expect(
      resolveChannelActuallyLive({
        ...liveDetail({}),
        rollups: [{ minuteTs: '2026-07-07T12:01:00.000Z', chatCount: 10, viewerAvg: 100 }],
      }),
    ).toBe(true)
  })

  it('returns false for stale open row older than 48h with no rollups', () => {
    const staleStarted = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
    expect(
      resolveChannelActuallyLive(
        liveDetail({
          stream: {
            startedAt: staleStarted,
            endedAt: undefined,
          } as AnalyticsStreamDetail['stream'],
        }),
      ),
    ).toBe(false)
  })
})
