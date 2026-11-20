import { accountJsonRequest, type AccountErrorFactory } from './accountRequest'

/**
 * Ratings on a Moment and comments on a stream (streampulse-backend, behind
 * PULSE_MOMENT_FEEDBACK_ENABLED; every route answers 404 while it is off).
 *
 * Reads work signed out. Writes need the website account session and a stored
 * Twitch name and picture (403 `twitch_required` otherwise), with the same
 * cookie and CSRF rules as the other /v1/account calls. Nothing is kept in the
 * browser.
 *
 * The edge relay forwards only exact shapes, so every input is checked here
 * and refused with a 400 before anything is fetched.
 */

/** The yes count shows alone below this many ratings. */
export const MOMENT_RATINGS_MIN = 10

/** A Moment's minute as it sits in the page path: `YYYYMMDDTHHmmZ`, UTC. */
export type MomentAtKey = string
export type MomentVerdict = 'real' | 'not_real'
export type CommentReportReason = 'spam' | 'abuse' | 'other'

export interface WindowClip {
  id: string
  url: string
  thumbnailUrl: string
  title: string
  durationSeconds: number
  from: string
  to: string
}

/**
 * What the Moment page shows of a Moment without its ratings and comments: the stream, the minute
 * and its window. The feedback read gives these along with the rest; momentFacts.ts builds them
 * read-only from the public stream route.
 */
export interface MomentFacts {
  /** The canonical stream id. It may differ from the requested one (an alias): switch the page URL and comment calls to it. */
  streamId: string
  /** The Moment's minute, as the API wrote it (RFC 3339, UTC). */
  momentAt: string
  stream: { login: string; displayName: string; profileImageUrl: string; category: string; startedAt: string; endedAt: string | null }
  window: { from: string; to: string }
  clips: WindowClip[]
  hidden: boolean
}

export interface MomentFeedback extends MomentFacts {
  /** `total` and `share` are null until the Moment has MOMENT_RATINGS_MIN ratings. */
  ratings: { yes: number; total: number | null; share: number | null }
  you: { signedIn: boolean; canWrite: boolean; verdict: MomentVerdict | null }
  comments: { total: number }
}

export interface StreamComment {
  id: string
  /** The instant the comment is pinned to: whole-second UTC. */
  at: string
  body: string
  createdAt: number
  author: { login: string; displayName: string; profileImageUrl: string }
  mine: boolean
  reportedByYou: boolean
}

export interface StreamCommentPage { items: StreamComment[]; total: number; nextCursor?: string }

export class MomentFeedbackError extends Error {
  constructor(public status: number, public code?: string, public retryAfterSeconds?: number) { super('Moment feedback request failed') }
}

const makeError: AccountErrorFactory = (status, code, retryAfterSeconds) => new MomentFeedbackError(status, code, retryAfterSeconds)
const request = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, body?: Record<string, unknown>, signal?: AbortSignal) =>
  accountJsonRequest(method, path, makeError, body, signal)

const STREAM_ID = /^\d{1,20}$/
const MOMENT_KEY = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const WHOLE_SECOND = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const CURSOR = /^[A-Za-z0-9_-]{1,268}$/
const MINUTE_MS = 60_000
const pad = (n: number, width = 2) => String(n).padStart(width, '0')
const count = (v: unknown): number | null => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1e9 ? v : null

/** The minute containing `ms`, as a path key. */
export function momentAtKey(ms: number): MomentAtKey {
  const d = new Date(Math.floor(ms / MINUTE_MS) * MINUTE_MS)
  return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z`
}

/** The minute's start in ms, or null when the key isn't a real UTC minute. */
export function parseMomentAtKey(key: string): number | null {
  const m = typeof key === 'string' ? MOMENT_KEY.exec(key) : null
  if (!m) return null
  const [year, month, day, hour, minute] = m.slice(1).map(Number)
  const ms = Date.UTC(year, month - 1, day, hour, minute)
  return Number.isFinite(ms) && momentAtKey(ms) === key ? ms : null
}

/**
 * The whole minute a point `offsetSeconds` into a stream falls on, in ms:
 * rounded up to the minute, and the start truncated when the offset is zero
 * or less.
 */
export function momentMinuteAt(startedAtMs: number, offsetSeconds: number): number {
  if (offsetSeconds <= 0) return Math.floor(startedAtMs / MINUTE_MS) * MINUTE_MS
  return Math.ceil((startedAtMs + offsetSeconds * 1000) / MINUTE_MS) * MINUTE_MS
}

export function momentPagePath(streamId: string, momentAt: MomentAtKey): string {
  return `/analytics/moments/${streamId}/${momentAt}`
}

/**
 * The UTC instant floored to the whole second, `YYYY-MM-DDTHH:MM:SSZ`. Not
 * toISOString(), whose `.000Z` the edge relay refuses.
 */
export function wholeSecondUtc(ms: number): string {
  const d = new Date(Math.floor(ms / 1000) * 1000)
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`
}

/**
 * True when the feature is off: a 404 with no code (the edge relay's bodiless
 * 404 for a route it doesn't relay) or `not_found` (the handler while its flag
 * is off). `stream_not_found` and `comment_not_found` are not "off": a comment
 * deleted or hidden while the page is open is the normal case.
 */
export function momentFeedbackOff(error: unknown): boolean {
  return error instanceof MomentFeedbackError && error.status === 404 && (error.code === undefined || error.code === 'not_found')
}

/** "6 said yes" below MOMENT_RATINGS_MIN ratings, "78% said yes · 18 ratings" from there. */
export function ratingTallyText(r: { yes: number; total?: number | null; share?: number | null }): string {
  if (r.total != null && r.share != null) return `${Math.round(r.share * 100)}% said yes · ${r.total} ratings`
  return `${r.yes} said yes`
}

function streamPath(streamId: string, rest: string): string {
  if (!STREAM_ID.test(streamId)) throw new MomentFeedbackError(400, 'invalid_stream')
  return `/v1/account/streams/${streamId}${rest}`
}
function momentPath(streamId: string, momentAt: MomentAtKey, rest: string): string {
  if (!STREAM_ID.test(streamId)) throw new MomentFeedbackError(400, 'invalid_stream')
  if (parseMomentAtKey(momentAt) === null) throw new MomentFeedbackError(400, 'invalid_moment')
  return `/v1/account/streams/${streamId}/moments/${momentAt}${rest}`
}
function commentPath(commentId: string, rest: string): string {
  if (!UUID.test(commentId)) throw new MomentFeedbackError(400, 'invalid_comment_id')
  return `/v1/account/stream-comments/${commentId}${rest}`
}

const TWITCH_PICTURE_HOST = 'static-cdn.jtvnw.net'
function picture(raw: unknown): string {
  if (typeof raw !== 'string' || !raw || raw.length > 512) return ''
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && u.hostname === TWITCH_PICTURE_HOST && !u.port && !u.username && !u.password ? u.href : ''
  } catch { return '' }
}
/** A clip link or thumbnail: https on a Twitch host, or empty. */
function twitchUrl(raw: unknown, hosts: (host: string) => boolean): string {
  if (typeof raw !== 'string' || !raw || raw.length > 1024) return ''
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && hosts(u.hostname) && !u.port && !u.username && !u.password ? u.href : ''
  } catch { return '' }
}
const isTwitchSite = (h: string) => h === 'twitch.tv' || h.endsWith('.twitch.tv')
const isTwitchImage = (h: string) => h.endsWith('.jtvnw.net') || isTwitchSite(h)
const text = (v: unknown, max: number): string | null => typeof v === 'string' && v.length <= max ? v : null
const instant = (v: unknown): string | null => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? v : null

function toWindowClip(value: unknown): WindowClip | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const url = twitchUrl(v.url, isTwitchSite)
  const from = instant(v.from)
  const to = instant(v.to)
  const duration = typeof v.durationSeconds === 'number' && Number.isFinite(v.durationSeconds) && v.durationSeconds >= 0 && v.durationSeconds <= 86_400 ? v.durationSeconds : null
  const title = text(v.title, 200)
  if (typeof v.id !== 'string' || !v.id || v.id.length > 256 || !url || from === null || to === null || duration === null || title === null) return null
  return { id: v.id, url, thumbnailUrl: twitchUrl(v.thumbnailUrl, isTwitchImage), title, durationSeconds: duration, from, to }
}

/** The feedback object, or null when it isn't one (a wrong schema, a different stream or minute). */
export function toMomentFeedback(value: unknown, streamId: string, momentAt: MomentAtKey): MomentFeedback | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const wanted = parseMomentAtKey(momentAt)
  // The API resolves alias ids and answers with the canonical one, so any valid id is accepted.
  if (v.schemaVersion !== 1 || typeof v.streamId !== 'string' || !STREAM_ID.test(v.streamId) || wanted === null) return null
  const answered = typeof v.momentAt === 'string' ? Date.parse(v.momentAt) : NaN
  if (answered !== wanted) return null
  const stream = (v.stream ?? {}) as Record<string, unknown>
  const window = (v.window ?? {}) as Record<string, unknown>
  const ratings = (v.ratings ?? {}) as Record<string, unknown>
  const you = (v.you ?? {}) as Record<string, unknown>
  const comments = (v.comments ?? {}) as Record<string, unknown>
  const yes = count(ratings.yes)
  const total = count(ratings.total)
  const share = typeof ratings.share === 'number' && ratings.share >= 0 && ratings.share <= 1 ? ratings.share : null
  const startedAt = instant(stream.startedAt)
  const from = instant(window.from)
  const to = instant(window.to)
  if (yes === null || typeof you.signedIn !== 'boolean' || startedAt === null || from === null || to === null) return null
  // The share shows only from MOMENT_RATINGS_MIN ratings, whatever was sent.
  const shown = total !== null && total >= MOMENT_RATINGS_MIN && total >= yes && share !== null
  const hidden = v.hidden === true
  return {
    streamId: v.streamId,
    momentAt: v.momentAt as string,
    stream: {
      login: text(stream.login, 64) ?? '', displayName: text(stream.displayName, 100) ?? '', profileImageUrl: picture(stream.profileImageUrl),
      category: text(stream.category, 200) ?? '', startedAt, endedAt: instant(stream.endedAt),
    },
    window: { from, to },
    clips: !hidden && Array.isArray(v.clips) ? v.clips.map(toWindowClip).filter((c): c is WindowClip => c !== null) : [],
    ratings: { yes, total: shown ? total : null, share: shown ? share : null },
    you: {
      signedIn: you.signedIn, canWrite: you.signedIn && !hidden && you.canWrite === true,
      verdict: you.signedIn && !hidden && (you.verdict === 'real' || you.verdict === 'not_real') ? you.verdict : null,
    },
    comments: { total: count(comments.total) ?? 0 },
    hidden,
  }
}

/** One comment, or null (a malformed one is left out, not the page). */
export function toStreamComment(value: unknown): StreamComment | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const author = (v.author ?? {}) as Record<string, unknown>
  const createdAt = typeof v.createdAt === 'string' ? Date.parse(v.createdAt) : NaN
  if (typeof v.id !== 'string' || !UUID.test(v.id) || typeof v.at !== 'string' || !WHOLE_SECOND.test(v.at) || !Number.isFinite(Date.parse(v.at))) return null
  if (typeof v.body !== 'string' || !v.body.trim() || [...v.body].length > 280 || !Number.isFinite(createdAt)) return null
  // The login is empty when a Twitch display name isn't a plain login; the name alone is enough.
  if (typeof author.login !== 'string' || (author.login !== '' && !/^[a-z0-9_]{1,25}$/.test(author.login))) return null
  const displayName = typeof author.displayName === 'string' && author.displayName.trim() && author.displayName.length <= 64 ? author.displayName : author.login
  if (!displayName) return null
  return {
    id: v.id, at: v.at, body: v.body, createdAt,
    author: { login: author.login, displayName, profileImageUrl: picture(author.profileImageUrl) },
    mine: v.mine === true, reportedByYou: v.reportedByYou === true,
  }
}

function toCommentPage(value: unknown): StreamCommentPage {
  const v = (value ?? {}) as Record<string, unknown>
  if (v.schemaVersion !== 1 || !Array.isArray(v.items)) throw new MomentFeedbackError(503, 'unexpected_answer')
  const items = v.items.map(toStreamComment).filter((item): item is StreamComment => item !== null)
  const page: StreamCommentPage = { items, total: count(v.total) ?? items.length }
  if (typeof v.nextCursor === 'string' && CURSOR.test(v.nextCursor)) page.nextCursor = v.nextCursor
  return page
}

function feedbackOrThrow(value: unknown, streamId: string, momentAt: MomentAtKey): MomentFeedback {
  const feedback = toMomentFeedback(value, streamId, momentAt)
  if (!feedback) throw new MomentFeedbackError(503, 'unexpected_answer')
  return feedback
}

export async function loadMomentFeedback(streamId: string, momentAt: MomentAtKey, signal?: AbortSignal): Promise<MomentFeedback> {
  return feedbackOrThrow(await request('GET', momentPath(streamId, momentAt, '/feedback'), undefined, signal), streamId, momentAt)
}

/** Rates the Moment, or takes the rating back with `null`. */
export async function setMomentRating(streamId: string, momentAt: MomentAtKey, verdict: MomentVerdict | null): Promise<MomentFeedback> {
  const path = momentPath(streamId, momentAt, '/rating')
  const answer = verdict ? await request('PUT', path, { verdict }) : await request('DELETE', path)
  return feedbackOrThrow(answer, streamId, momentAt)
}

export async function listStreamComments(streamId: string, from: string, to: string, cursor?: string, signal?: AbortSignal): Promise<StreamCommentPage> {
  const path = streamPath(streamId, '/comments')
  if (!WHOLE_SECOND.test(from) || !WHOLE_SECOND.test(to) || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) throw new MomentFeedbackError(400, 'invalid_window')
  if (cursor !== undefined && !CURSOR.test(cursor)) throw new MomentFeedbackError(400, 'invalid_cursor')
  // URLSearchParams writes ":" as %3A, which is the form the relay requires.
  const query = new URLSearchParams([['from', from], ['to', to], ...(cursor !== undefined ? [['cursor', cursor]] : [])])
  return toCommentPage(await request('GET', `${path}?${query}`, undefined, signal))
}

export async function addStreamComment(streamId: string, at: string, body: string): Promise<StreamComment> {
  const path = streamPath(streamId, '/comments')
  if (!WHOLE_SECOND.test(at) || !Number.isFinite(Date.parse(at))) throw new MomentFeedbackError(400, 'invalid_at')
  const comment = toStreamComment(await request('POST', path, { at, body }))
  if (!comment) throw new MomentFeedbackError(503, 'unexpected_answer')
  return comment
}

export async function deleteStreamComment(id: string): Promise<void> {
  await request('DELETE', commentPath(id, ''))
}

export async function reportStreamComment(id: string, reason: CommentReportReason): Promise<void> {
  await request('POST', commentPath(id, '/report'), { reason })
}
