/**
 * The public reads a Moment page and the Moments list's pictures use, each asked once per stream per
 * page view: the stream route (who, what, the VOD and its verified alignment) and the recap route (the
 * stream's top moments). Both are plain public GETs. A failed read is kept a few seconds, so the page
 * opening right after a link warmed it shows that failure instead of asking again; Try again forgets it
 * (forgetFailedMomentReads). An answer is kept for two minutes after it arrives, so a live stream's
 * answer (no endedAt yet, a recap still growing) is read again on a later visit.
 *
 * It holds no picture code, so a link into a Moment's page can start these reads before the page's
 * own code arrives (momentPageFlag.ts warmMomentPage). The preview readers are in momentPreviewReads.ts.
 */
import { apiClient } from './apiClient'
import type { MomentStreamAnswer } from './discoveryMoments'
import type { MomentRecapAnswer } from './discoveryMomentRecap'

const STREAM_ID = /^\d{1,20}$/
const VIDEO_ID = /^\d{1,30}$/

/**
 * A stream id a Moment's address, link or read accepts: Twitch's, digits only. The one place to change
 * when another platform's ids join.
 */
export function isMomentStreamId(value: unknown): value is string {
  return typeof value === 'string' && STREAM_ID.test(value)
}

/** A video (VOD) id a Moment's picture reads accept: Twitch's, digits only. */
export function isMomentVideoId(value: unknown): value is string {
  return typeof value === 'string' && VIDEO_ID.test(value)
}

/** Row reads (stream answers and stream frames) running at once. */
const STREAM_READS_AT_ONCE = 2
/** How long an answer is kept once it arrives. A read still on its way is always shared. */
const ANSWER_KEPT_MS = 120_000
/** How long a failed read is kept: the page's first read reuses a warm's failure, a later visit asks again. */
const FAILURE_KEPT_MS = 5_000
type Held<T> = { until: number; promise: Promise<T>; failed?: boolean }
const streamReads = new Map<string, Held<MomentStreamAnswer>>()
const recapReads = new Map<string, Held<MomentRecapAnswer>>()
const queue: Array<() => void> = []
let running = 0

/** A row read waits its turn: at most STREAM_READS_AT_ONCE run at once. */
export async function inTurn<T>(read: () => Promise<T>): Promise<T> {
  // A waiter is handed the finished read's slot directly, so no caller can take it in between.
  if (running >= STREAM_READS_AT_ONCE) await new Promise<void>(resolve => queue.push(resolve))
  else running += 1
  try { return await read() } finally {
    const next = queue.shift()
    if (next) next()
    else running -= 1
  }
}

function cached<T>(map: Map<string, Held<T>>, key: string, read: () => Promise<T>): Promise<T> {
  const held = map.get(key)
  if (held && held.until > Date.now()) return held.promise
  map.delete(key)
  const entry: Held<T> = { until: Infinity, promise: read() }
  map.set(key, entry)
  entry.promise.then(
    () => { entry.until = Date.now() + ANSWER_KEPT_MS },
    () => { entry.until = Date.now() + FAILURE_KEPT_MS; entry.failed = true },
  )
  if (map.size > 200) map.delete(map.keys().next().value!)
  return entry.promise
}

function forgetFailed<T>(map: Map<string, Held<T>>, key: string): void {
  if (map.get(key)?.failed) map.delete(key)
}

/** Try again: the stream's failed reads are forgotten, so the next ask reads again. Answers are kept. */
export function forgetFailedMomentReads(streamId: string): void {
  forgetFailed(streamReads, streamId)
  forgetFailed(recapReads, streamId)
}

/**
 * A shared read as one caller waits for it. When the caller's signal stops, that caller stops waiting
 * (an AbortError); the read goes on for the others. A caller already stopped starts no read.
 */
export function untilStopped<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return read()
  const stopped = () => signal.reason ?? new DOMException('The read was stopped.', 'AbortError')
  if (signal.aborted) return Promise.reject(stopped())
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(stopped())
    signal.addEventListener('abort', stop, { once: true })
    read().then(
      value => { signal.removeEventListener('abort', stop); resolve(value) },
      error => { signal.removeEventListener('abort', stop); reject(error) },
    )
  })
}

/**
 * The stream's login as the stream route names it, lower case, when it is a Twitch login. Every login
 * the answer gives must name the same channel (as the source check requires), else null.
 */
export function answerLogin(data: MomentStreamAnswer): string | null {
  const given = [data.stream?.login, data.stream?.channel, data.channel].filter(value => value != null && value !== '')
  if (given.length === 0 || !given.every(value => typeof value === 'string')) return null
  const logins = new Set((given as string[]).map(value => value.toLowerCase()))
  const [login] = [...logins]
  return logins.size === 1 && /^[a-z0-9_]{1,25}$/.test(login!) ? login! : null
}

/** The stream route's answer for one stream, read once. `inLine` waits its turn behind other row reads. */
export function loadMomentStream(streamId: string, inLine = false): Promise<MomentStreamAnswer> {
  return cached(streamReads, streamId, () => {
    const read = () => apiClient<MomentStreamAnswer>(`/v1/portal/analytics/streams/${encodeURIComponent(streamId)}`, { timeoutMs: 8000 })
      .then(({ data }) => {
        if (!data || typeof data !== 'object') throw new TypeError('Unexpected stream answer')
        return data
      })
    return inLine ? inTurn(read) : read()
  })
}

/**
 * Keeps a stream answer another read already has (the Moments list's source check reads the same
 * route), so the Moment page it links to does not read the stream again. An answer already held, or a
 * read still on its way, wins. The answer must name this stream.
 */
export function primeMomentStream(streamId: string, data: MomentStreamAnswer): void {
  if (!data || typeof data !== 'object' || data.stream?.streamId !== streamId) return
  const held = streamReads.get(streamId)
  if (held && !held.failed && held.until > Date.now()) return
  streamReads.set(streamId, { until: Date.now() + ANSWER_KEPT_MS, promise: Promise.resolve(data) })
  if (streamReads.size > 200) streamReads.delete(streamReads.keys().next().value!)
}

/** The recap route's answer for one stream, read once. */
export function loadMomentRecap(streamId: string): Promise<MomentRecapAnswer> {
  return cached(recapReads, streamId, () => apiClient<MomentRecapAnswer>(
    `/v1/portal/analytics/streams/${encodeURIComponent(streamId)}/recap`, { timeoutMs: 8000, maxResponseBytes: 512 * 1024 })
    .then(({ data }) => {
      if (!data || typeof data !== 'object') throw new TypeError('Unexpected recap answer')
      return data
    }))
}

/** Tests only. */
export function resetMomentReads(): void {
  streamReads.clear()
  recapReads.clear()
  queue.length = 0
  running = 0
}
