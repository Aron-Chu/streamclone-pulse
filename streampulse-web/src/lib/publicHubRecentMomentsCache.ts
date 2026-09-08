import { getBackendUrl } from './momentsApiClient'
import {
  normalizePublicHubRecentMoments,
  type PublicHubRecentMomentsResponse,
} from './publicHub'

const STORAGE_PREFIX = 'sp:publicHubRecentMoments:v1:'
const STALE_MS = 10 * 60 * 1000
const MAX_CHARS = 256 * 1024

interface RecentMomentsCacheEntry {
  version: 1
  cachedAt: number
  backendUrl: string
  data: PublicHubRecentMomentsResponse
}

function normalizedBackendUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function publicHubRecentMomentsCacheKey(backendUrl: string): string {
  return `${STORAGE_PREFIX}${normalizedBackendUrl(backendUrl)}`
}

export function readPublicHubRecentMomentsCache(
  backendUrl = getBackendUrl(),
): { data: PublicHubRecentMomentsResponse; cachedAt: number } | null {
  if (typeof window === 'undefined') return null
  try {
    const normalizedBackend = normalizedBackendUrl(backendUrl)
    const raw = window.localStorage.getItem(publicHubRecentMomentsCacheKey(normalizedBackend))
    if (!raw || raw.length > MAX_CHARS) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const entry = parsed as Partial<RecentMomentsCacheEntry>
    if (entry.version !== 1 || entry.backendUrl !== normalizedBackend) return null
    if (typeof entry.cachedAt !== 'number' || !Number.isFinite(entry.cachedAt)) return null
    if (entry.cachedAt <= 0 || entry.cachedAt > Date.now() + 60_000 || Date.now() - entry.cachedAt > STALE_MS) return null
    if (!entry.data || typeof entry.data !== 'object' || !Array.isArray(entry.data.moments)) return null
    return { data: normalizePublicHubRecentMoments(entry.data), cachedAt: entry.cachedAt }
  } catch {
    return null
  }
}

export function writePublicHubRecentMomentsCache(
  data: PublicHubRecentMomentsResponse,
  backendUrl = getBackendUrl(),
): void {
  if (typeof window === 'undefined') return
  try {
    const normalizedBackend = normalizedBackendUrl(backendUrl)
    // A handoff reference is re-issued by the exact source check. It is not
    // durable display metadata and must not be persisted in this public cache.
    const safe = normalizePublicHubRecentMoments({
      ...data,
      moments: data.moments.map(({ handoffRef: _handoffRef, ...moment }) => moment),
    })
    const entry: RecentMomentsCacheEntry = {
      version: 1,
      cachedAt: Date.now(),
      backendUrl: normalizedBackend,
      data: safe,
    }
    const serialized = JSON.stringify(entry)
    if (serialized.length > MAX_CHARS) return
    window.localStorage.setItem(publicHubRecentMomentsCacheKey(normalizedBackend), serialized)
  } catch {
    // Storage can be unavailable or full; network loading remains functional.
  }
}

export function clearPublicHubRecentMomentsCacheForTests(): void {
  if (typeof window === 'undefined') return
  const keys: string[] = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key)
  }
  keys.forEach(key => window.localStorage.removeItem(key))
}
