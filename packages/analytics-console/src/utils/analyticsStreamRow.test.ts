import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsStream, AnalyticsStreamDetail } from '../apiTypes.ts'
import { newerChannelStream, resolveChannelActuallyLive } from './analyticsStreamRow.ts'

// (fix, 10-30) GP-3 / PIC-3: stream 316705728883 (yuyuta0702) was never closed
// by the backend and carries the channel's current viewers (4,740). Raw rows
// without a lifecycle (local routes, legacy payloads) counted it as live.
// Trimmed from the 10-30 07:19Z evidence (past-stream.json, streams-12.json).

const READ_AT = Date.parse('2026-10-30T07:19:14.613Z')

function openRow(fields: Partial<AnalyticsStream> = {}): AnalyticsStream {
  return { streamId: '316705728883', login: 'yuyuta0702', startedAt: '2026-10-28T09:00:11Z', currentViewers: 4740, viewerSamples: 1, title: '学マス', ...fields }
}

function rawDetail(stream: AnalyticsStream): AnalyticsStreamDetail {
  return {
    channel: 'yuyuta0702',
    state: 'live',
    stream,
    rollups: [{ minuteTs: '2026-10-28T15:36:00.000Z', viewerAvg: 4740, viewerSamples: 1, chatCount: 493 }],
    topEmotes: [],
    sources: [],
    updatedAt: READ_AT,
  }
}

// The channel list, newest first: the live stream that started 10-30 04:20Z.
const channelStreams: AnalyticsStream[] = [
  { streamId: '316655688306', login: 'yuyuta0702', startedAt: '2026-10-30T04:20:06Z', currentViewers: 10682, viewerSamples: 1, title: 'ゆゆ散歩スペシャル 琵琶湖一周200キロかます' },
  openRow(),
  { streamId: '316627978609', login: 'yuyuta0702', startedAt: '2026-10-26T09:00:40Z', currentViewers: 8295, viewerSamples: 1, title: '押忍' },
]

describe('resolveChannelActuallyLive on a never-closed stream', () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date(READ_AT)))
  afterEach(() => vi.useRealTimers())

  it('is not live when the channel list has a newer stream for the same login', () => {
    // 46 h old at the read, so the 48 h guard alone does not catch it.
    expect(resolveChannelActuallyLive(rawDetail(openRow()), channelStreams)).toBe(false)
    // Twitch runs one broadcast per channel: a newer stream outranks the contract too.
    expect(resolveChannelActuallyLive(rawDetail(openRow({ lifecycleState: 'confirmed_live' })), channelStreams)).toBe(false)
    // The newest stream itself stays live.
    expect(resolveChannelActuallyLive(rawDetail(channelStreams[0]!), channelStreams)).toBe(true)
  })

  it('runs the 48 h guard before the viewer and activity shortcuts', () => {
    const fiftyHoursOld = openRow({ startedAt: new Date(READ_AT - 50 * 60 * 60 * 1000).toISOString() })
    expect(resolveChannelActuallyLive(rawDetail(fiftyHoursOld))).toBe(false)
    expect(resolveChannelActuallyLive({ ...rawDetail(fiftyHoursOld), stream: { ...fiftyHoursOld, currentViewers: 0 } })).toBe(false)
    // A fresh raw row with viewers is still live without a list.
    expect(resolveChannelActuallyLive(rawDetail(openRow({ startedAt: '2026-10-30T04:20:06Z' })))).toBe(true)
  })
})

describe('newerChannelStream', () => {
  it('names the newer row of the same channel', () => {
    expect(newerChannelStream(openRow(), channelStreams)?.streamId).toBe('316655688306')
    expect(newerChannelStream(channelStreams[0], channelStreams)).toBeUndefined()
  })

  it('ignores placeholders, other channels, this stream and rows standing in for it', () => {
    const newer = { startedAt: '2026-10-30T04:20:06Z', login: 'yuyuta0702' }
    expect(newerChannelStream(openRow(), [{ ...newer, streamId: 'pending-1', title: 'Syncing…' }])).toBeUndefined()
    expect(newerChannelStream(openRow(), [{ ...newer, streamId: '1', login: 'xqc', viewerSamples: 1 }])).toBeUndefined()
    expect(newerChannelStream(openRow(), [{ ...newer, streamId: '316705728883', viewerSamples: 1 }])).toBeUndefined()
    expect(newerChannelStream(openRow(), [{ ...newer, streamId: '2', canonicalStreamId: '316705728883', viewerSamples: 1 }])).toBeUndefined()
    expect(newerChannelStream(openRow(), undefined)).toBeUndefined()
    expect(newerChannelStream(openRow({ startedAt: '' }), channelStreams)).toBeUndefined()
  })
})
