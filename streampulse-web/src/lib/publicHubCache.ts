import { getBackendUrl } from './apiClient'
import { hasPublicHubResponseShape, normalizePublicHub, type PublicHub, type PublicHubActivityWindow, type PublicHubProjection } from './publicHub'
import { hubActivityContractIssues } from './hubActivityHonesty'

/** Staleness hint only — cached data may still render while refreshing. */
export const PUBLIC_HUB_CACHE_STALE_MS = 10 * 60 * 1000

const STORAGE_PREFIX = 'sp:publicHub:v1:'
const PROJECTION_STORAGE_PREFIX = 'sp:publicHubProjection:v1:'
export const PUBLIC_HUB_CACHE_MAX_CHARS = 750_000
const PUBLIC_HUB_PROJECTION_CACHE_MAX_CHARS = 100_000
export const PUBLIC_HUB_CACHE_MAX_ENTRIES = 2

export interface PublicHubCacheEntry {
  version: 1
  cachedAt: number
  backendUrl: string
  activityWindow: PublicHubActivityWindow
  projection?: PublicHubProjection
  generatedAt?: string
  data: PublicHub
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
    if (parsed.version !== 1) return null
    if (parsed.backendUrl !== normalizeBackendUrl(backendUrl)) return null
    if (parsed.activityWindow !== activityWindow) return null
    if (parsed.projection !== projection) return null
    if (typeof parsed.cachedAt !== 'number' || !Number.isFinite(parsed.cachedAt)) return null
    if (parsed.cachedAt <= 0 || parsed.cachedAt > Date.now() + 60_000) return null
    if (!hasUsableHubShape(parsed.data)) return null

    const data = normalizePublicHub(parsed.data as Partial<PublicHub>)
    // Do not hydrate a legacy long-window payload whose raw points contradict
    // its advertised served window. The next network load will fetch a fresh
    // canonical short fallback instead of briefly repainting stale plateaus.
    if (hubActivityContractIssues(data.activity).length > 0) return null
    const cachedAt = parsed.cachedAt
    const generatedAt = typeof parsed.generatedAt === 'string' ? parsed.generatedAt : data.generatedAt
    const stale = Date.now() - cachedAt > PUBLIC_HUB_CACHE_STALE_MS
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

export function writePublicHubCache(
  backendUrl: string,
  activityWindow: PublicHubActivityWindow,
  fullData: PublicHub,
  projection?: PublicHubProjection,
): void {
  if (typeof window === 'undefined') return
  try {
    const data = projection ? projectPublicHubForCache(fullData, projection) : fullData
    const key = publicHubCacheKey(backendUrl, activityWindow, projection)
    const serializedData = JSON.stringify(data)
    const maxChars = projection ? PUBLIC_HUB_PROJECTION_CACHE_MAX_CHARS : PUBLIC_HUB_CACHE_MAX_CHARS
    if (serializedData.length > maxChars - 512) return
    const previous = window.localStorage.getItem(key)
    // Avoid synchronous storage rewrites for an unchanged network snapshot.
    // A stale timestamp stays stale; receipt time must not invent source freshness.
    if (previous?.endsWith(`"data":${serializedData}}`)) return
    const entry: PublicHubCacheEntry = {
      version: 1,
      cachedAt: Date.now(),
      backendUrl: normalizeBackendUrl(backendUrl),
      activityWindow,
      projection,
      generatedAt: data.generatedAt,
      data,
    }
    const serialized = JSON.stringify(entry)
    if (serialized.length > maxChars) return
    const otherEntries: { key: string; cachedAt: number }[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const otherKey = window.localStorage.key(i)
      if (!otherKey?.startsWith(projection ? PROJECTION_STORAGE_PREFIX : STORAGE_PREFIX) || otherKey === key) continue
      let cachedAt = 0
      try { cachedAt = Number(JSON.parse(window.localStorage.getItem(otherKey) ?? '{}').cachedAt) || 0 } catch { /* discard malformed cache */ }
      otherEntries.push({ key: otherKey, cachedAt })
    }
    otherEntries.sort((a, b) => b.cachedAt - a.cachedAt)
    for (const old of otherEntries.slice(PUBLIC_HUB_CACHE_MAX_ENTRIES - 1)) window.localStorage.removeItem(old.key)
    window.localStorage.setItem(key, serialized)
  } catch {
    // Quota / private mode — ignore.
  }
}

/** Test helper — clears all public hub cache entries. */
export function clearPublicHubCacheForTests(): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  const keys: string[] = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i)
    if (key?.startsWith(STORAGE_PREFIX) || key?.startsWith(PROJECTION_STORAGE_PREFIX)) keys.push(key)
  }
  keys.forEach((key) => window.localStorage.removeItem(key))
}

export function readPublicHubCacheForCurrentBackend(
  activityWindow: PublicHubActivityWindow,
  projection?: PublicHubProjection,
): ReturnType<typeof readPublicHubCache> {
  return readPublicHubCache(getBackendUrl(), activityWindow, projection)
}

export function writePublicHubCacheForCurrentBackend(
  activityWindow: PublicHubActivityWindow,
  data: PublicHub,
  projection?: PublicHubProjection,
): void {
  writePublicHubCache(getBackendUrl(), activityWindow, data, projection)
}
