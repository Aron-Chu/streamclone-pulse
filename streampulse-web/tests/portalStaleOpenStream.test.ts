import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsStreamDetail, AnalyticsStreamsResponse } from '@streampulse/analytics-console'

// (fix, 10-30) GP-3 / PIC-3 check: stream 316705728883 (yuyuta0702, started
// 10-28 09:00Z) was never closed by the backend and still carries the
// channel's 4,740 viewers. The raw API calls it `live`; the hosted mapping must
// not. Trimmed from the 10-30 07:19Z evidence (past-stream.json,
// past-minutes.json): the newest minute is offset 23749, about 40 h old.

const apiClientMock = vi.fn()

vi.mock('../src/lib/apiClient', () => ({
  apiClient: (...args: unknown[]) => apiClientMock(...args),
  getBackendUrl: () => 'https://api.example.test',
}))

import { portalAnalyticsApi } from '../src/lib/streamcloneAnalytics'

const STARTED = '2026-10-28T09:00:11Z'
const READ_AT = Date.parse('2026-10-30T07:19:14.613Z')

function minute(offsetSeconds: number) {
  return { offsetSeconds, viewerAvg: 4740, viewerMax: 4740, viewerLatest: 4740, viewerSamples: 1, chatCount: 493, totalEmoteCount: 78 }
}

describe('hosted mapping of a never-closed open stream', () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date(READ_AT)))
  afterEach(() => {
    vi.useRealTimers()
    apiClientMock.mockReset()
  })

  it('maps the 10-28 open row to an unknown lifecycle, not live', async () => {
    apiClientMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/streams/316705728883')) {
        return { data: {
          channel: 'yuyuta0702',
          state: 'live',
          stream: { streamId: '316705728883', login: 'yuyuta0702', startedAt: STARTED, currentViewers: 4740, peakViewers: 9241, viewerSamples: 1, vodId: '2912916877' },
          sources: [],
          updatedAt: READ_AT,
          availability: { version: 'v1', liveDvrState: 'live', vodState: 'linked', vodId: '2912916877' },
        } }
      }
      if (path.includes('/streams/316705728883/minutes')) {
        return { data: { streamId: '316705728883', channel: 'yuyuta0702', startedAt: STARTED, minutes: [minute(23689), minute(23749)], updatedAt: READ_AT } }
      }
      throw new Error(`unexpected ${path}`)
    })
    const detail = (await portalAnalyticsApi.getAnalyticsStream('316705728883', { sparse: false, channel: 'yuyuta0702' })) as AnalyticsStreamDetail | null
    expect(detail?.stream?.currentViewers).toBe(4740)
    expect(detail?.stream?.lifecycleState).toBe('unknown')
    expect(detail?.state).toBe('unknown')
  })

  it('maps the channel list rows without a lifecycle to unknown', async () => {
    apiClientMock.mockResolvedValueOnce({ data: {
      channel: 'yuyuta0702',
      items: [
        { streamId: '316655688306', login: 'yuyuta0702', startedAt: '2026-10-30T04:20:06Z', endedAt: null, currentViewers: 10682, lifecycleState: null },
        { streamId: '316705728883', login: 'yuyuta0702', startedAt: STARTED, endedAt: null, currentViewers: 4740, lifecycleState: null },
      ],
      updatedAt: READ_AT,
    } })
    // The shared AnalyticsApi types this read as unknown; the console's api.ts casts it the same way.
    const list = (await portalAnalyticsApi.getAnalyticsStreams('yuyuta0702', 12)) as AnalyticsStreamsResponse
    expect(list.items.map((item) => item.lifecycleState)).toEqual(['unknown', 'unknown'])
  })
})
