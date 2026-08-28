import { describe, expect, it } from 'vitest'
import { resolveVodLinkState } from './twitchVodUrl.ts'
import { mergeSessionStatusIntoDetail } from './sessionStatusMerge.ts'

describe('availability React Query transitions without remount', () => {
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
})
