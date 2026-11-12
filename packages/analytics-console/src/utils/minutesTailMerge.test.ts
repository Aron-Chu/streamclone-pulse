import { describe, expect, it } from 'vitest'
import {
  accumulateMinutesTail,
  awaitingFirstMinute,
  maxRollupOffsetSeconds,
  mergeMinutesTailIntoDetail,
  newestMeasuredMinuteMs,
  nextTailAfterOffset,
} from './minutesTailMerge.ts'
import { downsampleTimeline, rollupChartActivityScore } from './timelineDownsample.ts'
import { plotEndMinutes } from './chartLiveEdge.ts'
import { computeRollupChatStats, computeRollupViewerStats } from '../components/analytics/chartRollupUtils.ts'
import type { AnalyticsMinuteRollup, AnalyticsStream, AnalyticsStreamDetail } from '../apiTypes.ts'

const startedAt = '2026-07-26T15:00:00.000Z'

const base: AnalyticsStreamDetail = {
  channel: 'nmplol',
  state: 'live',
  stream: {
    streamId: '319549121886',
    login: 'nmplol',
    startedAt,
  },
  rollups: [
    { minuteTs: '2026-07-26T15:05:00.000Z', chatCount: 1 },
    { minuteTs: '2026-07-26T15:06:00.000Z', chatCount: 2 },
  ],
  topEmotes: [{ name: 'Kappa', key: 'twitch:1:Kappa', count: 1 }],
  sources: [],
  updatedAt: 1,
}

describe('mergeMinutesTailIntoDetail', () => {
  it('replaces the open minute and appends newer offsets', () => {
    const merged = mergeMinutesTailIntoDetail(base, {
      rollups: [
        { minuteTs: '2026-07-26T15:06:00.000Z', chatCount: 9 },
        { minuteTs: '2026-07-26T15:07:00.000Z', chatCount: 3, emotes: { 'seventv:2:Pog': 4 } },
      ],
      topEmotes: [{ name: 'Pog', key: 'seventv:2:Pog', count: 4 }],
      updatedAt: 2,
    })
    expect(merged.rollups?.map((r) => [r.minuteTs, r.chatCount])).toEqual([
      ['2026-07-26T15:05:00.000Z', 1],
      ['2026-07-26T15:06:00.000Z', 9],
      ['2026-07-26T15:07:00.000Z', 3],
    ])
    expect(merged.topEmotes?.some((e) => e.key === 'seventv:2:Pog')).toBe(true)
    expect(merged.updatedAt).toBe(2)
  })

  it('maxRollupOffsetSeconds reads the live edge', () => {
    expect(maxRollupOffsetSeconds(base)).toBe(360)
    expect(maxRollupOffsetSeconds(undefined)).toBe(-1)
  })
})

// Stream 316655688306 on 10-30 (live-minutes evidence, trimmed): each minute is
// mapped the way portalMinutesToRollups maps it (minuteTs = startedAt + offset,
// tail emote keys provider:name:name, session keys provider:id:name).
const liveStartedAt = '2026-10-30T04:20:06.000Z'
const yappingDuckKey = 'twitch:emotesv2_bea88a2caa044e409c1b32ee0850b825:YappingDuck'
function liveMinute(offsetSeconds: number, fields: Partial<AnalyticsMinuteRollup> = {}): AnalyticsMinuteRollup {
  return { minuteTs: new Date(Date.parse(liveStartedAt) + offsetSeconds * 1000).toISOString(), ...fields }
}
// The tiles and the plot read every measured minute, as the console does.
function measured(detail: AnalyticsStreamDetail): AnalyticsMinuteRollup[] {
  return detail.momentRollups?.length ? detail.momentRollups : detail.rollups ?? []
}
const readAt = (iso: string) => Date.parse(iso)

// The session read at 07:17:13: 07:17 (offset 10614) is the open minute.
const liveBaseMinutes = [
  liveMinute(10494, { viewerAvg: 10682, viewerLatest: 10682, viewerSamples: 2, chatCount: 585, totalEmoteCount: 53, emotes: { [yappingDuckKey]: 28 } }),
  liveMinute(10554, { viewerAvg: 10682, viewerLatest: 10682, viewerSamples: 1, chatCount: 314, totalEmoteCount: 30, emotes: { [yappingDuckKey]: 19 } }),
  liveMinute(10614, { viewerAvg: 0, viewerSamples: 0, chatCount: 45 }),
]
const liveBase: AnalyticsStreamDetail = {
  channel: 'jasontheween',
  state: 'live',
  stream: { streamId: '316655688306', login: 'jasontheween', startedAt: liveStartedAt, lifecycleState: 'confirmed_live' },
  rollups: liveBaseMinutes,
  momentRollups: liveBaseMinutes,
  topEmotes: [{ key: yappingDuckKey, name: 'YappingDuck', provider: 'twitch', count: 47 }],
  sources: [],
  updatedAt: readAt('2026-10-30T07:17:13.000Z'),
}
// Poll 1 at 07:18:13: 07:17 closes, 07:18 opens.
const tailOne = {
  rollups: [
    liveMinute(10614, { viewerAvg: 10682, viewerLatest: 10682, viewerSamples: 1, chatCount: 698, totalEmoteCount: 2, emotes: { 'twitch:BigSad:BigSad': 1 } }),
    liveMinute(10674, { viewerAvg: 0, viewerSamples: 0, chatCount: 45 }),
  ],
  topEmotes: [{ key: 'twitch:BigSad:BigSad', name: 'BigSad', provider: 'twitch', count: 1 }],
  updatedAt: readAt('2026-10-30T07:18:13.000Z'),
}
// Poll 2 at 07:19:13: 07:18 closes, 07:19 opens.
const tailTwo = {
  rollups: [
    liveMinute(10674, { viewerAvg: 10682, viewerLatest: 10682, viewerSamples: 2, chatCount: 590, totalEmoteCount: 10, emotes: { 'twitch:NotLikeThis:NotLikeThis': 1, 'twitch:BigSad:BigSad': 4, 'twitch:YappingDuck:YappingDuck': 2 } }),
    liveMinute(10734, { viewerAvg: 0, viewerSamples: 0, chatCount: 45 }),
  ],
  topEmotes: [
    { key: 'twitch:NotLikeThis:NotLikeThis', name: 'NotLikeThis', provider: 'twitch', count: 1 },
    { key: 'twitch:BigSad:BigSad', name: 'BigSad', provider: 'twitch', count: 4 },
    { key: 'twitch:YappingDuck:YappingDuck', name: 'YappingDuck', provider: 'twitch', count: 2 },
  ],
  updatedAt: readAt('2026-10-30T07:19:13.000Z'),
}

describe('mergeMinutesTailIntoDetail on a live session (VOD-1)', () => {
  // (fix, 10-30) The live page froze: tail minutes went into the chart's
  // downsampled `rollups` only, while the plot end and the tiles read
  // `momentRollups`, so neither moved after the first read.
  it('two successive tails advance the plotted end and the tile values', () => {
    const first = mergeMinutesTailIntoDetail(liveBase, tailOne)
    const second = mergeMinutesTailIntoDetail(liveBase, {
      ...tailTwo,
      rollups: [...tailOne.rollups, ...tailTwo.rollups],
    })

    const plotted = (detail: AnalyticsStreamDetail) =>
      plotEndMinutes(measured(detail), detail.updatedAt, true).plotted?.minuteTs
    expect(plotted(liveBase)).toBe(liveMinute(10554).minuteTs)
    expect(plotted(first)).toBe(liveMinute(10614).minuteTs)
    expect(plotted(second)).toBe(liveMinute(10674).minuteTs)

    expect(computeRollupChatStats(measured(liveBase)).chat).toBe(585 + 314 + 45)
    expect(computeRollupChatStats(measured(first)).chat).toBe(585 + 314 + 698 + 45)
    expect(computeRollupChatStats(measured(second)).chat).toBe(585 + 314 + 698 + 590 + 45)
    expect(computeRollupViewerStats(measured(second))?.avg).toBe(10682)
    expect(measured(second).map((row) => row.minuteTs)).toEqual(
      [10494, 10554, 10614, 10674, 10734].map((offset) => liveMinute(offset).minuteTs),
    )
  })

  // (fix, 10-30) Each poll must ask after the newest minute already merged, not
  // after the session read's edge: the same afterOffset re-downloaded a growing
  // tail every 30 s (capped at 120 minutes by the backend).
  it('carries the merged edge forward so the next poll asks after the newest merged minute', () => {
    expect(nextTailAfterOffset(liveBase, null)).toBe(10614)
    const afterOne = accumulateMinutesTail(null, tailOne)
    expect(nextTailAfterOffset(liveBase, afterOne)).toBe(10674)
    const afterTwo = accumulateMinutesTail(afterOne, tailTwo)
    expect(nextTailAfterOffset(liveBase, afterTwo)).toBe(10734)
    expect(afterTwo?.rollups?.map((row) => row.minuteTs)).toEqual(
      [10614, 10674, 10734].map((offset) => liveMinute(offset).minuteTs),
    )
    // The re-sent open minute is replaced by its newer read, not counted twice.
    expect(afterTwo?.rollups?.find((row) => row.minuteTs === liveMinute(10674).minuteTs)?.chatCount).toBe(590)
    expect(afterTwo?.updatedAt).toBe(tailTwo.updatedAt)
    const merged = mergeMinutesTailIntoDetail(liveBase, afterTwo)
    expect(computeRollupChatStats(measured(merged)).chat).toBe(585 + 314 + 698 + 590 + 45)
  })

  it('keeps the accumulated tail when a poll answers with no minutes', () => {
    const afterOne = accumulateMinutesTail(null, tailOne)
    const empty = accumulateMinutesTail(afterOne, { rollups: [], topEmotes: [], updatedAt: readAt('2026-10-30T07:19:13.000Z') })
    expect(empty?.rollups).toEqual(afterOne?.rollups)
    expect(empty?.updatedAt).toBe(readAt('2026-10-30T07:19:13.000Z'))
    expect(accumulateMinutesTail(afterOne, null)).toBe(afterOne)
    expect(accumulateMinutesTail(null, null)).toBeNull()
  })

  // (fix, 10-30) "Updated" names the newest merged minute; the read time stays
  // on `updatedAt` because the chart's live edge measures through it.
  it('names the newest merged minute separately from the read time', () => {
    const merged = mergeMinutesTailIntoDetail(liveBase, accumulateMinutesTail(accumulateMinutesTail(null, tailOne), tailTwo))
    expect(newestMeasuredMinuteMs(merged)).toBe(Date.parse(liveMinute(10734).minuteTs))
    expect(merged.updatedAt).toBe(tailTwo.updatedAt)
    expect(newestMeasuredMinuteMs(liveBase)).toBe(Date.parse(liveMinute(10614).minuteTs))
    // A trailing minute with no data is not a measurement.
    expect(newestMeasuredMinuteMs({ ...liveBase, momentRollups: [...liveBaseMinutes, liveMinute(10674, { missing: true })] }))
      .toBe(Date.parse(liveMinute(10614).minuteTs))
    expect(newestMeasuredMinuteMs(undefined)).toBeNull()
  })

  // (fix, 10-30) The tail's catalog counts only its own minutes. Replacing the
  // session counts with them shrank every emote to its last-poll count.
  it('keeps session emote counts and keys; a new emote counts its measured minutes', () => {
    const merged = mergeMinutesTailIntoDetail(liveBase, accumulateMinutesTail(accumulateMinutesTail(null, tailOne), tailTwo))
    expect(merged.topEmotes?.find((emote) => emote.name === 'YappingDuck')).toEqual(liveBase.topEmotes?.[0])
    expect(merged.topEmotes?.filter((emote) => emote.name === 'YappingDuck')).toHaveLength(1)
    expect(merged.topEmotes?.find((emote) => emote.name === 'BigSad')?.count).toBe(1 + 4)
    expect(merged.topEmotes?.find((emote) => emote.name === 'NotLikeThis')?.count).toBe(1)
    // Tail rows use the session's key, so a plotted emote line continues.
    expect(measured(merged).find((row) => row.minuteTs === liveMinute(10674).minuteTs)?.emotes).toEqual({
      'twitch:NotLikeThis:NotLikeThis': 1,
      'twitch:BigSad:BigSad': 4,
      [yappingDuckKey]: 2,
    })
  })

  it('downsamples the chart series past 240 minutes with the portal rule', () => {
    const longMinutes = Array.from({ length: 240 }, (_, index) =>
      liveMinute(114 + index * 60, { viewerAvg: 9000, viewerSamples: 1, chatCount: index % 7 }))
    const longBase: AnalyticsStreamDetail = { ...liveBase, rollups: longMinutes, momentRollups: longMinutes }
    const edge = 114 + 239 * 60
    const merged = mergeMinutesTailIntoDetail(longBase, {
      rollups: [liveMinute(edge + 60, { viewerAvg: 9000, viewerSamples: 1, chatCount: 3 }), liveMinute(edge + 120, { chatCount: 1 })],
      topEmotes: [],
      updatedAt: Date.parse(liveMinute(edge + 120).minuteTs) + 13_000,
    })
    expect(merged.momentRollups).toHaveLength(242)
    expect(merged.rollups).toEqual(downsampleTimeline(merged.momentRollups ?? [], 240, rollupChartActivityScore))
    // One quiet minute in the middle (06:21) is dropped.
    expect(merged.rollups).toHaveLength(241)
    expect(merged.rollups?.map((row) => row.minuteTs)).not.toContain(liveMinute(7254).minuteTs)
    expect(merged.rollups?.[0]).toBe(merged.momentRollups?.[0])
    expect(merged.rollups?.at(-1)).toBe(merged.momentRollups?.at(-1))
  })
})

// (fix, 10-30) CX-3: a live session read before its first minute is read
// again until one exists; the live tail needs a minute to start from.
describe('awaitingFirstMinute', () => {
  const now = Date.parse('2026-10-30T08:00:00.000Z')
  const startedAt = '2026-10-30T07:58:00.000Z'
  // The hosted shape against the frozen backend: no lifecycle contract, so
  // with no minute the lifecycle is 'unknown'; the backend says the stream is live.
  const hostedEmpty: AnalyticsStreamDetail = {
    channel: 'xqc',
    state: 'unknown',
    stream: { streamId: '202', login: 'xqc', startedAt, lifecycleState: 'unknown' },
    rollups: [],
    topEmotes: [],
    sources: [],
    updatedAt: now,
    availability: { liveDvrState: 'live', vodState: 'pending_live' },
  }
  const contractEmpty: AnalyticsStreamDetail = {
    ...hostedEmpty,
    state: 'live',
    stream: { ...hostedEmpty.stream!, lifecycleState: 'confirmed_live' },
    availability: undefined,
  }
  const newerStream: AnalyticsStream = { streamId: '303', login: 'xqc', title: 'Newer broadcast', startedAt: '2026-10-30T07:59:00.000Z', viewerSamples: 1 }

  it('waits while an open stream has no minute', () => {
    expect(awaitingFirstMinute(hostedEmpty, [], now)).toBe(true)
    expect(awaitingFirstMinute(contractEmpty, undefined, now)).toBe(true)
  })

  it('stops once a minute exists', () => {
    const minute = { minuteTs: startedAt, viewerAvg: 900, viewerSamples: 1, chatCount: 10 }
    expect(awaitingFirstMinute({ ...hostedEmpty, rollups: [minute] }, [], now)).toBe(false)
    expect(awaitingFirstMinute({ ...contractEmpty, rollups: [], momentRollups: [minute] }, [], now)).toBe(false)
  })

  it('does not wait on an ended, superseded, unopened or old stream', () => {
    expect(awaitingFirstMinute({ ...contractEmpty, stream: { ...contractEmpty.stream!, lifecycleState: 'confirmed_ended' } }, [], now)).toBe(false)
    // An ended stream that the backend still lists as live is ended.
    expect(awaitingFirstMinute({ ...hostedEmpty, stream: { ...hostedEmpty.stream!, lifecycleState: 'confirmed_ended' } }, [], now)).toBe(false)
    expect(awaitingFirstMinute(hostedEmpty, [newerStream], now)).toBe(false)
    expect(awaitingFirstMinute(contractEmpty, [newerStream], now)).toBe(false)
    // Neither confirmed live nor called live by the backend.
    expect(awaitingFirstMinute({ ...hostedEmpty, availability: { liveDvrState: 'ended' } }, [], now)).toBe(false)
    expect(awaitingFirstMinute({ ...hostedEmpty, availability: undefined }, [], now)).toBe(false)
    // 48 h or more since it started.
    const longAgo = new Date(now - 48 * 60 * 60 * 1000).toISOString()
    expect(awaitingFirstMinute({ ...hostedEmpty, stream: { ...hostedEmpty.stream!, startedAt: longAgo } }, [], now)).toBe(false)
    expect(awaitingFirstMinute({ ...hostedEmpty, stream: { ...hostedEmpty.stream!, startedAt: '' } }, [], now)).toBe(false)
  })

  it('does not wait without a session read', () => {
    expect(awaitingFirstMinute(null, [], now)).toBe(false)
    expect(awaitingFirstMinute(undefined, [], now)).toBe(false)
    expect(awaitingFirstMinute({ ...hostedEmpty, stream: undefined }, [], now)).toBe(false)
  })
})
