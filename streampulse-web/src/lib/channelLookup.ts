/**
 * One channel by its exact login, for the search box's row when no live
 * channel matches (3A, 11-02): StreamPulse's latest recorded stream
 * (`/v1/portal/analytics/channels/{login}/streams?limit=1`) and, for the
 * picture and name, the Twitch profile (`/v1/channels/{login}`). Both routes
 * answer on prod today; the public API has no channel search.
 *
 * A failed read is "can't check right now", never "no such channel": a
 * missing Twitch account and an outage both come back as an edge 502. Answers
 * are cached (a miss for less time), and one read per login is in flight, so
 * typing the same name again costs nothing.
 */
import { apiClient } from './apiClient'
import { isPlausibleTwitchLogin, normalizeTwitchLogin } from './normalizeTwitchLogin'
import { newsroomProfileUrl } from './newsroomProfiles'

export interface TwitchProfile {
  displayName?: string
  avatar?: string
}

export interface LookupStream {
  streamId: string
  startedAt: string
  category?: string
  /** The record says the stream ended. Without it the row does not say "Offline": the live list stops at 500 channels. */
  ended: boolean
}

export type ChannelLookup =
  /** StreamPulse has recorded the channel: its latest stream. */
  | { state: 'recorded'; login: string; profile: TwitchProfile | null; stream: LookupStream }
  /** The read worked and holds no stream. `profile` is set only when Twitch answered for the login. */
  | { state: 'unrecorded'; login: string; profile: TwitchProfile | null }
  /** The read failed: nothing is known. */
  | { state: 'unknown'; login: string }

export type TwitchLookup = { state: 'found'; profile: TwitchProfile } | { state: 'unknown' }

const KEEP_MS = 5 * 60_000
const KEEP_MISS_MS = 30_000
const MAX_KEEP = 80
const kept = new Map<string, { value: ChannelLookup; until: number }>()
const running = new Map<string, Promise<ChannelLookup>>()
const keptTwitch = new Map<string, { value: TwitchLookup; until: number }>()
const runningTwitch = new Map<string, Promise<TwitchLookup>>()

function keep<T>(store: Map<string, { value: T; until: number }>, key: string, value: T, ms: number): void {
  store.delete(key)
  store.set(key, { value, until: Date.now() + ms })
  while (store.size > MAX_KEEP) store.delete(store.keys().next().value!)
}

function fresh<T>(store: Map<string, { value: T; until: number }>, key: string): T | undefined {
  const hit = store.get(key)
  if (!hit) return undefined
  if (hit.until > Date.now()) return hit.value
  store.delete(key)
  return undefined
}

/** The Twitch profile for a login: 200 with that login is "found"; anything else is "unknown", never "no such account". */
export function lookupTwitchProfile(raw: string): Promise<TwitchLookup> {
  const login = normalizeTwitchLogin(raw)
  if (!isPlausibleTwitchLogin(login)) return Promise.resolve({ state: 'unknown' })
  const hit = fresh(keptTwitch, login)
  if (hit) return Promise.resolve(hit)
  let read = runningTwitch.get(login)
  if (!read) {
    read = apiClient<{ login?: unknown; displayName?: unknown; profileImage?: unknown; profileImageUrl?: unknown }>(
      `/v1/channels/${encodeURIComponent(login)}`,
      { timeoutMs: 4000, maxResponseBytes: 64 * 1024, credentials: 'omit' },
    )
      .then(({ data }): TwitchLookup => {
        if (typeof data?.login !== 'string' || normalizeTwitchLogin(data.login) !== login) return { state: 'unknown' }
        return {
          state: 'found',
          profile: {
            displayName: typeof data.displayName === 'string' && data.displayName.trim() ? data.displayName.trim() : undefined,
            avatar: newsroomProfileUrl(data.profileImageUrl) ?? newsroomProfileUrl(data.profileImage),
          },
        }
      })
      .catch((): TwitchLookup => ({ state: 'unknown' }))
      .then((value) => {
        keep(keptTwitch, login, value, value.state === 'found' ? KEEP_MS : KEEP_MISS_MS)
        return value
      })
      .finally(() => runningTwitch.delete(login))
    runningTwitch.set(login, read)
  }
  return read
}

interface StreamsReply {
  items?: Array<{ streamId?: unknown; startedAt?: unknown; category?: unknown; endedAt?: unknown; lifecycleState?: unknown }> | null
}

function latestStream(reply: StreamsReply | null | undefined): LookupStream | null {
  const item = reply?.items?.[0]
  if (!item || typeof item.streamId !== 'string' || !item.streamId || typeof item.startedAt !== 'string' || !item.startedAt) return null
  return {
    streamId: item.streamId,
    startedAt: item.startedAt,
    category: typeof item.category === 'string' && item.category.trim() ? item.category.trim() : undefined,
    ended: (typeof item.endedAt === 'string' && item.endedAt !== '') || item.lifecycleState === 'confirmed_ended',
  }
}

/** The answer kept for a login, if a recent read gave one. */
export function readChannelLookup(raw: string): ChannelLookup | undefined {
  return fresh(kept, normalizeTwitchLogin(raw))
}

export function lookupChannel(raw: string): Promise<ChannelLookup> {
  const login = normalizeTwitchLogin(raw)
  if (!isPlausibleTwitchLogin(login)) return Promise.resolve({ state: 'unknown', login })
  const hit = fresh(kept, login)
  if (hit) return Promise.resolve(hit)
  let read = running.get(login)
  if (!read) {
    const twitch = lookupTwitchProfile(login)
    read = apiClient<StreamsReply>(`/v1/portal/analytics/channels/${encodeURIComponent(login)}/streams?limit=1`, { timeoutMs: 8000, credentials: 'omit' })
      .then(async ({ data }): Promise<ChannelLookup> => {
        const t = await twitch
        const profile = t.state === 'found' ? t.profile : null
        const stream = latestStream(data)
        return stream ? { state: 'recorded', login, profile, stream } : { state: 'unrecorded', login, profile }
      })
      .catch((): ChannelLookup => ({ state: 'unknown', login }))
      .then((value) => {
        keep(kept, login, value, value.state === 'unknown' ? KEEP_MISS_MS : KEEP_MS)
        return value
      })
      .finally(() => running.delete(login))
    running.set(login, read)
  }
  return read
}

/** "Oct 31", with the year when it is not this year's. */
export function lookupDay(iso: string, nowMs = Date.now()): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear()
  return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The row's second line: "Offline · last streamed Oct 31 · GTA V", "Not recorded yet" or "Can't check right now". */
export function lookupLine(lookup: ChannelLookup, nowMs = Date.now()): string {
  if (lookup.state === 'unknown') return 'Can’t check right now'
  if (lookup.state === 'unrecorded') return 'Not recorded yet'
  const { stream } = lookup
  const day = lookupDay(stream.startedAt, nowMs)
  return [stream.ended ? `Offline · last streamed ${day}` : `Last streamed ${day}`, stream.category].filter(Boolean).join(' · ')
}

/** Tests only: forget every kept answer. */
export function resetChannelLookups(): void {
  kept.clear()
  running.clear()
  keptTwitch.clear()
  runningTwitch.clear()
}
