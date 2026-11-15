import type { CatchMeUpModel } from '../shared/catchMeUpContract.ts'

/**
 * The numbers of Catch me up's summary: plain arithmetic on the recap the
 * panel already has (its rollups and totals). Nothing here ranks or scores.
 */

/** How far the minutes may stop short of the stream's start or end and still stand for all of it. */
const EDGE_SLACK = 300

/**
 * The minute with the most chat messages, when the minutes cover the whole
 * stream; null for minutes that cover only part of it (a recent window, or
 * history still syncing), since the busiest of those is not the stream's, and
 * for a stream without chat.
 */
export function peakMinute(
  rollups: CatchMeUpModel['rollups'],
  durationSeconds: number,
): { offsetSeconds: number; chatCount: number } | null {
  const minutes = rollups.filter(rollup => Number.isFinite(rollup.offsetSeconds))
  const offsets = minutes.map(rollup => rollup.offsetSeconds)
  if (offsets.length === 0 || Math.min(...offsets) > EDGE_SLACK || Math.max(...offsets) + 60 < durationSeconds - EDGE_SLACK) return null
  let peak: { offsetSeconds: number; chatCount: number } | null = null
  for (const minute of minutes) {
    if (minute.chatCount > (peak?.chatCount ?? 0)) peak = { offsetSeconds: minute.offsetSeconds, chatCount: minute.chatCount }
  }
  return peak
}
