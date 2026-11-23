/**
 * "Who drove it" for one emote in one hub bucket: the streams that used it
 * most there, one row a channel, from `/v1/public/hub/emote-drivers`.
 *
 * Each row is a hub/moments row (its minute is the channel's busiest for the
 * emote, so the Moments link works) plus `emoteUses` over the bucket and
 * `emoteMinuteUses` in that minute. Channels only: no chatter names, no chat.
 *
 * A backend without the route answers 404: the tab remembers that origin and
 * answers 'unserved' at once from then on, and the caller reads hub/moments'
 * top 3s instead, as before. Any other failure is 'unserved' for that call
 * only. Answers stay in this tab's memory (30 min, an empty one 2 min); calls
 * for the same question share one request, and a 429 holds the origin back.
 */
import { apiClient, getBackendUrl, isApiError } from './apiClient'
import { normalizePublicHubMoments, type HubLivePulseMoment, type PublicHubActivityWindow, type PublicHubMomentsResponse } from './publicHub'

export interface HubEmoteDriverMoment extends HubLivePulseMoment {
  /** The channel's uses of the emote over the whole bucket. */
  emoteUses: number
  /** Its uses in this row's minute (`at`), its busiest. */
  emoteMinuteUses: number
}

export interface HubEmoteDriversQuery {
  bucketT: number
  activityWindow: PublicHubActivityWindow
  /** The emote's name, as the hub sends it. */
  name: string
  /** The hub's provider: twitch, seventv, bttv, ffz, or other (none). */
  provider: string
  limit: number
}

export type HubEmoteDriversAnswer =
  | { status: 'ready'; rows: HubEmoteDriverMoment[] }
  | { status: 'empty' }
  /** No usable answer from this origin: read hub/moments instead. */
  | { status: 'unserved' }

export const HUB_EMOTE_DRIVERS_READY_MS = 30 * 60_000
export const HUB_EMOTE_DRIVERS_EMPTY_MS = 2 * 60_000
const RATE_LIMIT_WAIT_MS = 30_000

const UNSERVED: HubEmoteDriversAnswer = { status: 'unserved' }
const memory = new Map<string, { at: number; answer: HubEmoteDriversAnswer }>()
const inFlight = new Map<string, Promise<HubEmoteDriversAnswer>>()
/** Origins that answered 404: an older backend, for the rest of this tab. */
const unservedOrigins = new Set<string>()
const backoff = new Map<string, number>()

export function hubEmoteDriversPath(q: HubEmoteDriversQuery): string {
  const params = new URLSearchParams({
    bucketT: String(q.bucketT),
    activityWindow: q.activityWindow,
    emote: q.name,
    provider: q.provider,
    limit: String(q.limit),
  })
  return `/v1/public/hub/emote-drivers?${params.toString()}`
}

function cacheKey(q: HubEmoteDriversQuery, origin: string): string {
  return JSON.stringify([origin, q.activityWindow, q.bucketT, q.provider, q.name, q.limit])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The wire answer as rows, or 'unserved' when it is not one this route sends. */
export function readHubEmoteDriversAnswer(data: unknown): HubEmoteDriversAnswer {
  if (!isRecord(data) || !Array.isArray(data.moments)) return UNSERVED
  // an outage reads as empty: hub/moments then says it couldn't load
  if (data.status === 'unavailable' || (typeof data.reason === 'string' && data.reason.includes('unavailable'))) return UNSERVED
  const rows: HubEmoteDriverMoment[] = []
  for (const moment of normalizePublicHubMoments(data as Partial<PublicHubMomentsResponse>).moments) {
    const raw = moment as Partial<HubEmoteDriverMoment>
    const uses = Number(raw.emoteUses)
    if (!moment.login || !Number.isFinite(uses) || uses <= 0) continue
    const minute = Number(raw.emoteMinuteUses)
    rows.push({ ...moment, emoteUses: uses, emoteMinuteUses: Number.isFinite(minute) && minute > 0 ? minute : uses })
  }
  return rows.length ? { status: 'ready', rows } : { status: 'empty' }
}

/**
 * The answer this tab already has: a cached one, 'unserved' for an origin that
 * answered 404, or null when it takes a call.
 */
export function readHubEmoteDrivers(q: HubEmoteDriversQuery, now = Date.now()): HubEmoteDriversAnswer | null {
  const origin = getBackendUrl()
  if (unservedOrigins.has(origin)) return UNSERVED
  const key = cacheKey(q, origin)
  const hit = memory.get(key)
  if (!hit) return null
  const ttl = hit.answer.status === 'ready' ? HUB_EMOTE_DRIVERS_READY_MS : HUB_EMOTE_DRIVERS_EMPTY_MS
  if (now - hit.at > ttl) {
    memory.delete(key)
    return null
  }
  return hit.answer
}

/** False once this tab's backend has said it has no emote-drivers route. */
export function hubEmoteDriversServed(): boolean {
  return !unservedOrigins.has(getBackendUrl())
}

/**
 * Asks the backend, once per question at a time. Resolves 'unserved' on any
 * failure and rejects only with an AbortError when `signal` aborts.
 */
export function requestHubEmoteDrivers(q: HubEmoteDriversQuery, signal?: AbortSignal): Promise<HubEmoteDriversAnswer> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  const known = readHubEmoteDrivers(q)
  if (known) return Promise.resolve(known)
  const origin = getBackendUrl()
  const key = cacheKey(q, origin)
  let work = inFlight.get(key)
  if (!work) {
    if ((backoff.get(origin) ?? 0) > Date.now()) return Promise.resolve(UNSERVED)
    backoff.delete(origin)
    // The transport belongs to the shared request, never to its first consumer.
    work = apiClient<unknown>(hubEmoteDriversPath(q))
      .then((response) => {
        const answer = readHubEmoteDriversAnswer(response.data)
        if (answer.status !== 'unserved') memory.set(key, { at: Date.now(), answer })
        return answer
      })
      .catch((error: unknown) => {
        if (isApiError(error) && error.status === 404) unservedOrigins.add(origin)
        if (isApiError(error) && error.kind === 'rate_limited') backoff.set(origin, Date.now() + (error.retryAfterMs ?? RATE_LIMIT_WAIT_MS))
        return UNSERVED
      })
      .finally(() => {
        inFlight.delete(key)
      })
    inFlight.set(key, work)
  }
  if (!signal) return work
  const shared = work
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    shared.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/** Test-only: forgets answers, calls, 404 origins and backoff. */
export function resetHubEmoteDriversForTests(): void {
  memory.clear()
  inFlight.clear()
  unservedOrigins.clear()
  backoff.clear()
}
