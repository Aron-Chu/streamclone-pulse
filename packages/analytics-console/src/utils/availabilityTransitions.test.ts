import { describe, expect, it } from 'vitest'
import { resolveVodLinkState } from './twitchVodUrl.ts'
import { mergeSessionStatusIntoDetail } from './sessionStatusMerge.ts'

describe('availability React Query transitions without remount', () => {
  const mapped = {
    channel: 'xqc', state: 'unknown', rollups: [], topEmotes: [], sources: [], updatedAt: 1,
    vodId: '111111111', vodAlignSeconds: 20, vodDurationSeconds: 1000,
    stream: { streamId: '123', login: 'xqc', startedAt: '', vodId: '111111111' },
    availability: { vodId: '111111111', chartUsable: true, liveDvrState: 'unknown' },
  }
  it('replaces source ID and clock as one status observation', () => {
    const corrected = mergeSessionStatusIntoDetail(mapped, {
      vodId: '222222222', vodAlignSeconds: -30, vodDurationSeconds: 2000,
      availability: { vodId: '222222222', vodState: 'linked' },
    })
    expect(corrected).toMatchObject({ vodId: '222222222', vodAlignSeconds: -30, vodDurationSeconds: 2000,
      stream: { vodId: '222222222' }, availability: { vodId: '222222222', chartUsable: true, liveDvrState: 'unknown' } })
  })
  it('clears old timing and every ID when a recheck invalidates the mapping', () => {
    const invalidated = mergeSessionStatusIntoDetail(mapped, { vodId: '' })
    expect(invalidated.vodId).toBe('')
    expect(invalidated.stream?.vodId).toBe('')
    expect(invalidated.availability?.vodId).toBe('')
    expect(invalidated.vodAlignSeconds).toBeUndefined()
    expect(invalidated.vodDurationSeconds).toBeUndefined()
  })
  it('does not inherit timing for a new ID, but preserves it on an unrelated status', () => {
    expect(mergeSessionStatusIntoDetail(mapped, { vodId: '222222222' }).vodAlignSeconds).toBeUndefined()
    expect(mergeSessionStatusIntoDetail(mapped, { syncPhase: 'ready' }).vodAlignSeconds).toBe(20)
  })
  it('merges live → ended resolving → linked status onto the same detail shell', () => {
    const base = {
      channel: 'xqc',
      state: 'live',
      rollups: [{ minuteTs: '2026-07-25T12:02:00Z', chatCount: 10 }],
      topEmotes: [{ key: 'a', name: 'KEKW', count: 3 }],
      sources: [],
      updatedAt: 1,
      availability: {
        chartUsable: true,
        chartState: 'usable',
        coveragePct: 99.36,
        missingRanges: [{ fromOffsetSeconds: 0, toOffsetSeconds: 120 }],
        liveDvrState: 'live',
        vodState: 'pending_live',
        backfillState: 'idle',
        corpusState: 'optional_absent',
      },
    }

    const ended = mergeSessionStatusIntoDetail(base, {
      state: 'historical',
      availability: {
        ...base.availability!,
        liveDvrState: 'ended',
        vodState: 'resolving',
        vodMessage: 'Resolving Twitch archive after stream end',
      },
    })
    expect(ended.rollups).toHaveLength(1)
    expect(ended.topEmotes).toHaveLength(1)
    expect(ended.availability?.vodState).toBe('resolving')
    expect(resolveVodLinkState({ detail: ended }).status).toBe('syncing')

    const linked = mergeSessionStatusIntoDetail(ended, {
      state: 'historical',
      vodId: '999999999',
      availability: {
        ...ended.availability!,
        vodState: 'linked',
        vodId: '999999999',
      },
    })
    expect(linked.rollups).toEqual(base.rollups)
    expect(resolveVodLinkState({ detail: linked }).status).toBe('linked')
    expect(resolveVodLinkState({ detail: linked }).vodId).toBe('999999999')
  })

  it('keeps request_failed recoverable and distinct from unavailable', () => {
    const failed = resolveVodLinkState({
      detail: {
        availability: { vodState: 'request_failed', vodMessage: 'network' },
      },
    })
    expect(failed.status).toBe('request_failed')
    const recovered = resolveVodLinkState({
      detail: {
        availability: { vodState: 'resolving' },
      },
    })
    expect(recovered.status).toBe('syncing')
  })

  it('does not repeat stale live VOD copy after a status cache miss on a past session', () => {
    const pastDetail = {
      ...mapped,
      state: 'historical',
      vodId: '',
      stream: { ...mapped.stream, vodId: '', lifecycleState: 'confirmed_ended' as const },
      availability: {
        ...mapped.availability,
        vodId: '',
        vodState: 'pending_live',
        vodMessage: 'This session is still live.',
      },
    }
    // A cache miss carries no fresh archive state, leaving the old VOD fields
    // in the detail shell while the independently observed lifecycle is ended.
    const afterMiss = mergeSessionStatusIntoDetail(pastDetail, {
      availability: { chartUsable: true },
    })
    const state = resolveVodLinkState({ detail: afterMiss, isLiveCollector: false, channelIsLive: false })
    expect(state.status).toBe('unavailable')
    expect(state.detail).not.toMatch(/still live|live archive/i)
  })

  it('does not use a pending-live archive state as live proof when lifecycle is unverified', () => {
    const pastDetail = {
      ...mapped,
      state: 'historical',
      vodId: '',
      stream: { ...mapped.stream, vodId: '' },
      availability: { ...mapped.availability, vodId: '', vodState: 'pending_live' },
    }
    const state = resolveVodLinkState({ detail: pastDetail, isLiveCollector: false, channelIsLive: false })
    expect(state.status).toBe('unavailable')
    expect(state.detail).not.toMatch(/still live|live archive/i)
  })
})
