/**
 * A Moment's facts for the read-only Moment page, from public data only: the stream route
 * (GET /v1/portal/analytics/streams/:id, one shared read per stream through momentReads). No
 * /v1/account/... route is asked.
 *
 * The feedback read (/v1/account/streams/:id/moments/:minute/feedback) decides these on the server.
 * This follows the same rules (streampulse-backend internal/accounts):
 * - the minute is in the stream from the minute the stream started to its end, or to now while it is
 *   live (minuteInStream). Here "now" is the viewer's clock, so a live stream's last minute allows the
 *   same five minutes of clock skew as measurementTimeMs: a viewer whose clock runs behind still opens
 *   the minute the server just measured;
 * - the window is the minute itself, [minute, minute + 1 min] (momentWindow with no clips).
 * It claims nothing it did not read: no clips (clips: []), nothing hidden, no profile picture (the
 * stream route has none).
 *
 * The stream route does not leave out channels that opted out of Moments; the feedback read does
 * (hidden). The read-only page shows only what the stream route already shows publicly, and needs
 * the stream to name its Twitch login: a stream that answers without one is "not found".
 *
 * Refusals are the feedback read's own, so the page treats both reads alike:
 * - 400 invalid_stream / invalid_moment: the address is not one (nothing is read);
 * - 404 stream_not_found: the stream route has no such stream (400 or 404), answers for another
 *   stream, or names no Twitch login;
 * - 400 invalid_moment: the minute is outside the stream;
 * - 503 unexpected_answer: the answer has no usable start or end.
 * Any other failure (offline, timeout, 5xx) is passed on as it came: Try again reads again.
 */
import type { MomentStreamAnswer } from './discoveryMoments'
import { momentNow } from './momentCommentSpan'
import { MomentFeedbackError, parseMomentAtKey, wholeSecondUtc, type MomentAtKey, type MomentFacts } from './momentFeedback'
import { answerLogin, isMomentStreamId, loadMomentStream, untilStopped } from './momentReads'

export type { MomentFacts } from './momentFeedback'

const MINUTE_MS = 60_000
/** How far a viewer's clock may run behind the server's (as measurementTimeMs allows). */
const CLOCK_SKEW_MS = 5 * MINUTE_MS

const instantMs = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value || value.length > 40) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}
const shortText = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max ? value : null

/** True when the stream route said it has no such stream. */
function streamRouteMissing(error: unknown): boolean {
  const status = error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined
  return status === 400 || status === 404
}

/**
 * The facts for `minuteMs` from a stream answer already read, at `nowMs`. Throws the feedback read's
 * refusals (see above) when the answer does not place this minute in this stream.
 */
export function momentFactsFromAnswer(streamId: string, minuteMs: number, data: MomentStreamAnswer, nowMs: number): MomentFacts {
  const stream = data.stream
  const login = answerLogin(data)
  if (!stream || stream.streamId !== streamId || !login) throw new MomentFeedbackError(404, 'stream_not_found')
  const startedMs = instantMs(stream.startedAt)
  // The stream route leaves endedAt out while the stream is live.
  const endedMs = stream.endedAt == null || stream.endedAt === '' ? null : instantMs(stream.endedAt)
  if (startedMs === null || (stream.endedAt != null && stream.endedAt !== '' && endedMs === null)) {
    throw new MomentFeedbackError(503, 'unexpected_answer')
  }
  const firstMinute = Math.floor(startedMs / MINUTE_MS) * MINUTE_MS
  if (minuteMs % MINUTE_MS !== 0 || minuteMs < firstMinute || minuteMs > (endedMs ?? nowMs + CLOCK_SKEW_MS)) {
    throw new MomentFeedbackError(400, 'invalid_moment')
  }
  const at = wholeSecondUtc(minuteMs)
  return {
    streamId,
    momentAt: at,
    stream: {
      login,
      displayName: shortText(stream.displayName, 100) ?? login,
      profileImageUrl: '',
      category: shortText(stream.category, 200) ?? '',
      startedAt: wholeSecondUtc(startedMs),
      endedAt: endedMs === null ? null : wholeSecondUtc(endedMs),
    },
    window: { from: at, to: wholeSecondUtc(minuteMs + MINUTE_MS) },
    clips: [],
    hidden: false,
  }
}

/** The Moment's facts, read-only. The signal stops only this caller's wait; the stream read is shared. */
export async function loadMomentFacts(streamId: string, momentAt: MomentAtKey, signal?: AbortSignal): Promise<MomentFacts> {
  if (!isMomentStreamId(streamId)) throw new MomentFeedbackError(400, 'invalid_stream')
  const minuteMs = parseMomentAtKey(momentAt)
  if (minuteMs === null) throw new MomentFeedbackError(400, 'invalid_moment')
  let data: MomentStreamAnswer
  try {
    data = await untilStopped(() => loadMomentStream(streamId), signal)
  } catch (error) {
    if (streamRouteMissing(error)) throw new MomentFeedbackError(404, 'stream_not_found')
    throw error
  }
  return momentFactsFromAnswer(streamId, minuteMs, data, momentNow())
}
