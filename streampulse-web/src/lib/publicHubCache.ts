import { getBackendUrl } from './apiClient'
import { hasPublicHubResponseShape, normalizePublicHub, type HubActivityPoint, type HubLiveChannel, type PublicHub, type PublicHubActivityWindow, type PublicHubProjection } from './publicHub'
import type { HubChannelScreenerV1 } from './channelScreenerContract'
import { hubActivityContractIssues } from './hubActivityHonesty'
import { isHubGestureActive } from './hubBucketSelection'
import { allowPublicHubCacheWritesForTests, clearPublicHubCache, PROJECTION_STORAGE_PREFIX, publicHubCacheWritesStopped, STORAGE_PREFIX } from './publicHubCacheReset'

/** The oldest saved projection (Moments, home tickers) a page may show while it refreshes. */
export const PUBLIC_HUB_CACHE_STALE_MS = 10 * 60 * 1000
/**
 * The oldest saved hub copy the hub may show, under its "Cached snapshot from
 * <time>" note: a slow API then leaves a returning visitor the last hub it
 * saw, not an empty page. The fresh read replaces it as soon as it lands.
 */
export const PUBLIC_HUB_CACHE_HUB_STALE_MS = 6 * 60 * 60 * 1000

/**
 * Bound for one full-hub snapshot (plan H11, §2.6). A full 24 h hub body is
 * about 1.2 MB, so larger bodies are stored as the compact projection below.
 */
export const PUBLIC_HUB_CACHE_MAX_CHARS = 150_000
const PUBLIC_HUB_PROJECTION_CACHE_MAX_CHARS = 100_000
export const PUBLIC_HUB_CACHE_MAX_ENTRIES = 2
/** requestIdleCallback timeout for the persisted snapshot (plan §2.6). */
export const PUBLIC_HUB_CACHE_IDLE_TIMEOUT_MS = 2_000
/** Rows that keep their avatar URL in the compact projection (Busiest now, first Channels page). */
const COMPACT_AVATAR_ROWS = 24

/**
 * version 1: `data` is the hub as normalized.
 * version 2: the compact projection. `data` holds the hub without activity
 * points and live channels; those two arrays are stored column by column in
 * `columns` and rebuilt on read. Per-point top emotes and most avatar URLs are
 * not kept; the next network read restores them.
 */
export interface PublicHubCacheEntry {
  version: 1 | 2
  cachedAt: number
  backendUrl: string
  activityWindow: PublicHubActivityWindow
  projection?: PublicHubProjection
  generatedAt?: string
  data: PublicHub
  columns?: PublicHubCacheColumns
}

type CacheColumn = unknown[] | { d: unknown[]; i: number[] }

interface CacheColumnTable {
  n: number
  cols: Record<string, CacheColumn>
}

interface PublicHubCacheColumns {
  points: CacheColumnTable
  liveChannels: CacheColumnTable
}

function normalizeBackendUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function publicHubCacheKey(backendUrl: string, activityWindow: PublicHubActivityWindow, projection?: PublicHubProjection): string {
  return projection
    ? `${PROJECTION_STORAGE_PREFIX}${normalizeBackendUrl(backendUrl)}:${activityWindow}:${projection}`
    : `${STORAGE_PREFIX}${normalizeBackendUrl(backendUrl)}:${activityWindow}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasUsableHubShape(raw: unknown): raw is Partial<PublicHub> {
  // A stats/status fallback is normalized for the same UI model, but it never
  // had a successful hub read and must not hydrate as one on the next visit.
  return hasPublicHubResponseShape(raw) && isRecord(raw.corpusPipeline) && raw.corpusPipeline.available === true
}

/* ---------------------------------------------------------------------------
 * Column tables: rows of one array stored as one array per field. Object
 * values (provider coverage maps) and repetitive strings (states, categories)
 * are stored once in a dictionary.
 * ------------------------------------------------------------------------- */

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_COLUMN_ROWS = 5_000

function wantsDictionary(values: readonly unknown[]): boolean {
  if (values.some((value) => value !== null && typeof value === 'object')) return true
  const strings = values.filter((value): value is string => typeof value === 'string')
  return strings.length >= 8 && new Set(strings).size * 2 <= strings.length
}

function encodeColumns(rows: readonly object[]): CacheColumnTable {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (value === undefined || seen.has(key) || UNSAFE_KEYS.has(key)) continue
      seen.add(key)
      keys.push(key)
    }
  }
  const cols: Record<string, CacheColumn> = {}
  for (const key of keys) {
    const values = rows.map((row) => {
      const value = (row as Record<string, unknown>)[key]
      return value === undefined ? null : value
    })
    if (wantsDictionary(values)) {
      const dictionary: unknown[] = []
      const index = new Map<string, number>()
      cols[key] = {
        d: dictionary,
        i: values.map((value) => {
          if (value === null) return -1
          const id = typeof value === 'string' ? `s${value}` : `j${JSON.stringify(value)}`
          let at = index.get(id)
          if (at === undefined) {
            at = dictionary.length
            index.set(id, at)
            dictionary.push(value)
          }
          return at
        }),
      }
    } else {
      cols[key] = values
    }
  }
  return { n: rows.length, cols }
}

function decodeColumns(raw: unknown): Record<string, unknown>[] | null {
  if (!isRecord(raw) || !isRecord(raw.cols)) return null
  const n = raw.n
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_COLUMN_ROWS) return null
  const rows: Record<string, unknown>[] = Array.from({ length: n }, () => ({}))
  for (const [key, column] of Object.entries(raw.cols)) {
    if (UNSAFE_KEYS.has(key)) return null
    if (Array.isArray(column)) {
      if (column.length !== n) return null
      for (let i = 0; i < n; i += 1) if (column[i] !== null) rows[i][key] = column[i]
      continue
    }
    if (!isRecord(column) || !Array.isArray(column.d) || !Array.isArray(column.i) || column.i.length !== n) return null
    const dictionary = column.d
    for (let i = 0; i < n; i += 1) {
      const at = column.i[i]
      if (at === -1) continue
      if (typeof at !== 'number' || !Number.isInteger(at) || at < 0 || at >= dictionary.length) return null
      rows[i][key] = dictionary[at]
    }
  }
  return rows
}

/* ---------------------------------------------------------------------------
 * Compact projection of a full hub (version 2).
 * ------------------------------------------------------------------------- */

// Screener v1 keeps only what "× usual" reads (state, N, now and the backend
// multiplier per metric). Flattened under keys the API never uses. A screener
// stream id equal to the row's own is stored as 0 and restored from the row.
const SV = { state: '~sv', reason: '~svr', minutes: '~svn', streamId: '~svs' } as const
const SM = {
  chat: { state: '~cs', reason: '~cr', now: '~cn', x: '~cx' },
  emotes: { state: '~es', reason: '~er', now: '~en', x: '~ex' },
} as const

function flattenScreenerV1(screener: HubChannelScreenerV1 | undefined, rowStreamId: string | undefined): Record<string, unknown> {
  if (!screener) return {}
  const flat: Record<string, unknown> = {
    [SV.state]: screener.state,
    [SV.reason]: screener.reason,
    [SV.minutes]: screener.baselineMeasuredMinutes,
    [SV.streamId]: screener.streamId !== undefined && screener.streamId === rowStreamId ? 0 : screener.streamId,
  }
  for (const metric of ['chat', 'emotes'] as const) {
    const m = screener[metric]
    if (!m) continue
    flat[SM[metric].state] = m.state
    flat[SM[metric].reason] = m.reason
    flat[SM[metric].now] = m.currentPerMin
    flat[SM[metric].x] = m.multiplier
  }
  return flat
}

function unflattenScreenerV1(row: Record<string, unknown>): void {
  const state = row[SV.state]
  const metric = (key: 'chat' | 'emotes') => {
    const keys = SM[key]
    const out = row[keys.state] === undefined ? null : {
      state: row[keys.state],
      reason: row[keys.reason],
      currentPerMin: row[keys.now],
      multiplier: row[keys.x] ?? null,
    }
    for (const k of Object.values(keys)) delete row[k]
    return out
  }
  const chat = metric('chat')
  const emotes = metric('emotes')
  if (state !== undefined) {
    // Validated again by normalizeHubChannelScreenerV1 inside normalizePublicHub.
    row.screenerV1 = {
      version: 1,
      baselineKind: 'current_stream_measured_average',
      state,
      reason: row[SV.reason],
      streamId: row[SV.streamId] === 0 ? row.streamId : row[SV.streamId],
      baselineMeasuredMinutes: row[SV.minutes] ?? null,
      currentWindow: null,
      baselineWindow: null,
      chat,
      emotes,
    }
  }
  for (const k of Object.values(SV)) delete row[k]
}

function busiestOrder(a: HubLiveChannel, b: HubLiveChannel): number {
  const rate = (c: HubLiveChannel) => Math.max(c.chatPerMin || 0, c.emotesPerMin || 0)
  return rate(b) - rate(a) || (b.viewers || 0) - (a.viewers || 0)
}

function compactLiveChannelRows(channels: readonly HubLiveChannel[], avatarRows: number): Record<string, unknown>[] {
  const keepAvatar = new Set<HubLiveChannel>([
    ...[...channels].sort(busiestOrder).slice(0, avatarRows),
    ...[...channels].sort((a, b) => (b.viewers || 0) - (a.viewers || 0)).slice(0, avatarRows),
  ])
  return channels.map((channel) => {
    const { screenerV1, profileImageUrl, ...rest } = channel
    return {
      ...rest,
      profileImageUrl: keepAvatar.has(channel) ? profileImageUrl : undefined,
      ...flattenScreenerV1(screenerV1, channel.streamId),
    }
  })
}

function compactPointRows(points: readonly HubActivityPoint[]): Record<string, unknown>[] {
  return points.map((point) => {
    const rest: Partial<HubActivityPoint> = { ...point }
    delete rest.topEmotes
    return rest
  })
}

interface PreparedCacheWrite {
  version: 1 | 2
  /** `"data":…` (and `,"columns":…`) plus the closing brace: the entry's stable tail. */
  tail: string
  generatedAt?: string
}

/**
 * One projection per hub object: a poll computes it once even when the write
 * is deferred or retried.
 */
const preparedFull = new WeakMap<PublicHub, PreparedCacheWrite | null>()

/** Rough plain-JSON size, so a 1 MB body is never stringified just to learn it is too big. */
function estimatePlainChars(data: PublicHub): number {
  let emoteRows = 0
  for (const point of data.activity.points) emoteRows += point.topEmotes?.length ?? 0
  let screenerRows = 0
  for (const channel of data.liveChannels) if (channel.screenerV1) screenerRows += 1
  return 20_000 +
    data.activity.points.length * 300 +
    emoteRows * 140 +
    data.liveChannels.length * 350 +
    screenerRows * 900 +
    data.livePulseMoments.length * 2_000
}

/** Plain when it fits the 150 KB bound, else the compact projection. */
function prepareCompactFullWrite(data: PublicHub): PreparedCacheWrite | null {
  if (estimatePlainChars(data) <= PUBLIC_HUB_CACHE_MAX_CHARS * 1.25) {
    const plain = JSON.stringify(data)
    if (plain.length <= PUBLIC_HUB_CACHE_MAX_CHARS - 512) {
      return { version: 1, tail: `"data":${plain}}`, generatedAt: data.generatedAt }
    }
  }
  const empty = normalizePublicHub(null)
  const shell = JSON.stringify({
    ...data,
    activity: { ...data.activity, points: [] },
    liveChannels: [],
    // The d3 hub reads network peaks; the featured fallback is kept only when there are none.
    featuredSession: data.livePulseMoments.length > 0 ? empty.featuredSession : data.featuredSession,
  } satisfies PublicHub)
  const points = JSON.stringify(encodeColumns(compactPointRows(data.activity.points)))
  // A busier day may not fit with avatars; the second try keeps none.
  for (const avatarRows of [COMPACT_AVATAR_ROWS, 0]) {
    const channels = JSON.stringify(encodeColumns(compactLiveChannelRows(data.liveChannels, avatarRows)))
    const tail = `"data":${shell},"columns":{"points":${points},"liveChannels":${channels}}}`
    if (tail.length <= PUBLIC_HUB_CACHE_MAX_CHARS - 512) {
      return { version: 2, tail, generatedAt: data.generatedAt }
    }
  }
  return null
}

function prepareFullWrite(data: PublicHub): PreparedCacheWrite | null {
  if (preparedFull.has(data)) return preparedFull.get(data) ?? null
  const prepared = prepareCompactFullWrite(data)
  preparedFull.set(data, prepared)
  return prepared
}

/** Size of the stored full-hub entry for `data` (null when it would not be stored). For evidence and tests. */
export function publicHubCacheEntrySize(
  data: PublicHub,
  activityWindow: PublicHubActivityWindow = '24h',
  backendUrl: string = getBackendUrl(),
): { version: 1 | 2; chars: number } | null {
  const prepared = prepareFullWrite(data)
  if (!prepared) return null
  const head = entryHead(prepared.version, Date.now(), normalizeBackendUrl(backendUrl), activityWindow, undefined, prepared.generatedAt)
  return { version: prepared.version, chars: head.length + prepared.tail.length }
}

function entryHead(
  version: 1 | 2,
  cachedAt: number,
  backendUrl: string,
  activityWindow: PublicHubActivityWindow,
  projection: PublicHubProjection | undefined,
  generatedAt: string | undefined,
): string {
  // Built by hand so `cachedAt` is always the second field: eviction reads it
  // from the prefix instead of parsing other entries.
  let head = `{"version":${version},"cachedAt":${cachedAt},"backendUrl":${JSON.stringify(backendUrl)},"activityWindow":${JSON.stringify(activityWindow)}`
  if (projection !== undefined) head += `,"projection":${JSON.stringify(projection)}`
  if (generatedAt !== undefined) head += `,"generatedAt":${JSON.stringify(generatedAt)}`
  return head + ','
}

const CACHED_AT_PREFIX = /^\{"version":\d+,"cachedAt":(\d+)/

function cachedAtFromPrefix(raw: string | null): number {
  if (!raw) return 0
  const match = CACHED_AT_PREFIX.exec(raw.slice(0, 64))
  return match ? Number(match[1]) || 0 : 0
}

export function readPublicHubCache(
  backendUrl: string,
  activityWindow: PublicHubActivityWindow,
  projection?: PublicHubProjection,
): { data: PublicHub; cachedAt: number; generatedAt?: string; stale: boolean } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(publicHubCacheKey(backendUrl, activityWindow, projection))
    if (!raw || raw.length > (projection ? PUBLIC_HUB_PROJECTION_CACHE_MAX_CHARS : PUBLIC_HUB_CACHE_MAX_CHARS)) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    // Version 2 (the compact projection) is a full-hub entry only.
    if (parsed.version !== 1 && !(parsed.version === 2 && !projection)) return null
    if (parsed.backendUrl !== normalizeBackendUrl(backendUrl)) return null
    if (parsed.activityWindow !== activityWindow) return null
    if (parsed.projection !== projection) return null
    if (typeof parsed.cachedAt !== 'number' || !Number.isFinite(parsed.cachedAt)) return null
    if (parsed.cachedAt <= 0 || parsed.cachedAt > Date.now() + 60_000) return null
    if (!hasUsableHubShape(parsed.data)) return null

    let input = parsed.data as Partial<PublicHub>
    if (parsed.version === 2) {
      if (!isRecord(parsed.columns)) return null
      const points = decodeColumns(parsed.columns.points)
      const channels = decodeColumns(parsed.columns.liveChannels)
      if (!points || !channels) return null
      channels.forEach(unflattenScreenerV1)
      const activity = isRecord(input.activity) ? input.activity : {}
      input = {
        ...input,
        activity: { ...activity, points: points as unknown as HubActivityPoint[] } as PublicHub['activity'],
        liveChannels: channels as unknown as HubLiveChannel[],
      }
    }

    const data = normalizePublicHub(input)
    // Do not hydrate a legacy long-window payload whose raw points contradict
    // its advertised served window. The next network load will fetch a fresh
    // canonical short fallback instead of briefly repainting stale plateaus.
    if (hubActivityContractIssues(data.activity).length > 0) return null
    const cachedAt = parsed.cachedAt
    const generatedAt = typeof parsed.generatedAt === 'string' ? parsed.generatedAt : data.generatedAt
    const stale = Date.now() - cachedAt > (projection ? PUBLIC_HUB_CACHE_STALE_MS : PUBLIC_HUB_CACHE_HUB_STALE_MS)
    if (stale) return null
    return { data, cachedAt, generatedAt, stale }
  } catch {
    return null
  }
}

/**
 * Keep only the lanes a projected page renders, mirroring the backend
 * `include=` projection. Older hosted backends ignore `include` and return the
 * full hub; persisting that body would exceed the projection bound and
 * silently disable first-paint hydration.
 */
export function projectPublicHubForCache(data: PublicHub, projection: PublicHubProjection): PublicHub {
  const empty = normalizePublicHub(null)
  const projected: PublicHub = {
    ...data,
    ingest: undefined,
    activity: { ...data.activity, points: [] },
    emoteIntel: empty.emoteIntel,
    topEmotes: [],
    topMovers: [],
    liveChannels: [],
    moments: [],
    liveActivity: undefined,
    featuredSession: empty.featuredSession,
    emoteMarket: undefined,
    publicClips: undefined,
  }
  if (projection === 'tickers') {
    return {
      ...projected,
      topEmotes: data.topEmotes,
      topMovers: data.topMovers,
      livePulseMoments: [],
      livePulseMomentsScope: undefined,
      livePulseMomentsStatus: undefined,
      livePulseMomentsReason: undefined,
    }
  }
  if (data.livePulseMoments.length > 0) return projected
  // Keep the featured/legacy fallback inputs when network peaks are empty.
  const fallbackLogins = new Set(
    [data.featuredSession.login, ...data.moments.map((moment) => moment.login)]
      .map((login) => login?.trim().toLowerCase())
      .filter((login): login is string => Boolean(login)),
  )
  return {
    ...projected,
    featuredSession: data.featuredSession,
    moments: data.moments,
    liveChannels: data.liveChannels.filter((channel) => fallbackLogins.has(channel.login.trim().toLowerCase())),
  }
}

function prepareWrite(fullData: PublicHub, projection?: PublicHubProjection): PreparedCacheWrite | null {
  if (!projection) return prepareFullWrite(fullData)
  const data = projectPublicHubForCache(fullData, projection)
  const serialized = JSON.stringify(data)
  if (serialized.length > PUBLIC_HUB_PROJECTION_CACHE_MAX_CHARS - 512) return null
  return { version: 1, tail: `"data":${serialized}}`, generatedAt: data.generatedAt }
}

export function writePublicHubCache(
  backendUrl: string,
  activityWindow: PublicHubActivityWindow,
  fullData: PublicHub,
  projection?: PublicHubProjection,
): void {
  if (typeof window === 'undefined' || publicHubCacheWritesStopped()) return
  try {
    const prepared = prepareWrite(fullData, projection)
    if (!prepared) return
    const key = publicHubCacheKey(backendUrl, activityWindow, projection)
    // Avoid storage rewrites for an unchanged network snapshot. A stale
    // timestamp stays stale; receipt time must not invent source freshness.
    if (window.localStorage.getItem(key)?.endsWith(prepared.tail)) return
    const serialized = entryHead(
      prepared.version,
      Date.now(),
      normalizeBackendUrl(backendUrl),
      activityWindow,
      projection,
      prepared.generatedAt,
    ) + prepared.tail
    if (serialized.length > (projection ? PUBLIC_HUB_PROJECTION_CACHE_MAX_CHARS : PUBLIC_HUB_CACHE_MAX_CHARS)) return
    const otherEntries: { key: string; cachedAt: number }[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const otherKey = window.localStorage.key(i)
      if (!otherKey?.startsWith(projection ? PROJECTION_STORAGE_PREFIX : STORAGE_PREFIX) || otherKey === key) continue
      // Never parse the other entries: their cachedAt is in the fixed prefix.
      otherEntries.push({ key: otherKey, cachedAt: cachedAtFromPrefix(window.localStorage.getItem(otherKey)) })
    }
    otherEntries.sort((a, b) => b.cachedAt - a.cachedAt)
    for (const old of otherEntries.slice(PUBLIC_HUB_CACHE_MAX_ENTRIES - 1)) {
      window.localStorage.removeItem(old.key)
    }
    window.localStorage.setItem(key, serialized)
  } catch {
    // Quota / private mode — ignore.
  }
}

/* ---------------------------------------------------------------------------
 * Idle persistence (plan §2.6): the hook schedules; the write runs in idle
 * time (2 s timeout) and waits while a chart gesture is in progress.
 * ------------------------------------------------------------------------- */

interface PendingCacheWrite {
  backendUrl: string
  activityWindow: PublicHubActivityWindow
  data: PublicHub
  projection?: PublicHubProjection
}

type IdleHandle = { kind: 'idle'; id: number } | { kind: 'timeout'; id: number }

/** While a gesture is active, look again after this long (then wait for idle again). */
const GESTURE_RETRY_MS = 250

const pendingWrites = new Map<string, PendingCacheWrite>()
let idleHandle: IdleHandle | null = null
let gestureRetryTimer: number | null = null

function requestIdle(run: () => void): IdleHandle {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number
  }
  if (typeof w.requestIdleCallback === 'function') {
    return { kind: 'idle', id: w.requestIdleCallback(run, { timeout: PUBLIC_HUB_CACHE_IDLE_TIMEOUT_MS }) }
  }
  // Safari has no requestIdleCallback: a short timer still keeps the write out of the commit.
  return { kind: 'timeout', id: window.setTimeout(run, 50) }
}

function cancelScheduledWrites(): void {
  if (typeof window === 'undefined') return
  const w = window as Window & { cancelIdleCallback?: (id: number) => void }
  if (idleHandle?.kind === 'idle') w.cancelIdleCallback?.(idleHandle.id)
  else if (idleHandle) window.clearTimeout(idleHandle.id)
  if (gestureRetryTimer != null) window.clearTimeout(gestureRetryTimer)
  idleHandle = null
  gestureRetryTimer = null
}

function ensureWriteScheduled(): void {
  if (idleHandle || gestureRetryTimer != null || pendingWrites.size === 0) return
  let ran = false
  const handle = requestIdle(() => {
    ran = true
    idleHandle = null
    runPendingWrites()
  })
  // A synchronous scheduler may already have run the writes.
  if (!ran) idleHandle = handle
}

function runPendingWrites(): void {
  if (pendingWrites.size === 0) return
  if (isHubGestureActive()) {
    // Never inside a wheel or drag: look again shortly, then wait for idle.
    gestureRetryTimer = window.setTimeout(() => {
      gestureRetryTimer = null
      ensureWriteScheduled()
    }, GESTURE_RETRY_MS)
    return
  }
  const writes = [...pendingWrites.values()]
  pendingWrites.clear()
  for (const write of writes) {
    writePublicHubCache(write.backendUrl, write.activityWindow, write.data, write.projection)
  }
}

/**
 * Persist a committed snapshot in idle time. A newer snapshot for the same
 * key replaces a pending one, so at most one projection runs per key.
 */
export function schedulePublicHubCacheWrite(
  activityWindow: PublicHubActivityWindow,
  data: PublicHub,
  projection?: PublicHubProjection,
): void {
  if (typeof window === 'undefined' || publicHubCacheWritesStopped()) return
  const backendUrl = getBackendUrl()
  pendingWrites.set(publicHubCacheKey(backendUrl, activityWindow, projection), { backendUrl, activityWindow, data, projection })
  ensureWriteScheduled()
}

/** True while a scheduled snapshot has not been written yet. */
export function hasPendingPublicHubCacheWrite(): boolean {
  return pendingWrites.size > 0
}

/** Test helper: run pending writes now (still deferred while a gesture is active). */
export function flushPublicHubCacheWritesForTests(): void {
  cancelScheduledWrites()
  runPendingWrites()
}

/** Test helper — clears all public hub cache entries and allows saving again. */
export function clearPublicHubCacheForTests(): void {
  allowPublicHubCacheWritesForTests()
  clearPublicHubCache()
  pendingWrites.clear()
  cancelScheduledWrites()
}

export function readPublicHubCacheForCurrentBackend(
  activityWindow: PublicHubActivityWindow,
  projection?: PublicHubProjection,
): ReturnType<typeof readPublicHubCache> {
  return readPublicHubCache(getBackendUrl(), activityWindow, projection)
}
