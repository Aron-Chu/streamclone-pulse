import { rollupHasMinuteData } from '@streampulse/pulse-charts'
import type { AnalyticsMinuteRollup, AnalyticsStream, AnalyticsStreamDetail, AnalyticsTopEmote } from '../apiTypes.ts'
import { newerChannelStream } from './analyticsStreamRow.ts'
import { rollupOffsetSeconds } from './momentSelection.ts'
import { downsampleTimeline, rollupChartActivityScore } from './timelineDownsample.ts'

/** One `/minutes?afterOffset=` read, or every read since the session read folded together. */
export type MinutesTail = Pick<AnalyticsStreamDetail, 'rollups' | 'topEmotes' | 'updatedAt'>

type MeasuredDetail = Pick<AnalyticsStreamDetail, 'rollups' | 'momentRollups'>

/** Every measured minute, full resolution when loaded (`rollups` may be the chart's downsampled series). */
function measuredMinutes(detail: MeasuredDetail | null | undefined): AnalyticsMinuteRollup[] {
  return detail?.momentRollups?.length ? detail.momentRollups : detail?.rollups ?? []
}

/**
 * (fix, 10-30) Rows keyed by minute (the same key as the offset: both count
 * from the minute's start), a later series replacing an earlier one's row at
 * the same minute, oldest first. The backend re-sends the open minute.
 */
function rowsByMinute(...series: (readonly AnalyticsMinuteRollup[] | undefined)[]): AnalyticsMinuteRollup[] {
  const byMinute = new Map<number, AnalyticsMinuteRollup>()
  for (const rows of series) {
    for (const row of rows ?? []) {
      const at = Date.parse(row.minuteTs)
      if (Number.isFinite(at)) byMinute.set(at, row)
    }
  }
  return Array.from(byMinute.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row)
}

/** Same lookup as the portal's `portalEmoteLookupKey`: provider + lowercased name. */
function emoteLookupKey(provider: string | undefined, name: string): string {
  const lowered = name.trim().toLowerCase()
  return lowered ? `${(provider ?? 'unknown').toLowerCase()}:${lowered}` : ''
}

/**
 * (fix, 10-30) Tail rows key emotes `provider:name:name`; the session's rows
 * and top emotes use `provider:id:name`. Re-key the tail like the portal's
 * `alignRollupEmoteKeys` so a plotted emote's line continues into new minutes.
 */
function alignRowEmoteKeys(row: AnalyticsMinuteRollup, keyByLookup: Map<string, string>): AnalyticsMinuteRollup {
  if (!row.emotes || !keyByLookup.size) return row
  const aligned: Record<string, number> = {}
  let changed = false
  for (const [rowKey, count] of Object.entries(row.emotes)) {
    if (count <= 0) continue
    const parts = rowKey.split(':')
    const name = parts.length >= 3 ? parts.slice(2).join(':') : rowKey
    const targetKey = keyByLookup.get(emoteLookupKey(parts[0], name)) ?? rowKey
    aligned[targetKey] = (aligned[targetKey] ?? 0) + count
    if (targetKey !== rowKey) changed = true
  }
  return changed ? { ...row, emotes: aligned } : row
}

/**
 * (fix, 10-30) The session's top emotes keep the counts the backend sent; the
 * tail's catalog counts only its own minutes, so it no longer replaces them.
 * An emote first seen in the tail is added with its count summed over the
 * merged minutes, the rule the portal's minute catalog uses.
 */
function withTailEmotes(
  sessionEmotes: AnalyticsTopEmote[],
  tailEmotes: readonly AnalyticsTopEmote[],
  minutes: readonly AnalyticsMinuteRollup[],
  keyByLookup: Map<string, string>,
): AnalyticsTopEmote[] {
  const added = new Map<string, AnalyticsTopEmote>()
  for (const emote of tailEmotes) {
    const lookup = emoteLookupKey(emote.provider, emote.name)
    if (!lookup || !emote.key || keyByLookup.has(lookup) || added.has(emote.key)) continue
    let count = 0
    for (const row of minutes) count += row.emotes?.[emote.key] ?? 0
    if (count > 0) added.set(emote.key, { ...emote, count })
  }
  if (!added.size) return sessionEmotes
  return [...sessionEmotes, ...Array.from(added.values()).sort((a, b) => b.count - a.count)]
}

/**
 * Append/replace live-tail rollups without resetting the chart timeline.
 * (fix, 10-30) Merges into every measured minute (`momentRollups`, which the
 * plot end and the tiles read) and rebuilds the chart's `rollups` with the
 * portal's downsample rule; it used to touch `rollups` only, so a live page
 * froze at its first read. `updatedAt` stays the newest read time: the chart's
 * live edge measures through it (see `newestMeasuredMinuteMs` for "Updated").
 */
export function mergeMinutesTailIntoDetail(
  base: AnalyticsStreamDetail,
  tail: MinutesTail | null | undefined,
): AnalyticsStreamDetail {
  if (!tail) return base
  const readAt = Math.max(base.updatedAt || 0, tail.updatedAt || 0)
  if (!tail.rollups?.length) {
    return readAt > (base.updatedAt || 0) ? { ...base, updatedAt: readAt } : base
  }
  const keyByLookup = new Map<string, string>()
  for (const emote of base.topEmotes ?? []) {
    const lookup = emoteLookupKey(emote.provider, emote.name)
    if (lookup && emote.key) keyByLookup.set(lookup, emote.key)
  }
  const minutes = rowsByMinute(
    measuredMinutes(base),
    tail.rollups.map((row) => alignRowEmoteKeys(row, keyByLookup)),
  )
  return {
    ...base,
    rollups: downsampleTimeline(minutes, undefined, rollupChartActivityScore),
    momentRollups: minutes,
    topEmotes: withTailEmotes(base.topEmotes ?? [], tail.topEmotes ?? [], minutes, keyByLookup),
    updatedAt: readAt || base.updatedAt,
  }
}

/**
 * (fix, 10-30) Fold one poll into the tail read since the session read: rows
 * by minute (the newer read of a re-sent minute wins), catalogs joined, the
 * newest read time kept. A poll with no answer keeps what was read.
 */
export function accumulateMinutesTail(
  previous: MinutesTail | null | undefined,
  next: MinutesTail | null | undefined,
): MinutesTail | null {
  if (!next) return previous ?? null
  const catalog = new Map<string, AnalyticsTopEmote>()
  for (const emote of [...(previous?.topEmotes ?? []), ...(next.topEmotes ?? [])]) {
    catalog.set(emote.key || emote.name, emote)
  }
  return {
    rollups: rowsByMinute(previous?.rollups, next.rollups),
    topEmotes: Array.from(catalog.values()),
    updatedAt: Math.max(previous?.updatedAt || 0, next.updatedAt || 0),
  }
}

/**
 * (fix, 10-30) Where the next tail poll starts: the newest minute already
 * merged. The backend answers minutes at or after it, so the open minute comes
 * back with its newer counts. -1 while the session read has no minutes.
 */
export function nextTailAfterOffset(
  base: AnalyticsStreamDetail | null | undefined,
  tail: MinutesTail | null | undefined,
): number {
  const startedAt = base?.stream?.startedAt
  let max = maxRollupOffsetSeconds(base)
  if (max < 0) return max
  for (const row of tail?.rollups ?? []) {
    const offset = rollupOffsetSeconds(row, startedAt)
    if (Number.isFinite(offset) && offset > max) max = offset
  }
  return max
}

/**
 * (fix, 10-30) The start of the newest merged minute with data, which is what
 * the header's "Updated" names on a live session. Null when no minute has data.
 */
export function newestMeasuredMinuteMs(detail: MeasuredDetail | null | undefined): number | null {
  let newest: number | null = null
  for (const row of measuredMinutes(detail)) {
    if (!rollupHasMinuteData(row)) continue
    const at = Date.parse(row.minuteTs)
    if (Number.isFinite(at) && (newest == null || at > newest)) newest = at
  }
  return newest
}

export function maxRollupOffsetSeconds(detail: AnalyticsStreamDetail | undefined | null): number {
  let max = -1
  const startedAt = detail?.stream?.startedAt
  // (fix, 10-30) Every measured minute, not the chart's downsampled series.
  for (const row of measuredMinutes(detail)) {
    const offset = rollupOffsetSeconds(row, startedAt)
    if (Number.isFinite(offset) && offset > max) max = offset
  }
  return max
}

/** Same bound as the open-stream guard: a stream this old is not waiting to start. */
const FIRST_MINUTE_MAX_AGE_MS = 48 * 60 * 60 * 1000

/**
 * (fix, 10-30) CX-3: a session read with no minute yet while its stream is
 * open, so the page reads the session again until the first minute exists (the
 * live tail starts from the newest minute). Open means confirmed live or, with
 * no lifecycle contract (the frozen backend), the backend's own
 * `liveDvrState: 'live'`. Never for an ended stream, one with a newer stream on
 * its channel, or one that started 48 h or more ago. Pass the session query's
 * own data: the status merge drops `liveDvrState`.
 */
export function awaitingFirstMinute(
  detail: AnalyticsStreamDetail | null | undefined,
  channelStreams?: readonly AnalyticsStream[] | null,
  now = Date.now(),
): boolean {
  const stream = detail?.stream
  if (!stream?.streamId || maxRollupOffsetSeconds(detail) >= 0) return false
  if (stream.lifecycleState === 'confirmed_ended' || newerChannelStream(stream, channelStreams)) return false
  const open = stream.lifecycleState === 'confirmed_live' || detail?.availability?.liveDvrState === 'live'
  const startedMs = stream.startedAt ? Date.parse(stream.startedAt) : Number.NaN
  return open && Number.isFinite(startedMs) && now - startedMs < FIRST_MINUTE_MAX_AGE_MS
}
