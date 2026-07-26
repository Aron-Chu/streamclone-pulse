import {
  resolveLivePulseMoments,
  livePulseMomentsFromPublicHub,
} from '../src/lib/figmaSessionAnalytics'
import {
  filterMomentsByBucket,
  filterPulseMoments,
  isBucketWithinLiveHorizon,
  LIVE_PULSE_RECENT_WINDOW_MS,
  momentContextParts,
  momentEmoteTitle,
  momentHasEmoteRollups,
  resolveMomentEmote,
  resolveMomentEmotesPerMin,
  resolveMomentViewers,
  ROLLUP_CONFIDENCE_LABEL,
  sourceLabel,
  vodStateLabel,
  buildEmoteLookup,
} from '../src/lib/pulseMomentsUtils'
import type { PublicHub } from '../src/lib/publicHub'
import { hubCorpusPipelineFixture } from '../src/lib/publicHub'
import { describe, expect, it } from 'vitest'

function samplePublicHub(): PublicHub {
  return {
    generatedAt: new Date().toISOString(),
    poolSize: 1,
    corpus: {
      streamsTracked: 1,
      momentsDetected: 0,
      chatMessagesProcessed: 0,
      emotesIndexed: 0,
      vodsAnalyzed: 0,
    },
    coverage: {
      liveChannels: 1,
      trackingMax: 100,
      backfillActive: 0,
      backfillMax: 0,
      syncActive: 0,
      emotesIndexed: 0,
      databaseOk: true,
      state: 'operational',
    },
    corpusPipeline: hubCorpusPipelineFixture({
      generatedAt: new Date().toISOString(),
      state: 'healthy',
      topN: 500,
      collectorActive: 10,
      collectorMax: 100,
      roster: {
        live: 1,
        collectorTracking: 1,
        expectedCollectorRows: 1,
        liveCollectorDeficitRows: 0,
        metadataOnly: 0,
        metadataStale: 0,
        admissionDisabled: 0,
        capacityBlocked: 0,
        warming: 0,
        collecting: 1,
        viewerOnly: 0,
        zeroChatAfterAge: 0,
      },
    }),
    activity: { points: [], windowMinutes: 60, channelCount: 0 },
    emoteIntel: {
      emotesPerMin: 0,
      topEmoteSharePct: 0,
      uniqueEmotes: 0,
      biggestPeakPerMin: 0,
      seventvSharePct: 0,
      providerShares: [],
    },
    topEmotes: [{ name: 'KEKW', provider: '7tv', imageUrl: 'https://cdn.7tv.app/emote/kekw/1x.webp', count: 10, sharePct: 0 }],
    topMovers: [],
    liveChannels: [],
    moments: [],
    livePulseMoments: [],
    featuredSession: { state: 'empty', reason: 'no_qualifying_session' },
  }
}

describe('resolveLivePulseMoments', () => {
  it('labels featured fallback when livePulseMoments is empty', () => {
    const hub = samplePublicHub()
    hub.featuredSession = {
      state: 'ready',
      login: 'xqc',
      streamId: 's1',
      topMoments: [{ offsetSeconds: 60, score: 80, label: 'Chat spike' }],
    }
    const result = resolveLivePulseMoments(hub)
    expect(result.source).toBe('featured_fallback')
    expect(result.banner).toContain('Hosted API has not deployed network live moments yet')
    expect(result.moments).toHaveLength(1)
  })

  it('prefers network livePulseMoments', () => {
    const hub = samplePublicHub()
    hub.livePulseMoments = [
      { login: 'a', streamId: 's1', offsetSeconds: 1, score: 90, label: 'A' },
      { login: 'b', streamId: 's2', offsetSeconds: 2, score: 85, label: 'B' },
    ]
    hub.featuredSession = { state: 'ready', login: 'a', streamId: 's1', topMoments: [] }
    const result = resolveLivePulseMoments(hub)
    expect(result.source).toBe('network')
    expect(result.banner).toBeUndefined()
    expect(livePulseMomentsFromPublicHub(hub)).toHaveLength(2)
  })
})

describe('resolveMomentEmote', () => {
  it('falls back to hub lookup and marks missing image honestly', () => {
    const lookup = buildEmoteLookup(samplePublicHub().topEmotes)
    const resolved = resolveMomentEmote(
      {
        offsetSeconds: 1,
        score: 1,
        label: 'x',
        topEmoteCode: 'KEKW',
      },
      lookup,
    )
    expect(resolved?.imageUrl).toBe('https://cdn.7tv.app/emote/kekw/1x.webp')
    expect(resolved?.imageUnavailable).toBe(false)
  })

  it('uses text chip title when no image URL exists', () => {
    const resolved = resolveMomentEmote(
      {
        offsetSeconds: 1,
        score: 1,
        label: 'x',
        topEmotes: [{ name: 'NOIMG', provider: '7tv', count: 12 }],
      },
      new Map(),
    )
    expect(resolved?.imageUnavailable).toBe(true)
    expect(momentEmoteTitle(resolved!)).toContain('Image unavailable from backend')
    expect(momentEmoteTitle(resolved!)).toContain('12 uses')
  })
})

describe('filterMomentsByBucket', () => {
  it('keeps moments whose wall-clock peak falls inside the bucket', () => {
    const bucketT = 1_700_000_000_000
    const windowMinutes = 10_080 // 7d → 42-minute buckets
    const moments = [
      { offsetSeconds: 1, score: 90, label: 'in bucket', at: bucketT + 30_000 },
      { offsetSeconds: 2, score: 80, label: 'outside', at: bucketT + 120 * 60_000 },
    ]
    const filtered = filterMomentsByBucket(moments, bucketT, windowMinutes)
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.label).toBe('in bucket')
  })

  it('derives wall-clock time from channel startedAt when at is missing', () => {
    const startedAt = '2024-01-01T12:00:00.000Z'
    const startMs = Date.parse(startedAt)
    const bucketT = startMs + 5 * 60_000
    const moments = [
      { offsetSeconds: 300, score: 90, label: 'derived', login: 'xqc' },
    ]
    const filtered = filterMomentsByBucket(moments, bucketT, 1440, [
      { login: 'xqc', startedAt },
    ])
    expect(filtered).toHaveLength(1)
  })
})

describe('isBucketWithinLiveHorizon', () => {
  it('treats recent buckets as within the live pulse window', () => {
    const now = 1_700_000_000_000
    expect(isBucketWithinLiveHorizon(now - LIVE_PULSE_RECENT_WINDOW_MS + 60_000, now)).toBe(true)
  })

  it('treats older buckets as outside the live pulse window', () => {
    const now = 1_700_000_000_000
    expect(isBucketWithinLiveHorizon(now - LIVE_PULSE_RECENT_WINDOW_MS - 60_000, now)).toBe(false)
  })
})

describe('fallback filter guard', () => {
  it('forces all filter so hidden fallback filters cannot hide rows', () => {
    const source = 'featured_fallback' as const
    const userFilter = 'chat' as const
    const effective = source === 'featured_fallback' || source === 'legacy_fallback' ? 'all' : userFilter
    const moments = [{ offsetSeconds: 1, score: 90, label: 'Emote spike', kind: 'emotes' }]
    expect(filterPulseMoments(moments, userFilter)).toHaveLength(0)
    expect(filterPulseMoments(moments, effective)).toHaveLength(1)
  })
})

describe('moment emote rollups', () => {
  it('detects when backend attached emote rows', () => {
    expect(momentHasEmoteRollups({ offsetSeconds: 1, score: 1, label: 'x', topEmotes: [{ name: 'KEKW', count: 3 }] })).toBe(true)
    expect(momentHasEmoteRollups({ offsetSeconds: 1, score: 1, label: 'x', topEmoteCode: 'KEKW' })).toBe(true)
    expect(momentHasEmoteRollups({ offsetSeconds: 1, score: 1, label: '7TV emote spike' })).toBe(false)
  })

  it('momentContextParts still maps operator labels for diagnostics tooling', () => {
    const parts = momentContextParts({
      offsetSeconds: 1,
      score: 1,
      label: 'x',
      source: 'live_irc',
      confidence: 100,
      vodState: 'live_only',
    })
    expect(parts).toEqual(['Live IRC', '100% conf'])
  })
})

describe('sourceLabel', () => {
  it('returns honest unknown label for empty source', () => {
    expect(sourceLabel(undefined)).toBe('Unknown source')
    expect(sourceLabel('')).toBe('Unknown source')
    expect(sourceLabel('   ')).toBe('Unknown source')
  })

  it('maps known source values', () => {
    expect(sourceLabel('live_irc')).toBe('Live IRC')
    expect(sourceLabel('corpus_historical')).toBe('Corpus historical')
    expect(sourceLabel('gql_gold')).toBe('Gold VOD corpus')
    expect(sourceLabel('vod_synced')).toBe('VOD synced')
    expect(sourceLabel('partial')).toBe('Partial IRC')
  })
})

describe('vodStateLabel', () => {
  it('maps vod_ready to VOD ready', () => {
    expect(vodStateLabel('vod_ready')).toBe('VOD ready')
  })

  it('preserves existing mappings', () => {
    expect(vodStateLabel('synced')).toBe('Synced')
    expect(vodStateLabel('partial')).toBe('Partial')
    expect(vodStateLabel('no_vod')).toBe('Live IRC')
  })

  it('does not claim Live IRC once the channel is known offline', () => {
    expect(vodStateLabel('no_vod', false)).toBe('IRC (VOD pending)')
    expect(vodStateLabel('live_only', false)).toBe('IRC (VOD pending)')
    // Live or unknown liveness keeps the current copy.
    expect(vodStateLabel('no_vod', true)).toBe('Live IRC')
    expect(vodStateLabel('no_vod', undefined)).toBe('Live IRC')
    // VOD-backed states are unaffected by liveness.
    expect(vodStateLabel('vod_ready', false)).toBe('VOD ready')
  })
})

describe('filterPulseMoments stream_opening filter', () => {
  it('matches stream_opening kind, early_stream tag, and just went live label', () => {
    const moments = [
      { offsetSeconds: 1, score: 90, label: 'Just went live', kind: 'stream_opening' },
      { offsetSeconds: 2, score: 80, label: 'Chat spike', kind: 'chat_spike' },
      { offsetSeconds: 3, score: 70, label: 'Chat spike', activityTag: 'early_stream' },
      { offsetSeconds: 4, score: 60, label: 'Emote spike', kind: 'emote_spike' },
    ]
    const filtered = filterPulseMoments(moments, 'stream_opening')
    expect(filtered.map((m) => m.offsetSeconds)).toEqual([1, 3])
  })
})

describe('momentActivityBadge', () => {
  it('prefers Just went live for stream_opening over early_stream tag', async () => {
    const { momentActivityBadge } = await import('../src/lib/pulseMomentsUtils')
    expect(
      momentActivityBadge({
        offsetSeconds: 60,
        score: 80,
        label: '7TV emote spike',
        kind: 'stream_opening',
        activityTag: 'early_stream',
      }),
    ).toBe('Just went live')
  })

  it('maps late_stream activity tag', async () => {
    const { momentActivityBadge } = await import('../src/lib/pulseMomentsUtils')
    expect(
      momentActivityBadge({
        offsetSeconds: 3500,
        score: 70,
        label: 'Chat spike',
        activityTag: 'late_stream',
      }),
    ).toBe('Late stream')
  })
})

describe('momentEmoteRollupsEmptyHint opening copy', () => {
  it('uses opening-minute copy for early stream chat spikes', async () => {
    const { momentEmoteRollupsEmptyHint } = await import('../src/lib/pulseMomentsUtils')
    expect(
      momentEmoteRollupsEmptyHint({
        offsetSeconds: 60,
        score: 80,
        label: 'Chat spike',
        activityTag: 'early_stream',
      }),
    ).toMatch(/Opening minute/i)
  })
})

describe('momentWallClockLabel', () => {
  it('formats local wall clock when moment.at is present', async () => {
    const { momentWallClockLabel } = await import('../src/lib/pulseMomentsUtils')
    const at = Date.parse('2026-07-04T04:06:00.000Z')
    const label = momentWallClockLabel({ offsetSeconds: 120, score: 1, label: 'x', at })
    const expected = new Date(at).toLocaleString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
    expect(label.primary).toBe(expected)
    expect(label.secondary).toContain('into stream')
  })

  it('falls back to stream offset when wall clock is unknown', async () => {
    const { momentWallClockLabel } = await import('../src/lib/pulseMomentsUtils')
    const label = momentWallClockLabel({ offsetSeconds: 180, score: 1, label: 'x' })
    expect(label.primary).toBe('3:00')
  })
})

describe('momentTotalEmoteUses', () => {
  it('sums top emote counts for the minute', async () => {
    const { momentTotalEmoteUses } = await import('../src/lib/pulseMomentsUtils')
    expect(
      momentTotalEmoteUses({
        offsetSeconds: 1,
        score: 1,
        label: 'x',
        topEmotes: [
          { name: 'A', count: 6 },
          { name: 'B', count: 5 },
        ],
      }),
    ).toBe(11)
  })
})

describe('momentWhatHappenedSummary', () => {
  it('builds a readable one-liner with category and emote', async () => {
    const { momentWhatHappenedSummary } = await import('../src/lib/pulseMomentsUtils')
    const summary = momentWhatHappenedSummary({
      offsetSeconds: 60,
      score: 80,
      label: 'Just went live',
      kind: 'stream_opening',
      chatPerMin: 42,
      category: 'Just Chatting',
      topEmoteCode: 'KEKW',
    })
    expect(summary).toContain('Just went live')
    expect(summary).toContain('Just Chatting')
    expect(summary).toContain('KEKW')
  })
})

describe('resolveMomentEmotesPerMin', () => {
  it('prefers backend emotesPerMin over summed top emotes', () => {
    expect(
      resolveMomentEmotesPerMin({
        offsetSeconds: 60,
        score: 80,
        label: 'Emote spike',
        emotesPerMin: 420,
        topEmotes: [{ name: 'KEKW', count: 50 }],
      }),
    ).toBe(420)
  })

  it('falls back to summed top emote counts', () => {
    expect(
      resolveMomentEmotesPerMin({
        offsetSeconds: 60,
        score: 80,
        label: 'Emote spike',
        topEmotes: [
          { name: 'KEKW', count: 50 },
          { name: 'LUL', count: 30 },
        ],
      }),
    ).toBe(80)
  })
})

describe('resolveMomentViewers', () => {
  it('uses backend viewers when present', () => {
    expect(
      resolveMomentViewers(
        { offsetSeconds: 60, score: 80, label: 'Chat spike', viewers: 8420, login: 'xqc' },
        [{ login: 'xqc', viewers: 12000 }],
      ),
    ).toBe(8420)
  })

  it('falls back to live pool viewers for the channel', () => {
    expect(
      resolveMomentViewers(
        { offsetSeconds: 60, score: 80, label: 'Chat spike', login: 'caseoh' },
        [{ login: 'caseoh', viewers: 18500 }],
      ),
    ).toBe(18500)
  })
})

describe('resolveMomentViewerTableCell', () => {
  it('shows minute CCU when backend sends viewers at spike', async () => {
    const { resolveMomentViewerTableCell } = await import('../src/lib/pulseMomentsUtils')
    const cell = resolveMomentViewerTableCell(
      { offsetSeconds: 60, score: 80, label: 'Emote spike', viewers: 4900 },
      [],
    )
    expect(cell.text).toBe('4.9K')
    expect(cell.title).toContain('at this minute')
    expect(cell.muted).toBe(false)
  })

  it('falls back to live pool with muted styling when minute CCU is missing', async () => {
    const { resolveMomentViewerTableCell } = await import('../src/lib/pulseMomentsUtils')
    const cell = resolveMomentViewerTableCell(
      { offsetSeconds: 60, score: 80, label: 'Emote spike', login: 'forsen', viewerDelta: '+67' },
      [{ login: 'forsen', viewers: 12000 }],
    )
    expect(cell.text).toBe('12K')
    expect(cell.muted).toBe(true)
    expect(cell.title).toContain('live pool snapshot')
  })
})
