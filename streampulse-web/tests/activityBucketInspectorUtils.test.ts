import { describe, expect, it } from 'vitest'
import type { HubActivityPoint } from '../src/lib/publicHub'
import {
  aggregateEmotesFromMoments,
  resolveInspectorTableEmotes,
  inspectorEmoteListSignature,
} from '../src/ui/components/analytics/activityBucketInspectorUtils'

const bucketPoint: HubActivityPoint = {
  t: 1_700_000_000_000,
  viewers: 500_000,
  chat: 400,
  seventv: 200,
  topEmotes: [
    { name: 'EDM', provider: '7tv', count: 11000 },
    { name: 'LUL', provider: 'twitch', count: 3800 },
  ],
}

const rangeEmotes = [
  { name: 'KEKW', provider: '7tv', count: 50000, sharePct: 12 },
  { name: 'OM', provider: 'twitch', count: 30000, sharePct: 8 },
]

describe('resolveInspectorTableEmotes', () => {
  it('uses window emotes in range mode', () => {
    const emotes = resolveInspectorTableEmotes('range', null, rangeEmotes)
    expect(emotes.map((e) => e.name)).toEqual(['KEKW', 'OM'])
  })

  it('uses per-bucket emotes in preview mode when bucket has breakdown', () => {
    const emotes = resolveInspectorTableEmotes('preview', bucketPoint, rangeEmotes)
    expect(emotes.map((e) => e.name)).toEqual(['EDM', 'LUL'])
  })

  it('shows empty list in preview when bucket has no topEmotes', () => {
    const emptyBucket: HubActivityPoint = { ...bucketPoint, topEmotes: [] }
    const emotes = resolveInspectorTableEmotes('preview', emptyBucket, rangeEmotes)
    expect(emotes).toEqual([])
  })

  it('shows empty list in selected mode when bucket has no topEmotes', () => {
    const emptyBucket: HubActivityPoint = { ...bucketPoint, topEmotes: [] }
    const emotes = resolveInspectorTableEmotes('selected', emptyBucket, rangeEmotes)
    expect(emotes).toEqual([])
  })

  it('uses per-bucket emotes in selected mode', () => {
    const emotes = resolveInspectorTableEmotes('selected', bucketPoint, rangeEmotes)
    expect(emotes[0]?.name).toBe('EDM')
  })

  it('falls back to moment emotes when bucket has no topEmotes', () => {
    const emptyBucket: HubActivityPoint = { ...bucketPoint, topEmotes: [] }
    const momentEmotes = [{ name: 'KEKW', provider: '7tv', count: 900, sharePct: 0 }]
    const emotes = resolveInspectorTableEmotes('selected', emptyBucket, rangeEmotes, momentEmotes)
    expect(emotes.map((e) => e.name)).toEqual(['KEKW'])
  })
})

describe('aggregateEmotesFromMoments', () => {
  it('sums emote counts across moments', () => {
    const emotes = aggregateEmotesFromMoments([
      { offsetSeconds: 0, score: 1, label: 'a', topEmotes: [{ name: 'KEKW', provider: '7tv', count: 10 }] },
      { offsetSeconds: 60, score: 1, label: 'b', topEmotes: [{ name: 'KEKW', provider: '7tv', count: 5 }] },
    ])
    expect(emotes).toHaveLength(1)
    expect(emotes[0]?.count).toBe(15)
  })
})

describe('inspectorEmoteListSignature', () => {
  it('changes when emote counts change', () => {
    const a = inspectorEmoteListSignature([
      { name: 'A', provider: '7tv', count: 1, sharePct: 0, shareEstimated: false },
    ])
    const b = inspectorEmoteListSignature([
      { name: 'A', provider: '7tv', count: 2, sharePct: 0, shareEstimated: false },
    ])
    expect(a).not.toBe(b)
  })
})
