import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsStreamDetail } from '@streampulse/analytics-console'

const apiClientMock = vi.fn()

vi.mock('../src/lib/apiClient', () => ({
  apiClient: (...args: unknown[]) => apiClientMock(...args),
  getBackendUrl: () => 'https://api.example.test',
}))

import {
  portalAnalyticsApi,
  portalLatestMeasuredMinuteMs,
  portalLifecycleDetailState,
  portalMeasuredLiveObservedMs,
} from '../src/lib/streamcloneAnalytics'

const STARTED = '2026-10-09T13:00:00Z'
const startMs = Date.parse(STARTED)
const stream = { streamId: 's-live', login: 'example', startedAt: STARTED }

// 2h05m into the broadcast; the last measured minute began 59 s ago.
const NOW = startMs + 125 * 60_000 + 59_000

function minute(offsetMinutes: number, extra: Record<string, unknown> = {}) {
  return { offsetSeconds: offsetMinutes * 60, viewerSamples: 2, viewerLatest: 30_000, chatCount: 200, ...extra }
}

describe('measured live evidence when the lifecycle contract is absent', () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date(NOW)))
  afterEach(() => {
    vi.useRealTimers()
    apiClientMock.mockReset()
  })

  it('finds the newest minute with a real observation, ignoring empty and missing rows', () => {
    const rows = [minute(120), minute(124), minute(125, { viewerSamples: 0, viewerLatest: 0, chatCount: 0 }), minute(126, { missing: true })]
    expect(portalLatestMeasuredMinuteMs(STARTED, rows)).toBe(startMs + 124 * 60_000)
    expect(portalLatestMeasuredMinuteMs(STARTED, [])).toBeNull()
    expect(portalLatestMeasuredMinuteMs(undefined, rows)).toBeNull()
  })

  it('shows live only for an open session whose newest observed minute is fresh', () => {
    const fresh = { liveDvrState: 'live', latestMeasuredMinuteMs: startMs + 125 * 60_000 }
    expect(portalLifecycleDetailState(stream, 'live', fresh)).toBe('live')
    // Observed through the end of that minute, capped at now.
    expect(portalMeasuredLiveObservedMs(stream, 'live', fresh, NOW)).toBe(NOW)
  })

  it('keeps unknown when any part of the evidence is missing, stale or contradicted', () => {
    const fresh = { liveDvrState: 'live', latestMeasuredMinuteMs: startMs + 125 * 60_000 }
    // No measured minute at all: same as before this change.
    expect(portalLifecycleDetailState(stream, 'live')).toBe('unknown')
    expect(portalLifecycleDetailState(stream, 'live', { liveDvrState: 'live', latestMeasuredMinuteMs: null })).toBe('unknown')
    // Newest observed minute ended more than 120 s ago (a stalled open row).
    expect(portalLifecycleDetailState(stream, 'live', { liveDvrState: 'live', latestMeasuredMinuteMs: startMs + 121 * 60_000 })).toBe('unknown')
    // Backend reports the archive ended or the session closed.
    expect(portalLifecycleDetailState(stream, 'live', { ...fresh, liveDvrState: 'ended' })).toBe('unknown')
    expect(portalLifecycleDetailState(stream, 'historical', fresh)).toBe('unknown')
    expect(portalLifecycleDetailState({ ...stream, endedAt: '2026-10-09T15:00:00Z' }, 'live', fresh)).toBe('unknown')
    // A minute stamped in the future or before the start is not evidence.
    expect(portalLifecycleDetailState(stream, 'live', { liveDvrState: 'live', latestMeasuredMinuteMs: NOW + 120_000 })).toBe('unknown')
    expect(portalLifecycleDetailState(stream, 'live', { liveDvrState: 'live', latestMeasuredMinuteMs: startMs - 60_000 })).toBe('unknown')
  })

  it('never overrides an explicit lifecycle contract', () => {
    const fresh = { liveDvrState: 'live', latestMeasuredMinuteMs: startMs + 125 * 60_000 }
    expect(portalLifecycleDetailState({ ...stream, lifecycleState: 'unknown' }, 'live', fresh)).toBe('unknown')
    expect(portalLifecycleDetailState({ ...stream, lifecycleState: 'confirmed_live' }, 'live', fresh)).toBe('unknown')
  })

  it('maps a live channel frame with a fresh minute to confirmed live', async () => {
    apiClientMock.mockResolvedValueOnce({
      data: {
        channel: 'example',
        state: 'live',
        stream: { ...stream, currentViewers: 30_000 },
        rollups: [minute(124), minute(125)],
        updatedAt: NOW,
        availability: { version: 'v1', liveDvrState: 'live', vodState: 'pending_live' },
      },
    })
    const detail = (await portalAnalyticsApi.getAnalyticsLive('example')) as AnalyticsStreamDetail
    expect(detail.state).toBe('live')
    expect(detail.stream?.lifecycleState).toBe('confirmed_live')
    expect(detail.stream?.lifecycleObservedAt).toBe(new Date(NOW).toISOString())
    expect(detail.stream?.endedAt).toBeUndefined()
  })

  it('maps a stream page (detail + minutes) with a fresh minute to confirmed live', async () => {
    apiClientMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/streams/s-live')) {
        return { data: {
          channel: 'example', state: 'live', stream, updatedAt: NOW,
          sources: [{ source: 'analytics_db', state: 'ready' }],
          availability: { version: 'v1', liveDvrState: 'live', vodState: 'pending_live' },
        } }
      }
      if (path.includes('/streams/s-live/minutes')) {
        return { data: { streamId: 's-live', channel: 'example', startedAt: STARTED, minutes: [minute(124), minute(125)], updatedAt: NOW } }
      }
      throw new Error(`unexpected ${path}`)
    })
    const detail = (await portalAnalyticsApi.getAnalyticsStream('s-live', { sparse: false, channel: 'example' })) as AnalyticsStreamDetail | null
    expect(detail?.state).toBe('live')
    expect(detail?.stream?.lifecycleState).toBe('confirmed_live')
  })

  it('keeps a live channel frame unknown when its newest minute is stale', async () => {
    apiClientMock.mockResolvedValueOnce({
      data: {
        channel: 'example',
        state: 'live',
        stream,
        rollups: [minute(100)],
        updatedAt: NOW,
        availability: { version: 'v1', liveDvrState: 'live' },
      },
    })
    const detail = (await portalAnalyticsApi.getAnalyticsLive('example')) as AnalyticsStreamDetail
    expect(detail.state).toBe('unknown')
    expect(detail.stream?.lifecycleState).toBe('unknown')
  })
})
