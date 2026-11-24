import { momentAtKey, momentPagePath, parseMomentAtKey, type MomentAtKey } from './momentFeedback'
import { isMomentStreamId, loadMomentRecap, loadMomentStream } from './momentReads'

const LOGIN = /^[a-z0-9_]{1,25}$/

/**
 * Build-time switch for the Moment watch page, /analytics/moments/<stream>/<minute>
 * (VITE_PUBLIC_MOMENT_PAGE). Off unless the build sets it to `on` (or `1`).
 * On, the route, the page and the links into it exist, and the page reads only
 * public data. Ratings, comments and the sign-in return to the page wait on the
 * second switch, VITE_PUBLIC_MOMENT_FEEDBACK (momentFeedbackEnabled below).
 */
export function momentPageEnabled(): boolean {
  const value = import.meta.env.VITE_PUBLIC_MOMENT_PAGE
  return value === 'on' || value === '1'
}

/**
 * Build-time switch for a Moment's ratings and comments
 * (VITE_PUBLIC_MOMENT_FEEDBACK). Off unless the build sets it to `on` (or `1`).
 * Off, the Moment page never reads or writes /v1/account/streams/..., and shows
 * no rating row, no comments and no pick on the strip. On, the page reads and
 * writes those routes, which answer 404 until the backend's
 * PULSE_MOMENT_FEEDBACK_ENABLED is on and the edge relays them. It matters
 * only in a build where the page itself is on.
 */
export function momentFeedbackEnabled(): boolean {
  const value = import.meta.env.VITE_PUBLIC_MOMENT_FEEDBACK
  return value === 'on' || value === '1'
}

/**
 * A Moment's own page as a place a sign-in may come back to, or null. Exactly
 * /analytics/moments/<stream id>/<YYYYMMDDTHHmmZ>, and only in a build that has
 * the page and its ratings and comments (signing in is for those): no query, no
 * fragment, nothing encoded.
 */
export function momentPageReturnPath(value: unknown): string | null {
  if (!momentPageEnabled() || !momentFeedbackEnabled() || typeof value !== 'string') return null
  const match = /^\/analytics\/moments\/([^/]+)\/(\d{8}T\d{4}Z)$/.exec(value)
  // The minute must be a real UTC minute, not only shaped like one.
  return match && isMomentStreamId(match[1]) && parseMomentAtKey(match[2]!) !== null ? value : null
}

/**
 * The minute key for a Moment's absolute time `at` (ms). A Moment's `at` is the stream's start plus
 * whole seconds (startedAt + trunc(minute − startedAt)), so a stream that started on a fractional
 * second puts it just before its own minute. Rounding up to the whole second first lands it back on
 * that minute: the same key as momentAtKey(momentMinuteAt(startedAt, offset)). A whole-minute time
 * (a chart's minute, a feed item's minuteStart) keeps its key.
 */
export function momentEntryKey(at: number): MomentAtKey {
  return momentAtKey(Math.ceil(at / 1000) * 1000)
}

/**
 * The link to the Moment's own page for the minute of `at` (an absolute time in ms, see
 * momentEntryKey), or null when the build has no Moment page or the stream id or time is not usable.
 * Every link into the page names its minute this way, from an absolute time and never from an
 * offset. On null a caller keeps the link it has today.
 */
export function momentPageHref({ streamId, at }: { streamId: string; at: number | null | undefined }): string | null {
  if (!momentPageEnabled() || !isMomentStreamId(streamId) || typeof at !== 'number' || !Number.isFinite(at)) return null
  return momentPagePath(streamId, momentEntryKey(at))
}

/**
 * Starts what the Moment's page for `at` needs before it opens: its code and, unless `reads` is false,
 * its two reads (the stream and the recap, shared and kept by momentReads, so asking again reads nothing
 * new). A link calls it when it is pressed (focus loads only the code), and the page's route as it
 * opens, so the reads run beside the code instead of after it. Nothing happens in a build without the
 * page, or for a link momentPageHref would not build. A failed read is kept a few seconds, so the page
 * opening right after shows that failure without asking again; its Try again asks again.
 */
export function warmMomentPage({ streamId, at }: { streamId: string; at: number | null | undefined }, { reads = true } = {}): void {
  // Read inline, as the route does, so a build without the page folds this away with the page's code.
  const flag = import.meta.env.VITE_PUBLIC_MOMENT_PAGE
  if ((flag !== 'on' && flag !== '1') || momentPageHref({ streamId, at }) === null) return
  if (reads) {
    loadMomentStream(streamId).catch(() => {})
    loadMomentRecap(streamId).catch(() => {})
  }
  import('../routes/analytics/MomentWatchPage').catch(() => {})
}

/**
 * A link into a Moment's page: a press (mouse, pen or touch) warms the page and its reads; focus, as
 * when tabbing through a list, loads only the page's code (warmMomentPage).
 */
export function momentPageWarmth(target: { streamId: string; at: number | null | undefined }) {
  return { onPointerDown: () => warmMomentPage(target), onFocus: () => warmMomentPage(target, { reads: false }) }
}

/** Where a link into a Moment's page came from: the page's Back steps back to it. */
export type MomentPageFrom = 'moments' | 'moment' | 'stream' | 'hub'

/**
 * What a link hands the Moment's page so its head paints before the stream read: the channel and the
 * minute's offset. The page uses it only when it names the address's stream and minute.
 */
export interface HandedMoment {
  streamId: string
  momentAt: MomentAtKey
  offsetSeconds: number
  login: string
  displayName?: string
  category?: string
  profileImageUrl?: string
}

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max ? value : undefined

/** The moment as a link hands it over, for the minute of `at` (see momentEntryKey); undefined when it can't name one. */
export function handOverMoment(moment: { streamId: string; offsetSeconds: number; login: string; displayName?: string; category?: string; profileImageUrl?: string },
  at: number | null | undefined): HandedMoment | undefined {
  if (typeof at !== 'number' || !Number.isFinite(at)) return undefined
  return { streamId: moment.streamId, momentAt: momentEntryKey(at), offsetSeconds: moment.offsetSeconds, login: moment.login,
    displayName: text(moment.displayName, 100), category: text(moment.category, 200), profileImageUrl: text(moment.profileImageUrl, 500) }
}

/** The moment a link handed over, when it names this stream and minute; else null. */
export function handedMoment(state: unknown, streamId: string, momentAt: string): HandedMoment | null {
  const moment = state && typeof state === 'object' ? (state as { moment?: unknown }).moment : undefined
  if (!moment || typeof moment !== 'object') return null
  const handed = moment as Record<string, unknown>
  const offsetSeconds = handed.offsetSeconds
  if (handed.streamId !== streamId || handed.momentAt !== momentAt || typeof handed.login !== 'string' || !LOGIN.test(handed.login)
    || typeof offsetSeconds !== 'number' || !Number.isFinite(offsetSeconds) || offsetSeconds < 0) return null
  return { streamId, momentAt, offsetSeconds, login: handed.login,
    displayName: text(handed.displayName, 100), category: text(handed.category, 200), profileImageUrl: text(handed.profileImageUrl, 500) }
}
