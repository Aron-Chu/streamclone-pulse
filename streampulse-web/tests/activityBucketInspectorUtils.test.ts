import { describe, expect, it } from 'vitest'
import type { HubActivityPoint } from '../src/lib/publicHub'
import {
  aggregateEmotesFromMoments,
  resolveInspectorRangeStats,
  resolveBucketMomentStreamers,
  resolveInspectorTableEmotes,
  resolveTopLiveStreamers,
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

describe('resolveInspectorRangeStats', () => {
  it('returns emote economy KPIs when intel is populated', () => {
    const stats = resolveInspectorRangeStats(
      {
        emotesPerMin: 882,
        topEmoteSharePct: 5.8,
        uniqueEmotes: 12_400,
        biggestPeakPerMin: 320,
        seventvSharePct: 61,
        providerShares: [],
      },
      'DinoDance',
    )
    expect(stats.stat1Label).toBe('Unique emotes')
    expect(stats.stat1Value).toBe('12.4K')
    expect(stats.stat2Label).toBe('Avg emotes/min')
    expect(stats.stat2Value).toBe('882/m')
    expect(stats.stat3Label).toBe('Top emote share')
    expect(stats.stat3Value).toBe('5.8%')
    expect(stats.headMetaExtra).toBe('DinoDance leads')
  })

  it('returns dashes when intel values are zero', () => {
    const stats = resolveInspectorRangeStats({
      emotesPerMin: 0,
      topEmoteSharePct: 0,
      uniqueEmotes: 0,
      biggestPeakPerMin: 0,
      seventvSharePct: 0,
      providerShares: [],
    })
    expect(stats.stat1Value).toBe('—')
    expect(stats.stat2Value).toBe('—')
    expect(stats.stat3Value).toBe('—')
    expect(stats.headMetaExtra).toBeNull()
  })

  it('returns dashes when intel is undefined', () => {
    const stats = resolveInspectorRangeStats(undefined)
    expect(stats.stat1Value).toBe('—')
    expect(stats.stat2Value).toBe('—')
    expect(stats.stat3Value).toBe('—')
  })

  it('omits headMetaExtra when top emote name is missing', () => {
    const stats = resolveInspectorRangeStats({
      emotesPerMin: 100,
      topEmoteSharePct: 12,
      uniqueEmotes: 50,
      biggestPeakPerMin: 200,
      seventvSharePct: 40,
      providerShares: [],
    })
    expect(stats.headMetaExtra).toBeNull()
  })
})

describe('resolveInspectorTableEmotes', () => {
  it('uses window emotes in range mode', () => {
    const emotes = resolveInspectorTableEmotes('range', null, rangeEmotes)
    expect(emotes.map((e) => e.name)).toEqual(['KEKW', 'OM'])
  })

  it('uses per-bucket emotes in preview mode when bucket has breakdown', () => {
    const emotes = resolveInspectorTableEmotes('preview', bucketPoint, rangeEmotes)
    expect(emotes.map((e) => e.name)).toEqual(['EDM', 'LUL'])
  })

  it('fills bucket emote imageUrl from window catalog when bucket row omits it', () => {
    const rangeWithImages = [
      ...rangeEmotes,
      {
        name: 'LUL',
        provider: 'twitch',
        count: 1000,
        sharePct: 5,
        imageUrl: 'https://cdn.7tv.app/emote/lul/1x.webp',
      },
    ]
    const emotes = resolveInspectorTableEmotes('selected', bucketPoint, rangeWithImages)
    expect(emotes.find((e) => e.name === 'LUL')?.imageUrl).toBe('https://cdn.7tv.app/emote/lul/1x.webp')
  })

  it('replaces broken proxy bucket imageUrl with window CDN catalog', () => {
    const bucketWithProxy: HubActivityPoint = {
      ...bucketPoint,
      topEmotes: [
        {
          name: 'WideFire',
          provider: '7tv',
          count: 11000,
          imageUrl: '/emotes/75f49395-d5fc-41da-998c-880c6d8fddcb/1x.webp',
        },
      ],
    }
    const rangeWithImages = [
      {
        name: 'WideFire',
        provider: 'seventv',
        count: 50000,
        sharePct: 12,
        imageUrl: 'https://cdn.7tv.app/emote/62a3bf572b964d6cc2766004/4x.webp',
      },
    ]
    const emotes = resolveInspectorTableEmotes('selected', bucketWithProxy, rangeWithImages)
    expect(emotes[0]?.imageUrl).toBe('https://cdn.7tv.app/emote/62a3bf572b964d6cc2766004/4x.webp')
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

describe('resolveTopLiveStreamers', () => {
  it('ranks live channels by peak chat or emote rate with viewer tie-break', () => {
    const streamers = resolveTopLiveStreamers([
      {
        login: 'xqc',
        viewers: 50_000,
        chatPerMin: 8000,
        emotesPerMin: 1200,
        seventvPerMin: 500,
        coverageState: 'live',
        trendPct: 0,
      },
      {
        login: 'ninja',
        viewers: 20_000,
        chatPerMin: 900,
        emotesPerMin: 9500,
        seventvPerMin: 400,
        coverageState: 'live',
        trendPct: 0,
      },
      {
        login: 'shroud',
        viewers: 80_000,
        chatPerMin: 700,
        emotesPerMin: 500,
        seventvPerMin: 200,
        coverageState: 'live',
        trendPct: 0,
      },
    ])
    expect(streamers.map((row) => row.login)).toEqual(['ninja', 'xqc', 'shroud'])
  })

  it('returns empty when no channels have logins', () => {
    expect(
      resolveTopLiveStreamers([
        {
          login: '  ',
          viewers: 1,
          chatPerMin: 1,
          seventvPerMin: 0,
          coverageState: 'live',
          trendPct: 0,
        },
      ]),
    ).toEqual([])
  })
})

describe('resolveBucketMomentStreamers', () => {
  it('recovers a selected bucket avatar from the live pool without replacing bucket rates', () => {
    const streamers = resolveBucketMomentStreamers(
      [{
        offsetSeconds: 60,
        label: 'Emote spike',
        login: 'rera_seal',
        chatPerMin: 120,
        emotesPerMin: 90,
      }],
      [{
        login: 'rera_seal',
        displayName: 'Rera Seal',
        profileImageUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/rera.png',
        viewers: 1000,
        chatPerMin: 20,
        emotesPerMin: 10,
        seventvPerMin: 5,
        coverageState: 'live',
        trendPct: 0,
      }],
    )

    expect(streamers).toEqual([{
      login: 'rera_seal',
      displayName: 'Rera Seal',
      profileImageUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/rera.png',
      chatPerMin: 120,
      emotesPerMin: 90,
    }])
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
