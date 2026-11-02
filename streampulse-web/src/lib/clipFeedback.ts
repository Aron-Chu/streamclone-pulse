import { validClipId } from './nativeClips'

/**
 * Reviews and comments on a clip's page (streampulse-backend, behind
 * PULSE_CLIP_REVIEWS_ENABLED; every route answers 404 while it is off).
 *
 * Reads work signed out. Writes need the website account session and a linked
 * Twitch identity, with the same cookie and CSRF rules as the other
 * /v1/account POSTs. Nothing here is kept in the browser.
 */

export const CLIP_REVIEWS_MIN = 10
export const COMMENT_MAX = 280
export const COMMENT_MAX_LINES = 3
const REQUEST_TIMEOUT_MS = 12_000

export type ClipVerdict = 'worth' | 'skip'
export type ReportReason = 'spam' | 'abuse' | 'other'

export interface ClipFeedback {
  clipId: string
  /** `total` and `share` are null until the clip has CLIP_REVIEWS_MIN reviews. Skips are never sent on their own. */
  reviews: { worth: number; total: number | null; share: number | null }
  you: { signedIn: boolean; canWrite: boolean; verdict: ClipVerdict | null }
  comments: { total: number }
}

export interface ClipComment {
  id: string
  body: string
  createdAt: number
  author: { login: string; displayName: string; profileImageUrl: string }
  mine: boolean
  reportedByYou: boolean
}

export interface ClipCommentsPage { items: ClipComment[]; total: number; nextCursor: string | null }

export class ClipFeedbackError extends Error {
  constructor(public status: number, public code?: string, public retryAfterSeconds?: number) { super('Clip feedback request failed') }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/
const count = (v: unknown): number | null => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1e9 ? v : null
const verdict = (v: unknown): ClipVerdict | null => v === 'worth' || v === 'skip' ? v : null

function clipPath(clipId: string, rest: string): string {
  if (!validClipId(clipId)) throw new ClipFeedbackError(400, 'invalid_clip')
  return `/v1/account/clips/${encodeURIComponent(clipId)}${rest}`
}
function commentPath(commentId: string, rest: string): string {
  if (!UUID.test(commentId)) throw new ClipFeedbackError(400, 'invalid_comment_id')
  return `/v1/account/clip-comments/${commentId}${rest}`
}

async function request(method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const write = method !== 'GET'
  const csrf = write ? document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('__Host-pulse_csrf='))?.slice('__Host-pulse_csrf='.length) : undefined
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const response = await fetch(path, {
    method, credentials: 'same-origin', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(csrf && /^[a-f0-9]{64}$/.test(csrf) ? { 'X-Pulse-CSRF': csrf } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    let code: string | undefined
    try {
      const data: unknown = await response.json()
      const error = data && typeof data === 'object' ? (data as { error?: unknown }).error : undefined
      if (typeof error === 'string' && error.length <= 64) code = error
    } catch { /* A body that isn't JSON leaves only the status. */ }
    const retryAfter = Number(response.headers?.get?.('Retry-After'))
    throw new ClipFeedbackError(response.status, code, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 86_400) : undefined)
  }
  if (response.status === 204) return null
  return response.json()
}

/** The feedback object, or null when it isn't one (a wrong schema, a different clip). */
export function toClipFeedback(value: unknown, clipId: string): ClipFeedback | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (v.schemaVersion !== 1 || v.clipId !== clipId) return null
  const reviews = (v.reviews ?? {}) as Record<string, unknown>
  const you = (v.you ?? {}) as Record<string, unknown>
  const comments = (v.comments ?? {}) as Record<string, unknown>
  const worth = count(reviews.worth)
  const total = count(reviews.total)
  const share = typeof reviews.share === 'number' && reviews.share >= 0 && reviews.share <= 1 ? reviews.share : null
  if (worth === null || typeof you.signedIn !== 'boolean') return null
  // The share shows only from CLIP_REVIEWS_MIN reviews, whatever was sent.
  const shown = total !== null && total >= CLIP_REVIEWS_MIN && total >= worth && share !== null
  return {
    clipId,
    reviews: { worth, total: shown ? total : null, share: shown ? share : null },
    you: { signedIn: you.signedIn, canWrite: you.signedIn && you.canWrite === true, verdict: you.signedIn ? verdict(you.verdict) : null },
    comments: { total: count(comments.total) ?? 0 },
  }
}

const TWITCH_PICTURE_HOST = 'static-cdn.jtvnw.net'
function picture(raw: unknown): string {
  if (typeof raw !== 'string' || !raw || raw.length > 1024) return ''
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && u.hostname === TWITCH_PICTURE_HOST && !u.port && !u.username && !u.password ? u.href : ''
  } catch { return '' }
}

/** One comment, or null (a malformed one is left out, not the page). */
export function toClipComment(value: unknown): ClipComment | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const author = (v.author ?? {}) as Record<string, unknown>
  const createdAt = typeof v.createdAt === 'string' ? Date.parse(v.createdAt) : NaN
  if (typeof v.id !== 'string' || !UUID.test(v.id) || typeof v.body !== 'string' || !v.body.trim() || [...v.body].length > COMMENT_MAX || !Number.isFinite(createdAt)) return null
  // The login is empty when a Twitch display name isn't a plain login; the name alone is enough.
  if (typeof author.login !== 'string' || (author.login !== '' && !/^[a-z0-9_]{1,25}$/.test(author.login))) return null
  const displayName = typeof author.displayName === 'string' && author.displayName.trim() && author.displayName.length <= 64 ? author.displayName : author.login
  if (!displayName) return null
  return {
    id: v.id, body: v.body, createdAt,
    author: { login: author.login, displayName, profileImageUrl: picture(author.profileImageUrl) },
    mine: v.mine === true, reportedByYou: v.reportedByYou === true,
  }
}

function toCommentsPage(value: unknown): ClipCommentsPage {
  const v = (value ?? {}) as Record<string, unknown>
  if (v.schemaVersion !== 1 || !Array.isArray(v.items)) throw new ClipFeedbackError(503, 'unexpected_answer')
  const items = v.items.map(toClipComment).filter((item): item is ClipComment => item !== null)
  return { items, total: count(v.total) ?? items.length, nextCursor: typeof v.nextCursor === 'string' && CURSOR.test(v.nextCursor) ? v.nextCursor : null }
}

function feedbackOrThrow(value: unknown, clipId: string): ClipFeedback {
  const feedback = toClipFeedback(value, clipId)
  if (!feedback) throw new ClipFeedbackError(503, 'unexpected_answer')
  return feedback
}

export async function loadClipFeedback(clipId: string, signal?: AbortSignal): Promise<ClipFeedback> {
  return feedbackOrThrow(await request('GET', clipPath(clipId, '/feedback'), undefined, signal), clipId)
}
export async function setClipReview(clipId: string, choice: ClipVerdict | null): Promise<ClipFeedback> {
  const answer = choice ? await request('PUT', clipPath(clipId, '/review'), { verdict: choice }) : await request('DELETE', clipPath(clipId, '/review'))
  return feedbackOrThrow(answer, clipId)
}
export async function loadClipComments(clipId: string, cursor: string | null, signal?: AbortSignal): Promise<ClipCommentsPage> {
  if (cursor !== null && !CURSOR.test(cursor)) throw new ClipFeedbackError(400, 'invalid_cursor')
  return toCommentsPage(await request('GET', clipPath(clipId, cursor ? `/comments?cursor=${encodeURIComponent(cursor)}` : '/comments'), undefined, signal))
}
export async function postClipComment(clipId: string, body: string): Promise<ClipComment> {
  const comment = toClipComment(await request('POST', clipPath(clipId, '/comments'), { body }))
  if (!comment) throw new ClipFeedbackError(503, 'unexpected_answer')
  return comment
}
export async function deleteClipComment(commentId: string): Promise<void> {
  await request('DELETE', commentPath(commentId, ''))
}
export async function reportClipComment(commentId: string, reason: ReportReason): Promise<void> {
  await request('POST', commentPath(commentId, '/report'), { reason })
}

/**
 * Why a comment can't be posted yet, checked the way the backend checks it
 * (trimmed, NFC, 1–280 characters, at most three lines, no control
 * characters), or null when it can.
 */
export function commentProblem(text: string): string | null {
  const body = text.trim().normalize('NFC')
  if (!body) return 'Write something first.'
  if ([...body].length > COMMENT_MAX) return `Keep it to ${COMMENT_MAX} characters.`
  if (body.split('\n').length > COMMENT_MAX_LINES) return `Keep it to ${COMMENT_MAX_LINES} lines.`
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(body) || /\n\n/.test(body)) return 'Use single line breaks and plain text.'
  return null
}

/** What went wrong, in the viewer's words. */
export function clipFeedbackErrorText(error: unknown): string {
  if (error instanceof ClipFeedbackError) {
    if (error.status === 401 || error.code === 'sign_in_required') return 'Your sign-in ended. Sign in again to post.'
    if (error.code === 'twitch_required') return 'Link your Twitch account to post.'
    if (error.status === 429) {
      const minutes = error.retryAfterSeconds ? Math.ceil(error.retryAfterSeconds / 60) : null
      return minutes ? `You've posted a lot just now. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` : 'You\'ve posted a lot just now. Try again later.'
    }
    if (error.code === 'invalid_comment') return 'That comment can\'t be posted. Use plain text, up to 280 characters and 3 lines.'
    if (error.code === 'own_comment') return 'You can\'t report your own comment.'
    if (error.status === 404) return 'This clip doesn\'t take reviews or comments right now.'
  }
  return 'That didn\'t go through. Check your connection and try again.'
}
