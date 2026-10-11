import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  couldBeLiveArchive,
  isAcceptedLiveBridge,
  requestVodPulse,
  resetLiveArchiveMemo,
  retryAfterMs,
  shouldUseLiveBridge,
  VodBridgeTransientError,
  type LiveStreamIdentity,
} from '../src/background/vodLiveBridge.ts'
import type { ExtensionVodPulseResponse } from '../src/types/vodPulseTypes.ts'

// Shapes from the 2026-10-09 production probe (design-extension/vod-bridge-probe.txt):
// ohnepixel was live on stream 317967537252 (VOD 2896011569); the Oct 7 VOD
// 2894307326 is stream 317950783460, and the bridge answered it with the live DVR.
const NOW = Date.parse('2026-10-09T20:00:00Z')
const LIVE: LiveStreamIdentity = { isLive: true, streamId: '317967537252', startedAt: '2026-10-09T13:53:38Z' }

function plainVod(overrides: Partial<Extract<ExtensionVodPulseResponse, { mode: 'vod' }>> = {}): ExtensionVodPulseResponse {
  return {
    mode: 'vod',
    vodId: '2894307326',
    streamId: '317950783460',
    channelLogin: 'ohnepixel',
    startedAt: '2026-10-07T14:46:57Z',
    durationSeconds: 8 * 3600 + 25 * 60,
    coverageStatus: 'partial',
    resolutionState: 'helix_exact',
    ...overrides,
  }
}

function liveDvr(streamId: string): ExtensionVodPulseResponse {
  return {
    mode: 'live_dvr',
    vodId: null,
    streamId,
    login: 'ohnepixel',
    channelLogin: 'ohnepixel',
    isLive: true,
    tracking: true,
    provisional: true,
    resolutionState: 'live_stream_validated',
    retryable: true,
    currentOffsetSeconds: 6 * 3600,
    rollups: [],
    lanes: { composite: [], chat: [], seventv: [] },
  }
}

function conflict(): ExtensionVodPulseResponse {
  return { mode: 'vod', vodId: null, coverageStatus: 'error', resolutionState: 'live_archive_conflict', retryable: false }
}

describe('shouldUseLiveBridge: only the stream that is live now', () => {
  it('is false when the channel is offline or unknown', () => {
    expect(shouldUseLiveBridge({ vodId: '1', vodStreamId: 's', live: null })).toBe(false)
    expect(shouldUseLiveBridge({ vodId: '1', vodStreamId: 's', live: { isLive: false, streamId: 's' } })).toBe(false)
  })

  it('is false for a past VOD of a channel that is live right now', () => {
    expect(shouldUseLiveBridge({
      vodId: '2894307326',
      vodStreamId: '317950783460',
      vodStartedAt: '2026-10-07T14:46:57Z',
      live: LIVE,
    })).toBe(false)
  })

  it('is true for the archive of the live stream', () => {
    expect(shouldUseLiveBridge({ vodId: '2896011569', vodStreamId: '317967537252', live: LIVE })).toBe(true)
  })

  it('prefers stream ids, then the backend-known archive id, then start times', () => {
    expect(shouldUseLiveBridge({ vodId: '2896011569', live: { ...LIVE, streamId: null, vodId: '2896011569' } })).toBe(true)
    expect(shouldUseLiveBridge({ vodId: '2894307326', live: { ...LIVE, streamId: null, vodId: '2896011569' } })).toBe(false)
    expect(shouldUseLiveBridge({ vodId: 'x', vodStartedAt: '2026-10-09T13:54:10Z', live: { ...LIVE, streamId: null } })).toBe(true)
    expect(shouldUseLiveBridge({ vodId: 'x', vodStartedAt: '2026-10-08T13:40:29Z', live: { ...LIVE, streamId: null } })).toBe(false)
    expect(shouldUseLiveBridge({ vodId: 'x', live: { ...LIVE, streamId: null } })).toBe(false)
  })
})

describe('couldBeLiveArchive', () => {
  it('skips the live lookup for a VOD that ended days ago', () => {
    expect(couldBeLiveArchive(plainVod(), NOW)).toBe(false)
  })

  it('checks a VOD that is still growing', () => {
    expect(couldBeLiveArchive(plainVod({ startedAt: '2026-10-09T13:53:38Z', durationSeconds: 6 * 3600 }), NOW)).toBe(true)
    expect(couldBeLiveArchive(plainVod({ startedAt: '2026-10-09T13:53:38Z', durationSeconds: undefined }), NOW)).toBe(true)
  })
})

describe('isAcceptedLiveBridge', () => {
  it('rejects a live DVR for a different stream than the VOD', () => {
    expect(isAcceptedLiveBridge(liveDvr('317967537252'), '317950783460')).toBe(false)
    expect(isAcceptedLiveBridge(liveDvr('317967537252'), '317967537252')).toBe(true)
    expect(isAcceptedLiveBridge(plainVod(), '317950783460')).toBe(false)
    expect(isAcceptedLiveBridge(null, '317950783460')).toBe(false)
  })
})

describe('requestVodPulse', () => {
  beforeEach(() => resetLiveArchiveMemo())
  afterEach(() => vi.restoreAllMocks())

  function deps(answers: Array<ExtensionVodPulseResponse | Error>, live: LiveStreamIdentity | null = LIVE) {
    const calls: Array<{ bridge: boolean; streamId?: string }> = []
    const request = vi.fn(async (bridge: boolean, streamId?: string) => {
      calls.push({ bridge, streamId })
      const next = answers.shift()
      if (!next) throw new Error('unexpected request')
      if (next instanceof Error) throw next
      return next
    })
    const liveIdentity = vi.fn(async () => live)
    return { calls, liveIdentity, request, now: () => NOW }
  }

  async function confirmLiveArchive(): Promise<void> {
    const today = plainVod({ vodId: '2896011569', streamId: '317967537252', startedAt: '2026-10-09T13:53:38Z', durationSeconds: 6 * 3600 })
    await requestVodPulse('2896011569', {}, deps([today, liveDvr('317967537252')]))
  }

  it('asks for a past VOD of a live channel without the bridge, and never looks up the live stream', async () => {
    const d = deps([plainVod()])
    const result = await requestVodPulse('2894307326', {}, d)
    expect(d.calls).toEqual([{ bridge: false, streamId: undefined }])
    expect(d.liveIdentity).not.toHaveBeenCalled()
    expect(result).toMatchObject({ outcome: 'plain', payload: { mode: 'vod', streamId: '317950783460' } })
  })

  it('never bridges a finished VOD, even when the backend still reports its stream as live', async () => {
    // 2026-10-09 20:48Z probe: the channel endpoint still said ohnepixel was live on
    // the Oct 8 stream, and the bridge answered the Oct 7 VOD with a 54-hour live DVR.
    const d = deps([plainVod({ vodId: '2895134414', streamId: '317958786276', startedAt: '2026-10-08T13:40:29Z', durationSeconds: 9 * 3600 })], {
      isLive: true,
      streamId: '317958786276',
      startedAt: '2026-10-08T13:40:29Z',
    })
    const result = await requestVodPulse('2895134414', { login: 'ohnepixel' }, d)
    expect(d.calls).toEqual([{ bridge: false, streamId: undefined }])
    expect(d.liveIdentity).not.toHaveBeenCalled()
    expect(result.payload.mode).toBe('vod')
  })

  it('ignores a stale stream assertion from a past-stream link and keeps the plain answer', async () => {
    const d = deps([plainVod()])
    const result = await requestVodPulse('2894307326', { streamId: '317967537252', login: 'ohnepixel' }, d)
    expect(d.calls).toEqual([{ bridge: false, streamId: undefined }])
    expect(result.payload.mode).toBe('vod')
  })

  it('uses the bridge for the archive of the stream that is live now', async () => {
    const today = plainVod({ vodId: '2896011569', streamId: '317967537252', startedAt: '2026-10-09T13:53:38Z', durationSeconds: 6 * 3600 })
    const d = deps([today, liveDvr('317967537252')])
    const result = await requestVodPulse('2896011569', {}, d)
    expect(d.liveIdentity).toHaveBeenCalledWith('ohnepixel')
    expect(d.calls).toEqual([
      { bridge: false, streamId: undefined },
      { bridge: true, streamId: '317967537252' },
    ])
    expect(result).toMatchObject({ outcome: 'bridge', payload: { mode: 'live_dvr', streamId: '317967537252' } })
  })

  it('keeps the plain answer when the bridge answers with another stream or fails', async () => {
    const today = plainVod({ vodId: '2896011569', streamId: '317967537252', startedAt: '2026-10-09T13:53:38Z', durationSeconds: 6 * 3600 })
    for (const bridged of [liveDvr('999'), conflict(), new Error('pulse 409')]) {
      resetLiveArchiveMemo()
      const d = deps([today, bridged])
      const result = await requestVodPulse('2896011569', {}, d)
      expect(result).toMatchObject({ outcome: 'bridge_rejected', payload: { mode: 'vod', streamId: '317967537252' } })
    }
  })

  it('a confirmed live archive asks with the bridge first; on failure it retries once without it', async () => {
    const today = plainVod({ vodId: '2896011569', streamId: '317967537252', startedAt: '2026-10-09T13:53:38Z', durationSeconds: 6 * 3600 })
    const first = deps([today, liveDvr('317967537252')])
    await requestVodPulse('2896011569', {}, first)

    const poll = deps([liveDvr('317967537252')])
    const polled = await requestVodPulse('2896011569', { streamId: '317967537252' }, poll)
    expect(poll.calls).toEqual([{ bridge: true, streamId: '317967537252' }])
    expect(polled.outcome).toBe('bridge')

    // The stream ended: the bridge now conflicts, so the retry is plain and the
    // channel is offline, so the bridge is not asked again.
    const ended = deps([conflict(), plainVod({ vodId: '2896011569', streamId: '317967537252', startedAt: '2026-10-09T13:53:38Z', durationSeconds: 6 * 3600 })], { isLive: false })
    const after = await requestVodPulse('2896011569', { streamId: '317967537252' }, ended)
    expect(ended.calls).toEqual([
      { bridge: true, streamId: '317967537252' },
      { bridge: false, streamId: undefined },
    ])
    expect(after).toMatchObject({ outcome: 'bridge_rejected', payload: { mode: 'vod' } })
  })

  it('a not-yet-listed live archive uses the bridge only with proof it is the live stream', async () => {
    const missing: ExtensionVodPulseResponse = { mode: 'vod', vodId: null, coverageStatus: 'missing' }
    const proven = deps([missing, liveDvr('317967537252')])
    const ok = await requestVodPulse('2896011569', { streamId: '317967537252', login: 'ohnepixel' }, proven)
    expect(proven.calls[1]).toEqual({ bridge: true, streamId: '317967537252' })
    expect(ok.payload.mode).toBe('live_dvr')

    resetLiveArchiveMemo()
    const unproven = deps([missing])
    const honest = await requestVodPulse('2859854973', { login: 'ohnepixel' }, unproven)
    expect(unproven.calls).toEqual([{ bridge: false, streamId: undefined }])
    expect(honest.payload.coverageStatus).toBe('missing')

    const placeholder = deps([missing])
    await requestVodPulse('2859854973', { login: '__vod__:2859854973' }, placeholder)
    expect(placeholder.liveIdentity).not.toHaveBeenCalled()
  })

  it('a failed live lookup falls back to the plain answer', async () => {
    const today = plainVod({ vodId: '2896011569', streamId: '317967537252', startedAt: '2026-10-09T13:53:38Z', durationSeconds: 6 * 3600 })
    const d = deps([today])
    d.liveIdentity.mockRejectedValueOnce(new Error('pulse 404'))
    const result = await requestVodPulse('2896011569', {}, d)
    expect(d.calls).toHaveLength(1)
    expect(result.payload.mode).toBe('vod')
  })

  it('a 429, 5xx or network failure on a live-archive poll keeps the live DVR and sends nothing else', async () => {
    for (const failure of [
      new VodBridgeTransientError(429, 120_000),
      new VodBridgeTransientError(504),
      new TypeError('Failed to fetch'),
    ]) {
      resetLiveArchiveMemo()
      await confirmLiveArchive()
      const poll = deps([failure])
      const polled = await requestVodPulse('2896011569', { streamId: '317967537252' }, poll)
      expect(poll.calls).toEqual([{ bridge: true, streamId: '317967537252' }])
      expect(poll.liveIdentity).not.toHaveBeenCalled()
      expect(polled).toMatchObject({ outcome: 'bridge_transient', payload: { mode: 'live_dvr', streamId: '317967537252' } })
    }
  })

  it('waits out Retry-After on the live bridge, then asks again and recovers', async () => {
    await confirmLiveArchive()
    let clock = NOW
    const failing = { ...deps([new VodBridgeTransientError(429, 120_000)]), now: () => clock }
    await requestVodPulse('2896011569', { streamId: '317967537252' }, failing)

    clock = NOW + 30_000
    const inside = { ...deps([]), now: () => clock }
    const kept = await requestVodPulse('2896011569', { streamId: '317967537252' }, inside)
    expect(inside.calls).toEqual([])
    expect(kept).toMatchObject({ outcome: 'bridge_transient', payload: { mode: 'live_dvr' } })

    clock = NOW + 121_000
    const healthy = { ...deps([liveDvr('317967537252')]), now: () => clock }
    const back = await requestVodPulse('2896011569', { streamId: '317967537252' }, healthy)
    expect(healthy.calls).toEqual([{ bridge: true, streamId: '317967537252' }])
    expect(back.outcome).toBe('bridge')
  })

  it('after five minutes without a confirmed answer the poll checks again from the plain request', async () => {
    await confirmLiveArchive()
    const late = {
      ...deps([plainVod({ vodId: '2896011569', streamId: '317967537252', startedAt: '2026-10-09T13:53:38Z', durationSeconds: 6 * 3600 })], { isLive: false }),
      now: () => NOW + 6 * 60_000,
    }
    const result = await requestVodPulse('2896011569', { streamId: '317967537252' }, late)
    expect(late.calls).toEqual([{ bridge: false, streamId: undefined }])
    expect(result.payload.mode).toBe('vod')
  })

  it('an outage longer than the memo keeps the live DVR while the stream is still live', async () => {
    await confirmLiveArchive()
    const today = plainVod({ vodId: '2896011569', streamId: '317967537252', startedAt: '2026-10-09T13:53:38Z', durationSeconds: 6 * 3600 })
    const transient = new VodBridgeTransientError(503)
    // Inside the memo: bridge only, last live DVR kept.
    const inside = { ...deps([transient]), now: () => NOW + 4 * 60_000 }
    expect(await requestVodPulse('2896011569', { streamId: '317967537252' }, inside)).toMatchObject({ outcome: 'bridge_transient', payload: { mode: 'live_dvr' } })
    // Memo ran out, bridge still silent, channel still live on this stream: keep the live DVR.
    const outlasted = { ...deps([today, transient]), now: () => NOW + 6 * 60_000 }
    const kept = await requestVodPulse('2896011569', { streamId: '317967537252' }, outlasted)
    expect(outlasted.calls).toEqual([{ bridge: false, streamId: undefined }, { bridge: true, streamId: '317967537252' }])
    expect(kept).toMatchObject({ outcome: 'bridge_transient', payload: { mode: 'live_dvr', streamId: '317967537252' } })
    // The next poll goes back to the bridge first, and the bridge recovering is accepted.
    const back = { ...deps([liveDvr('317967537252')]), now: () => NOW + 6 * 60_000 + 30_000 }
    expect(await requestVodPulse('2896011569', { streamId: '317967537252' }, back)).toMatchObject({ outcome: 'bridge' })
    expect(back.calls).toEqual([{ bridge: true, streamId: '317967537252' }])
  })

  it('an outage longer than the memo still ends on the plain archive once the channel is offline', async () => {
    await confirmLiveArchive()
    const today = plainVod({ vodId: '2896011569', streamId: '317967537252', startedAt: '2026-10-09T13:53:38Z', durationSeconds: 6 * 3600 })
    const ended = { ...deps([today], { isLive: false }), now: () => NOW + 6 * 60_000 }
    const result = await requestVodPulse('2896011569', { streamId: '317967537252' }, ended)
    expect(ended.calls).toEqual([{ bridge: false, streamId: undefined }])
    expect(result).toMatchObject({ outcome: 'plain', payload: { mode: 'vod' } })
  })

  it('a definite rejection is not an outage: no live DVR is kept after it', async () => {
    await confirmLiveArchive()
    const today = plainVod({ vodId: '2896011569', streamId: '317967537252', startedAt: '2026-10-09T13:53:38Z', durationSeconds: 6 * 3600 })
    const rejected = { ...deps([conflict(), today, new VodBridgeTransientError(503)]), now: () => NOW + 60_000 }
    const result = await requestVodPulse('2896011569', { streamId: '317967537252' }, rejected)
    expect(result).toMatchObject({ outcome: 'bridge_rejected', payload: { mode: 'vod' } })
  })

  it('reads Retry-After as seconds or a date', () => {
    expect(retryAfterMs('120', NOW)).toBe(120_000)
    expect(retryAfterMs(new Date(NOW + 90_000).toUTCString(), NOW)).toBe(90_000)
    expect(retryAfterMs('soon', NOW)).toBeUndefined()
    expect(retryAfterMs(null, NOW)).toBeUndefined()
  })
})
