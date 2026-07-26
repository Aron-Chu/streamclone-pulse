import { getBackendUrl } from './apiClient'
import { normalizePublicHub, type PublicHub, type PublicHubActivityWindow } from './publicHub'

/** Staleness hint only — cached data may still render while refreshing. */
export const PUBLIC_HUB_CACHE_STALE_MS = 10 * 60 * 1000

const STORAGE_PREFIX = 'sp:publicHub:v1:'

export interface PublicHubCacheEntry {
  version: 1
  cachedAt: number
  backendUrl: string
  activityWindow: PublicHubActivityWindow
  generatedAt?: string
  data: PublicHub
}

function normalizeBackendUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function publicHubCacheKey(backendUrl: string, activityWindow: PublicHubActivityWindow): string {
  return `${STORAGE_PREFIX}${normalizeBackendUrl(backendUrl)}:${activityWindow}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasUsableHubShape(raw: unknown): raw is Partial<PublicHub> {
  if (!isRecord(raw)) return false
  const activity = raw.activity
  if (isRecord(activity) && Array.isArray(activity.points)) return true
  if (Array.isArray(raw.liveChannels) && raw.liveChannels.length > 0) return true
  if (isRecord(raw.corpus) && typeof raw.corpus.streamsTracked === 'number') return true
  return false
}

export function readPublicHubCache(
  backendUrl: string,
  activityWindow: PublicHubActivityWindow,
): { data: PublicHub; cachedAt: number; generatedAt?: string; stale: boolean } | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    const raw = window.localStorage.getItem(publicHubCacheKey(backendUrl, activityWindow))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    if (parsed.version !== 1) return null
    if (parsed.backendUrl !== normalizeBackendUrl(backendUrl)) return null
    if (parsed.activityWindow !== activityWindow) return null
    if (typeof parsed.cachedAt !== 'number' || !Number.isFinite(parsed.cachedAt)) return null
    if (!hasUsableHubShape(parsed.data)) return null

    const data = normalizePublicHub(parsed.data as Partial<PublicHub>)
    const cachedAt = parsed.cachedAt
    const generatedAt = typeof parsed.generatedAt === 'string' ? parsed.generatedAt : data.generatedAt
    const stale = Date.now() - cachedAt > PUBLIC_HUB_CACHE_STALE_MS
    if (stale) return null
    return { data, cachedAt, generatedAt, stale }
  } catch {
    return null
  }
}

export function writePublicHubCache(
  backendUrl: string,
  activityWindow: PublicHubActivityWindow,
  data: PublicHub,
): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const entry: PublicHubCacheEntry = {
      version: 1,
      cachedAt: Date.now(),
      backendUrl: normalizeBackendUrl(backendUrl),
      activityWindow,
      generatedAt: data.generatedAt,
      data,
    }
    window.localStorage.setItem(publicHubCacheKey(backendUrl, activityWindow), JSON.stringify(entry))
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
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key)
  }
  keys.forEach((key) => window.localStorage.removeItem(key))
}

export function readPublicHubCacheForCurrentBackend(
  activityWindow: PublicHubActivityWindow,
): ReturnType<typeof readPublicHubCache> {
  return readPublicHubCache(getBackendUrl(), activityWindow)
}

export function writePublicHubCacheForCurrentBackend(
  activityWindow: PublicHubActivityWindow,
  data: PublicHub,
): void {
  writePublicHubCache(getBackendUrl(), activityWindow, data)
}
