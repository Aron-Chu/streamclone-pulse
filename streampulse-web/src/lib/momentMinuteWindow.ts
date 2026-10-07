import { measurementTimeMs } from '@streampulse/pulse-core'
import { apiClient, getBackendUrl, type ApiError } from './apiClient'
import { resolveBackendSource } from './backendSource'
import type { DiscoveryMoment } from './discoveryMoments'
import { PORTAL_MINUTES_TIMEOUT_MS } from './timelineDownsample'

/** The window drawn around a moment: half an hour of lead-in, ten minutes of aftermath. */
export const MOMENT_MINUTES_BEFORE = 30
export const MOMENT_MINUTES_AFTER = 10
/**
 * How long a moment stays open before its minutes are read. Previous/Next mounts a
 * chart per step, and a held key steps faster than this, so the moments passed over
 * send nothing.
 */
export const MOMENT_MINUTES_SETTLE_MS = 200

/**
 * One minute of the window.
 *
 * - `measured`: a minute rollup carries a chat count; `chatPerMin` is that count.
 * - `unrecorded`: a minute rollup exists but carries no chat count. The API omits a
 *   zero count, and a viewer-only rollup (chat not captured yet) looks the same, so
 *   this is "no chat recorded", never a measured zero.
 * - `unmeasured`: inside the broadcast, but the rollup is missing or flagged missing.
 * - `outside`: before the broadcast started, or after the latest minute the API returned.
 */
export interface MomentMinuteSlot {
  /** Minutes from the moment's own minute, -30 … 10. */
  relative: number
  state: 'measured' | 'unrecorded' | 'unmeasured' | 'outside'
  chatPerMin: number | null
}

export interface MomentMinuteWindow {
  /** Always 41 slots, oldest first; the moment is `slots[MOMENT_MINUTES_BEFORE]`. */
  slots: MomentMinuteSlot[]
  /** Minutes with a chat count. */
  measuredMinutes: number
  /** Minutes with a rollup but no chat count. */
  unrecordedMinutes: number
  /** No later minute can arrive: the API already returned minutes past the window. */
  complete: boolean
}

type WindowMoment = Pick<DiscoveryMoment, 'login' | 'streamId' | 'offsetSeconds' | 'at'>
interface MinutePointPayload { offsetSeconds?: unknown; chatCount?: unknown; missing?: unknown }
interface MinutesPayload { streamId?: unknown; channel?: unknown; startedAt?: unknown; minutes?: unknown }

/**
 * `afterOffset` for the bounded live-tail read the stream timeline already uses.
 * Whole minutes match the server's tail cache key; one spare minute covers minute
 * boundaries that do not line up with the broadcast start.
 */
export function momentMinutesAfterOffset(offsetSeconds: number): number {
  return Math.max(0, Math.floor((offsetSeconds - (MOMENT_MINUTES_BEFORE + 1) * 60) / 60) * 60)
}

/**
 * The whole second the API's offsets count from. The backend computes each offset as
 * int(MinuteTS - StartedAt): truncated, and clamped at 0. Against a start with a
 * fractional second, every minute's offset therefore lands on the whole second after
 * the start, and mapping from that second gives back each rollup's own minute.
 * Date.parse keeps milliseconds only, so a finer remainder (RFC3339Nano) is read
 * from the text.
 */
function offsetOriginMs(startedAt: unknown, startMs: number): number {
  const finer = typeof startedAt === 'string' && /\.\d{3}\d*[1-9]/.test(startedAt)
  return Math.ceil((startMs + (finer ? 1 : 0)) / 1000) * 1000
}

/**
 * The minute a moment's `at` names, independent of the broadcast start. `at` is the
 * minute itself (stored detections) or the start plus the truncated offset (live and
 * ranked rows), which can fall up to a second before that minute.
 */
function atMinute(at: number | undefined): number | null {
  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? Math.floor((at + 1000) / 60_000) : null
}

/**
 * Shape `/streams/{id}/minutes` rows into the window around one moment.
 *
 * Only rollups with a chat count become bars. A minute the API flags missing, or
 * never returns, stays empty rather than being drawn as zero. A present, unflagged
 * row without a chat count is `unrecorded`: the API omits a zero count, but a
 * viewer-only rollup (chat not yet captured for this channel) looks identical, so
 * it is neither drawn nor counted as measured chat. An explicit numeric 0 is a
 * measured zero. Returns null when the payload is for another broadcast or no
 * minute in the window has a chat count.
 */
export function momentMinuteWindowFromMinutes(moment: WindowMoment, payload: unknown, nowMs = Date.now()): MomentMinuteWindow | null {
  if (!payload || typeof payload !== 'object') return null
  const data = payload as MinutesPayload
  if (data.streamId != null && data.streamId !== moment.streamId) return null
  if (data.channel != null && data.channel !== '' && (typeof data.channel !== 'string' || data.channel.toLowerCase() !== moment.login)) return null
  const startMs = measurementTimeMs(data.startedAt, nowMs)
  if (startMs == null || !Array.isArray(data.minutes) || !Number.isFinite(moment.offsetSeconds) || moment.offsetSeconds < 0) return null
  const origin = offsetOriginMs(data.startedAt, startMs)
  // The broadcast start can be revised earlier after a moment was published (the
  // backend keeps the least start it has seen), and the moment's offset still counts
  // from the old one. `at` names the minute without the start, so it places the window;
  // rows are always measured from the start this payload reports.
  const momentMinute = atMinute(moment.at) ?? Math.floor((origin + moment.offsetSeconds * 1000) / 60_000)
  const firstInStream = Math.floor(startMs / 60_000) - momentMinute
  const values = new Map<number, number | 'unrecorded' | null>()
  let latest = -Infinity
  // The tail read is bounded to 120 rows server-side; never trust more than that.
  for (const row of data.minutes.slice(0, 240) as MinutePointPayload[]) {
    if (!row || typeof row !== 'object') continue
    const offset = row.offsetSeconds
    if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) continue
    const relative = Math.floor((origin + offset * 1000) / 60_000) - momentMinute
    latest = Math.max(latest, relative)
    if (relative < -MOMENT_MINUTES_BEFORE || relative > MOMENT_MINUTES_AFTER) continue
    const chat = row.chatCount
    const value = row.missing === true ? null
      : chat == null ? 'unrecorded' as const
        : typeof chat === 'number' && Number.isFinite(chat) && chat >= 0 ? chat : null
    // A repeated minute keeps its last row, as the timeline's rollup conversion does.
    values.set(relative, value)
  }
  const slots: MomentMinuteSlot[] = []
  let measuredMinutes = 0
  let unrecordedMinutes = 0
  for (let relative = -MOMENT_MINUTES_BEFORE; relative <= MOMENT_MINUTES_AFTER; relative += 1) {
    const value = values.get(relative)
    if (typeof value === 'number') {
      measuredMinutes += 1
      slots.push({ relative, state: 'measured', chatPerMin: value })
    } else if (value === 'unrecorded') {
      unrecordedMinutes += 1
      slots.push({ relative, state: 'unrecorded', chatPerMin: null })
    } else {
      const outside = relative < firstInStream || relative > latest
      slots.push({ relative, state: outside ? 'outside' : 'unmeasured', chatPerMin: null })
    }
  }
  if (!measuredMinutes) return null
  return { slots, measuredMinutes, unrecordedMinutes, complete: latest > MOMENT_MINUTES_AFTER }
}

/** Only the fields a window reads, at most 240 rows: what a cached read keeps. */
function keptMinutes(payload: unknown): MinutesPayload | null {
  if (!payload || typeof payload !== 'object') return null
  const { streamId, channel, startedAt, minutes } = payload as MinutesPayload
  return { streamId, channel, startedAt, minutes: Array.isArray(minutes)
    ? (minutes.slice(0, 240) as MinutePointPayload[]).map(row => row && typeof row === 'object'
      ? { offsetSeconds: row.offsetSeconds, chatCount: row.chatCount, missing: row.missing } : null)
    : minutes }
}

/**
 * Answered reads, keyed by the detection they were read for. The window is shaped
 * from the kept rows each time, for the moment asking, so a moment's `at` never
 * comes from an earlier copy of it.
 */
const reads = new Map<string, { expires: number; payload: MinutesPayload | null }>()
/** Reads still in flight, shared by every wait for the same detection. */
const pending = new Map<string, Promise<MinutesPayload | null>>()
const readKey = (moment: Pick<DiscoveryMoment, 'streamId' | 'offsetSeconds'>) =>
  `${getBackendUrl()}|${moment.streamId}|${moment.offsetSeconds}`
const cancelled = (): ApiError => ({ kind: 'aborted', message: 'Request was cancelled', status: 0 })

/** A window read in the last minute (or a finished one), without a request. */
export function peekMomentMinuteWindow(moment: WindowMoment): { value: MomentMinuteWindow | null } | null {
  const hit = reads.get(readKey(moment))
  return hit && hit.expires > Date.now() ? { value: momentMinuteWindowFromMinutes(moment, hit.payload) } : null
}

function readMinutes(moment: WindowMoment, key: string): Promise<MinutesPayload | null> {
  // The same budget the stream timeline gives this endpoint: a long broadcast's
  // uncached tail costs about as much as its whole timeline. No caller can cancel it:
  // the origin keeps working behind the edge anyway, and its answer serves the next
  // open of the same moment. Its own deadline and size cap bound it.
  return apiClient<unknown>(
    `/v1/portal/analytics/streams/${encodeURIComponent(moment.streamId)}/minutes?afterOffset=${momentMinutesAfterOffset(moment.offsetSeconds)}`,
    { timeoutMs: PORTAL_MINUTES_TIMEOUT_MS, maxResponseBytes: 1024 * 1024 })
    .then(({ data }) => {
      const payload = keptMinutes(data)
      // A finished window cannot change; a live one gains minutes, so keep it briefly.
      const complete = momentMinuteWindowFromMinutes(moment, payload)?.complete
      reads.delete(key)
      reads.set(key, { expires: Date.now() + (complete ? 10 * 60_000 : 60_000), payload })
      while (reads.size > 32) reads.delete(reads.keys().next().value!)
      return payload
    })
}

/** Resolves once the caller has kept the moment open for `ms`; leaving first rejects. */
function settle(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(cancelled())
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const leave = () => { clearTimeout(timer); reject(cancelled()) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', leave); resolve() }, ms)
    signal.addEventListener('abort', leave, { once: true })
  })
}

/** One caller's wait on a shared read: leaving stops the wait, never the read. */
function whileWanted<T>(read: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(cancelled())
  return new Promise((resolve, reject) => {
    const leave = () => reject(cancelled())
    signal.addEventListener('abort', leave, { once: true })
    void read.then(resolve, reject).finally(() => signal.removeEventListener('abort', leave))
  })
}

/**
 * The selected moment's minute window, read lazily from the same per-minute
 * rollups the stream timeline draws. One bounded read, only for a moment that stays
 * open (`settleMs`), shared with any other wait for the same request; a failure
 * rejects and is never cached, so a retry reads again. The local analytics stack has
 * no portal minutes route (the stream timeline skips it too), so there the window is
 * simply unavailable.
 */
export async function loadMomentMinuteWindow(moment: WindowMoment, signal: AbortSignal, settleMs = MOMENT_MINUTES_SETTLE_MS): Promise<MomentMinuteWindow | null> {
  if (resolveBackendSource(getBackendUrl()) === 'local') return null
  const cached = peekMomentMinuteWindow(moment)
  if (cached) return cached.value
  await settle(settleMs, signal)
  const answered = peekMomentMinuteWindow(moment)
  if (answered) return answered.value
  const key = readKey(moment)
  let read = pending.get(key)
  if (!read) {
    const started = readMinutes(moment, key)
    read = started
    pending.set(key, started)
    // Every caller may have left by the time it settles; nothing is left unhandled.
    void started.catch(() => undefined).finally(() => { if (pending.get(key) === started) pending.delete(key) })
  }
  return momentMinuteWindowFromMinutes(moment, await whileWanted(read, signal))
}

export function clearMomentMinuteWindowCacheForTests(): void {
  reads.clear()
  pending.clear()
}
