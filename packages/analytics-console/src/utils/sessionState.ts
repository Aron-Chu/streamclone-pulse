import type { AnalyticsMinuteRollup, AnalyticsStream, SessionAvailability } from '../apiTypes.ts'

/**
 * The session page's three plain questions, answered one way everywhere:
 * has this stream ended, can a moment play from the VOD, and is there a
 * picture to show.
 *
 * Hosted data today (backend b1098ac) sends no `lifecycleState`, and the portal
 * adapter blanks `endedAt` (the stored end is not trusted), so an ended stream
 * reads only from the availability block (`liveDvrState: "ended"`). Each
 * question takes what the page already has and never guesses past it.
 */

export interface SessionStateInput {
  /** The page's own live answer for this stream (resolveChannelActuallyLive). */
  live: boolean
  stream?: Pick<AnalyticsStream, 'endedAt' | 'lifecycleState'> | null
  availability?: Pick<SessionAvailability, 'liveDvrState'> | null
}

/**
 * The stream has ended: not live now, and something says so — a confirmed
 * end, the availability block's "ended", or a stored end on a row whose
 * lifecycle is not explicitly unknown. A confirmed-live lifecycle never ends.
 */
export function sessionIsEnded({ live, stream, availability }: SessionStateInput): boolean {
  if (live) return false
  const lifecycle = stream?.lifecycleState
  if (lifecycle === 'confirmed_live') return false
  if (lifecycle === 'confirmed_ended') return true
  if (availability?.liveDvrState === 'ended') return true
  return lifecycle !== 'unknown' && Boolean(stream?.endedAt?.trim?.())
}

/** Play only with a VOD and its verified alignment; otherwise no Play at all, never a dead one. */
export function sessionCanPlay(args: { vodId?: string | null; vodAlignSeconds?: number | null }): boolean {
  return Boolean(args.vodId?.trim()) && typeof args.vodAlignSeconds === 'number' && Number.isFinite(args.vodAlignSeconds)
}

/** A preview picture exists only when the frame answer carried one. */
export function sessionHasFrame<T>(frame: T | null | undefined): frame is T {
  return frame != null
}

/** Minutes from the stream's start to the end of its last measured minute; null when nothing was measured. */
export function sessionMeasuredMinutes(
  startedAt: string | null | undefined,
  rollups: readonly Pick<AnalyticsMinuteRollup, 'minuteTs' | 'missing'>[] | null | undefined,
): number | null {
  const start = startedAt ? Date.parse(startedAt) : Number.NaN
  if (!Number.isFinite(start)) return null
  let last = Number.NaN
  for (const rollup of rollups ?? []) {
    if (rollup.missing === true) continue
    const at = Date.parse(rollup.minuteTs)
    if (Number.isFinite(at) && !(at <= last)) last = at
  }
  if (!Number.isFinite(last) || last < start) return null
  return Math.round((last + 60_000 - start) / 60_000)
}

function durationWords(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  return `${Math.round(minutes / 60)}h`
}

/**
 * "Streamed Oct 29 · 4h" for an ended stream: its start date and how long it
 * was measured (the stored end time is not trusted, so the length comes from
 * the last measured minute). Without a length it is just "Streamed Oct 29".
 */
export function sessionStreamedLine(
  startedAt: string | null | undefined,
  rollups: readonly Pick<AnalyticsMinuteRollup, 'minuteTs' | 'missing'>[] | null | undefined,
): string | null {
  const start = startedAt ? new Date(startedAt) : null
  if (!start || !Number.isFinite(start.getTime())) return null
  const date = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const minutes = sessionMeasuredMinutes(startedAt, rollups)
  return minutes != null ? `Streamed ${date} · ${durationWords(minutes)}` : `Streamed ${date}`
}

/** The plain line for a stream with no VOD link yet. */
export const NO_VOD_LINKED_COPY = 'No VOD linked yet.'

/**
 * One plain VOD line wherever a stream has no VOD link: "No VOD linked yet."
 * unless the lookup failed, or Twitch's archive is known gone (deleted,
 * private, unavailable). Nothing on the API says Twitch isn't saving a VOD
 * for a live stream, so the page never claims it.
 */
export function sessionVodLine(state: { status?: string; label?: string; detail?: string } | null | undefined): {
  text: string
  failed: boolean
} {
  if (state?.status === 'request_failed') return { text: 'VOD lookup failed. Try again later.', failed: true }
  if (state?.status === 'unavailable' && state.label === 'VOD unavailable') {
    const said = state.detail?.trim()
    return { text: said && /^Twitch archive/.test(said) ? `${said}.` : 'VOD unavailable.', failed: false }
  }
  return { text: NO_VOD_LINKED_COPY, failed: false }
}
