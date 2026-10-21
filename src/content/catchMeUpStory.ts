import type { CatchMeUpModel } from '../shared/catchMeUpContract.ts'

/**
 * The numbers of Catch me up's summary: plain arithmetic on the recap the
 * panel already has (its rollups and totals). Nothing here ranks or scores.
 */

/** A length or offset as a clock that cannot read as a time of day: 2:34, or 2:34:05 with seconds. */
export function summaryClock(offsetSeconds: number, withSeconds = false): string {
  const s = Math.max(0, Math.floor(offsetSeconds))
  const pad = (n: number) => n.toString().padStart(2, '0')
  const clock = `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}`
  return withSeconds ? `${clock}:${pad(s % 60)}` : clock
}

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
