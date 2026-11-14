/**
 * Shared words for a moment, so the site and the extension write the same
 * moment the same way (moments board 11-13: K1 clock, E1 edge tags, Z06
 * strength, Z08 'ago' and saved dates).
 */

import type { StreamEdgeKind } from './streamEdges.ts'

/** Time into the stream as h:mm:ss, like the Twitch player: 0:45:00, 1:30:00. */
export function formatMomentOffset(totalSeconds: number): string {
  const s = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
  const h = Math.floor(s / 3600)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

/** The quiet tag for a moment in a stream's opening or closing minutes. */
export function streamEdgeLabel(kind: StreamEdgeKind): 'Stream start' | 'Stream end' {
  return kind === 'opening' ? 'Stream start' : 'Stream end'
}

/** A strength figure: 6.2 under 10, a whole number from 10 up (9.96 reads 10). */
export function formatLiftRatio(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return '0'
  return Math.round(ratio * 10) >= 100 ? String(Math.round(ratio)) : ratio.toFixed(1)
}

/** One wording for strength everywhere: '6.2× more emotes', '12× more chat'. */
export function formatLiftWords(ratio: number, series: 'chat' | 'emotes'): string {
  return `${formatLiftRatio(ratio)}× more ${series}`
}

// Formatters are built on first use, so a bundle that never calls them pays nothing at load.
let clock: Intl.DateTimeFormat | undefined
let dated: Intl.DateTimeFormat | undefined
let saved: Intl.DateTimeFormat | undefined

const clockTime = (at: number) =>
  (clock ??= new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })).format(at)

const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0)

/**
 * When something happened, floored to the minute (the Hub's rule): 'just now',
 * '13 min ago', then the clock time today, 'Yesterday 1:05 PM', or the date
 * and time further back ('Nov 10, 1:05 PM').
 */
export function formatAgo(at: number, now: number): string {
  const m = Math.max(0, Math.floor((now - at) / 60_000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const days = Math.round((dayStart(now) - dayStart(at)) / 86_400_000)
  if (days < 1) return clockTime(at)
  if (days < 2) return `Yesterday ${clockTime(at)}`
  return (dated ??= new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })).format(at)
}

/** When a moment was saved or watched: 'Nov 13, 2026, 12:37 AM', no seconds. */
export function formatSavedAt(at: number | string | Date): string {
  const t = at instanceof Date ? at.getTime() : typeof at === 'number' ? at : Date.parse(at)
  return Number.isFinite(t) ? (saved ??= new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })).format(t) : ''
}
