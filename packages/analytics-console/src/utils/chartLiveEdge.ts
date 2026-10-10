import { chartViewerValue, rollupHasMinuteData } from '@streampulse/pulse-charts'
import type { AnalyticsMinuteRollup, AnalyticsStreamDetail } from '../api.ts'

const MINUTE_MS = 60_000
/** A live chart whose newest measured minute is older than this says so instead of "updating". */
export const LIVE_EDGE_STALE_SECONDS = 3 * 60

function minuteStartMs(rollup: { minuteTs: string }): number {
  return Date.parse(rollup.minuteTs)
}

/**
 * How the plot treats its right end. `live`: the client confirmed the stream
 * is live. `unconfirmed`: the API still reports the stream open (state or live
 * DVR "live") but its lifecycle is not confirmed, which is what the page shows
 * as "Live status unconfirmed" (for example when collection stopped while the
 * stream went on). Both are open streams: the newest minute may be partial and
 * the edge gets a marker. Null for an ended or historical stream.
 */
export type LiveEdgeMode = 'live' | 'unconfirmed'

export function resolveLiveEdgeMode(
  detail: Pick<AnalyticsStreamDetail, 'state' | 'stream' | 'availability'> | null | undefined,
  isLive: boolean,
): LiveEdgeMode | null {
  if (isLive) return 'live'
  if (!detail) return null
  if (detail.stream?.lifecycleState === 'confirmed_ended') return null
  if (detail.stream?.endedAt) return null
  const state = String(detail.state ?? '').toLowerCase()
  const liveDvr = String(detail.availability?.liveDvrState ?? '').toLowerCase()
  return state === 'live' || liveDvr === 'live' ? 'unconfirmed' : null
}

/**
 * Whether a live minute is still being measured: the read that returned it
 * was taken before the minute ended, so its chat and emote counts are partial
 * and its viewer sample may not have arrived yet.
 */
export function isUnfinishedLiveMinute(
  rollup: { minuteTs: string },
  measuredThroughMs: number | null | undefined,
): boolean {
  if (measuredThroughMs == null || !Number.isFinite(measuredThroughMs) || measuredThroughMs <= 0) return false
  const start = minuteStartMs(rollup)
  return Number.isFinite(start) && start + MINUTE_MS > measuredThroughMs
}

/** Why the newest minute with data is left off an open stream's plot. */
export type LeftOffMinuteReason = 'updating' | 'partial'

/**
 * Whether the newest minute with data is left off an open stream's plot, and
 * why. `updating`: the read was taken before the minute ended. `partial`: it
 * has chat or emotes but no viewer sample while the minute before it has one,
 * which is the minute collection stopped in (the read may be much later, e.g.
 * while the page says "Live status unconfirmed"). Either way its counts are
 * partial and plotting it would leave the viewer line a minute short of the
 * right edge. Null when the minute is plotted.
 */
export function leftOffMinuteReason(
  newest: AnalyticsMinuteRollup,
  previous: AnalyticsMinuteRollup | null,
  measuredThroughMs: number | null | undefined,
): LeftOffMinuteReason | null {
  if (isUnfinishedLiveMinute(newest, measuredThroughMs)) return 'updating'
  if (previous && chartViewerValue(newest) == null && chartViewerValue(previous) != null) return 'partial'
  return null
}

/**
 * The minute the session plot ends on: the newest minute with data. On an
 * open stream (`open`), when that minute is partial (still being measured, or
 * the minute collection stopped in: a short chat bar and no viewer sample) the
 * plot ends one minute earlier instead, so the newest values reach the right
 * edge together. Only that one minute is ever left off, whatever the read's
 * timestamp says. Null when no minute has data.
 */
export function newestPlottedMinute<T extends AnalyticsMinuteRollup>(
  minutes: readonly T[],
  measuredThroughMs: number | null | undefined,
  open = measuredThroughMs != null,
): T | null {
  const { plotted } = plotEndMinutes(minutes, measuredThroughMs, open)
  return plotted
}

/**
 * The newest minute with data, the minute the plot ends on, and why the two
 * differ (when they do). See `newestPlottedMinute`.
 */
export function plotEndMinutes<T extends AnalyticsMinuteRollup>(
  minutes: readonly T[],
  measuredThroughMs: number | null | undefined,
  open: boolean,
): { newest: T | null; plotted: T | null; leftOff: LeftOffMinuteReason | null } {
  let newest: T | null = null
  for (let index = minutes.length - 1; index >= 0; index -= 1) {
    const minute = minutes[index]!
    if (!rollupHasMinuteData(minute) || !Number.isFinite(minuteStartMs(minute))) continue
    if (newest == null) {
      newest = minute
      if (!open) return { newest, plotted: newest, leftOff: null }
      continue
    }
    // The previous minute with data; keep the newest when it is the only one.
    const leftOff = leftOffMinuteReason(newest, minute, measuredThroughMs)
    return leftOff ? { newest, plotted: minute, leftOff } : { newest, plotted: newest, leftOff: null }
  }
  return { newest, plotted: newest, leftOff: null }
}

/** Minutes up to and including the plot's last minute (trailing empty or unfinished minutes dropped). */
export function rollupsThroughMinute<T extends { minuteTs: string }>(
  minutes: readonly T[],
  lastMinute: { minuteTs: string } | null,
): T[] {
  if (!lastMinute) return [...minutes]
  const endMs = minuteStartMs(lastMinute)
  if (!Number.isFinite(endMs)) return [...minutes]
  return minutes.filter((minute) => {
    const at = minuteStartMs(minute)
    return !Number.isFinite(at) || at <= endMs
  })
}

/**
 * Text for the live-edge marker at the plot's right end. "Updating" while the
 * newest plotted minute is recent; otherwise it names the last measured time,
 * so a collection gap at the live edge is not dressed up as fresh data. When
 * the stream is open but its live status is unconfirmed the marker leads with
 * "Unconfirmed" instead of "Live", matching the page header, and always names
 * the last measured time: nothing confirms more data is coming.
 */
export function liveEdgeLabel(args: {
  lastMinute: { minuteTs: string } | null
  measuredThroughMs: number | null | undefined
  streamStartedAt: string | undefined
  formatOffset: (seconds: number) => string
  mode?: LiveEdgeMode
}): string {
  const { lastMinute, measuredThroughMs, streamStartedAt, formatOffset } = args
  const lead = args.mode === 'unconfirmed' ? 'Unconfirmed' : 'Live'
  const lastMs = lastMinute ? minuteStartMs(lastMinute) : Number.NaN
  const startMs = streamStartedAt ? Date.parse(streamStartedAt) : Number.NaN
  if (
    args.mode !== 'unconfirmed'
    && (measuredThroughMs == null
    || !Number.isFinite(measuredThroughMs)
    || !Number.isFinite(lastMs)
    || (measuredThroughMs - (lastMs + MINUTE_MS)) / 1000 <= LIVE_EDGE_STALE_SECONDS)
  ) {
    return `${lead} · updating`
  }
  return Number.isFinite(startMs)
    ? `${lead} · last data ${formatOffset(Math.max(0, Math.round((lastMs + MINUTE_MS - startMs) / 1000)))}`
    : `${lead} · last data earlier`
}
