import type { CatchMeUpModel } from '../shared/catchMeUpContract.ts'
import { formatCount } from '../ui/mostReacted.ts'

/**
 * The words of Catch me up: plain arithmetic on the recap the panel already
 * has (its rollups and totals). Nothing here ranks or scores.
 */

const HALF_HOUR = 1800

/** The stream clock, as Top Moments rows show it: 01:30. */
export function streamClock(offsetSeconds: number): string {
  const s = Math.max(0, Math.floor(offsetSeconds))
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}`
}

/** How far the minutes may stop short of the stream's start or end and still stand for all of it. */
const EDGE_SLACK = 300

/**
 * Where the half hour with the most chat messages starts, in a stream of an
 * hour or more; null for a shorter stream, one without chat, or minutes that
 * cover only part of it (a recent window, or history still syncing), since
 * the busiest of those is not the stream's.
 */
export function busiestHalfHour(
  rollups: CatchMeUpModel['rollups'],
  durationSeconds: number,
): number | null {
  if (!(durationSeconds >= 2 * HALF_HOUR)) return null
  const offsets = rollups.map(rollup => rollup.offsetSeconds).filter(Number.isFinite)
  if (offsets.length === 0 || Math.min(...offsets) > EDGE_SLACK || Math.max(...offsets) + 60 < durationSeconds - EDGE_SLACK) return null
  const minutes = rollups
    .filter(rollup => Number.isFinite(rollup.offsetSeconds) && rollup.chatCount > 0)
    .sort((a, b) => a.offsetSeconds - b.offsetSeconds)
  let best = 0
  let bestStart: number | null = null
  let sum = 0
  let first = 0
  for (const minute of minutes) {
    sum += minute.chatCount
    while (minute.offsetSeconds - minutes[first]!.offsetSeconds >= HALF_HOUR) sum -= minutes[first++]!.chatCount
    if (sum > best) {
      best = sum
      bestStart = minutes[first]!.offsetSeconds
    }
  }
  if (bestStart == null) return null
  // Whole minutes, and a window that ends by the stream's end.
  return Math.max(0, Math.min(Math.floor(bestStart / 60) * 60, Math.floor((durationSeconds - HALF_HOUR) / 60) * 60))
}

/**
 * The block's one fact line: "Busiest half hour 00:06–00:36 · peak 903
 * chat/min · 20 moments". A stream without a busiest half hour starts at its
 * peak; a fact that is missing is left out, never shown as zero.
 */
export function catchMeUpFacts(model: CatchMeUpModel): string | null {
  const start = busiestHalfHour(model.rollups, model.durationSeconds)
  const line = [
    start == null ? '' : `busiest half hour ${streamClock(start)}–${streamClock(start + HALF_HOUR)}`,
    model.peakChatPerMin > 0 ? `peak ${formatCount(model.peakChatPerMin)} chat/min` : '',
    model.momentCount > 0 ? `${formatCount(model.momentCount)} ${model.momentCount === 1 ? 'moment' : 'moments'}` : '',
  ].filter(Boolean).join(' · ')
  return line ? line[0]!.toUpperCase() + line.slice(1) : null
}
