import { describe, expect, it } from 'vitest'
import { groupMomentsByBroadcast } from '../src/lib/broadcastGroups'
import { rankBroadcastMoments, TOP_MOMENTS_PER_BROADCAST } from '../src/lib/momentRanking'
import type { DiscoveryMoment } from '../src/lib/discoveryMoments'
import type { PortalStreamRecapResponse } from '../src/lib/streamcloneAnalytics'

function moment(offsetSeconds: number, overrides: Partial<DiscoveryMoment> = {}): DiscoveryMoment {
  return {
    key: `${overrides.login ?? 'ohnepixel'}:${overrides.streamId ?? '900'}:${offsetSeconds}`,
    login: 'ohnepixel',
    streamId: '900',
    offsetSeconds,
    at: 1_700_000_000_000 + offsetSeconds * 1000,
    label: 'Emote spike',
    provenance: 'hub',
    ...overrides,
  }
}

function group(...moments: DiscoveryMoment[]) {
  return groupMomentsByBroadcast(moments)[0]
}

function recap(overrides: Partial<PortalStreamRecapResponse> = {}): PortalStreamRecapResponse {
  return { streamId: '900', login: 'ohnepixel', ...overrides }
}

describe('rankBroadcastMoments', () => {
  it("follows the server's ranking rather than stream order", () => {
    const ranking = rankBroadcastMoments(
      group(moment(60), moment(600), moment(1_200)),
      recap({
        topMoments: [
          { offsetSeconds: 1_200, score: 81, chatCount: 400 },
          { offsetSeconds: 60, score: 44, chatCount: 90 },
          { offsetSeconds: 600, score: 40, chatCount: 70 },
        ],
      }),
    )
    expect(ranking.ordering).toBe('server_score')
    expect(ranking.ranked.map(row => row.moment.offsetSeconds)).toEqual([1_200, 60, 600])
    expect(ranking.ranked.map(row => row.rank)).toEqual([1, 2, 3])
    expect(ranking.remainder).toEqual([])
  })

  it('holds back everything past the cap, in stream order', () => {
    const moments = Array.from({ length: 26 }, (_, index) => moment(index * 300))
    const ranking = rankBroadcastMoments(
      group(...moments),
      recap({ topMoments: moments.map((row, index) => ({ offsetSeconds: row.offsetSeconds, score: 100 - index, chatCount: 10 })) }),
    )
    expect(ranking.ranked).toHaveLength(TOP_MOMENTS_PER_BROADCAST)
    expect(ranking.remainder).toHaveLength(6)
    expect(ranking.remainder.map(row => row.offsetSeconds)).toEqual([6_000, 6_300, 6_600, 6_900, 7_200, 7_500])
  })

  it('matches a ranked minute to the nearest loaded detection within tolerance', () => {
    const ranking = rankBroadcastMoments(
      group(moment(1_180), moment(1_260)),
      recap({ topMoments: [{ offsetSeconds: 1_200, score: 70, chatCount: 10 }] }),
    )
    expect(ranking.ranked.map(row => row.moment.offsetSeconds)).toEqual([1_180])
    expect(ranking.remainder.map(row => row.offsetSeconds)).toEqual([1_260])
  })

  it('skips a ranked minute with no loaded detection and keeps ranks dense', () => {
    const ranking = rankBroadcastMoments(
      group(moment(60), moment(1_200)),
      recap({
        topMoments: [
          { offsetSeconds: 1_200, score: 81, chatCount: 10 },
          // Ranked by the server, but this minute was never loaded here.
          { offsetSeconds: 4_000, score: 60, chatCount: 10 },
          { offsetSeconds: 60, score: 44, chatCount: 10 },
        ],
      }),
    )
    expect(ranking.ranked.map(row => [row.moment.offsetSeconds, row.rank])).toEqual([
      [1_200, 1],
      [60, 2],
    ])
  })

  it('never consumes one loaded detection twice', () => {
    const ranking = rankBroadcastMoments(
      group(moment(600)),
      recap({
        topMoments: [
          { offsetSeconds: 600, score: 81, chatCount: 10 },
          { offsetSeconds: 630, score: 70, chatCount: 10 },
        ],
      }),
    )
    expect(ranking.ranked).toHaveLength(1)
    expect(ranking.remainder).toEqual([])
  })

  it('marks the minutes the server also nominated for clipping', () => {
    const ranking = rankBroadcastMoments(
      group(moment(60), moment(600)),
      recap({
        topMoments: [
          { offsetSeconds: 600, score: 81, chatCount: 10 },
          { offsetSeconds: 60, score: 40, chatCount: 10 },
        ],
        clipCandidates: [{ offsetSeconds: 600, score: 81, chatCount: 10 }],
      }),
    )
    expect(ranking.ranked.map(row => [row.moment.offsetSeconds, row.clipCandidate])).toEqual([
      [600, true],
      [60, false],
    ])
  })

  it('falls back to stream order without ranks when no recap is supplied', () => {
    const ranking = rankBroadcastMoments(group(moment(600), moment(60)), null, 1)
    expect(ranking.ordering).toBe('time_fallback')
    expect(ranking.ranked.map(row => [row.moment.offsetSeconds, row.rank])).toEqual([[60, null]])
    expect(ranking.remainder.map(row => row.offsetSeconds)).toEqual([600])
  })

  it('refuses a recap belonging to another broadcast or creator', () => {
    const rows = group(moment(60), moment(600))
    const topMoments = [{ offsetSeconds: 600, score: 81, chatCount: 10 }]
    expect(rankBroadcastMoments(rows, recap({ streamId: '901', topMoments })).ordering).toBe('time_fallback')
    expect(rankBroadcastMoments(rows, recap({ login: 'someone_else', topMoments })).ordering).toBe('time_fallback')
  })

  it('falls back when a matching recap ranks nothing that was loaded', () => {
    const ranking = rankBroadcastMoments(
      group(moment(60)),
      recap({ topMoments: [{ offsetSeconds: 9_000, score: 81, chatCount: 10 }] }),
    )
    expect(ranking.ordering).toBe('time_fallback')
    expect(ranking.ranked.map(row => row.moment.offsetSeconds)).toEqual([60])
  })

  it('treats an empty recap as no ranking at all', () => {
    const ranking = rankBroadcastMoments(group(moment(60)), recap({ topMoments: [], clipCandidates: [] }))
    expect(ranking.ordering).toBe('time_fallback')
  })
})
