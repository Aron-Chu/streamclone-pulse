import { rollupHasMinuteData } from '@streampulse/pulse-charts'
import type { AnalyticsMinuteRollup } from '../api.ts'

const MINUTE_MS = 60_000
/** A live chart whose newest measured minute is older than this says so instead of "updating". */
export const LIVE_EDGE_STALE_SECONDS = 3 * 60

function minuteStartMs(rollup: { minuteTs: string }): number {
  return Date.parse(rollup.minuteTs)
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

/**
 * The minute the session plot ends on: the newest minute with data. On a live
 * stream, when that minute is still being measured (a short chat bar, no
 * viewer sample yet) the plot ends one minute earlier instead, so the newest
 * values reach the right edge together. Only that one minute is ever left off,
 * whatever the read's timestamp says. Null when no minute has data.
 */
export function newestPlottedMinute<T extends AnalyticsMinuteRollup>(
  minutes: readonly T[],
  measuredThroughMs: number | null | undefined,
): T | null {
  let newest: T | null = null
  for (let index = minutes.length - 1; index >= 0; index -= 1) {
    const minute = minutes[index]!
    if (!rollupHasMinuteData(minute) || !Number.isFinite(minuteStartMs(minute))) continue
    if (newest == null) {
      newest = minute
      if (!isUnfinishedLiveMinute(minute, measuredThroughMs)) return minute
      continue
    }
    // The previous minute with data; keep the newest when it is the only one.
    return minute
  }
  return newest
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
 * so a collection gap at the live edge is not dressed up as fresh data.
 */
export function liveEdgeLabel(args: {
  lastMinute: { minuteTs: string } | null
  measuredThroughMs: number | null | undefined
  streamStartedAt: string | undefined
  formatOffset: (seconds: number) => string
}): string {
  const { lastMinute, measuredThroughMs, streamStartedAt, formatOffset } = args
  const lastMs = lastMinute ? minuteStartMs(lastMinute) : Number.NaN
  const startMs = streamStartedAt ? Date.parse(streamStartedAt) : Number.NaN
  if (
    measuredThroughMs == null
    || !Number.isFinite(measuredThroughMs)
    || !Number.isFinite(lastMs)
    || (measuredThroughMs - (lastMs + MINUTE_MS)) / 1000 <= LIVE_EDGE_STALE_SECONDS
  ) {
    return 'Live · updating'
  }
  return Number.isFinite(startMs)
    ? `Live · last data ${formatOffset(Math.max(0, Math.round((lastMs + MINUTE_MS - startMs) / 1000)))}`
    : 'Live · last data earlier'
}
