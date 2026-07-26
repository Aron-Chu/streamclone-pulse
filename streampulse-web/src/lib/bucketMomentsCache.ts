import type { FigmaMomentRow } from './figmaSessionAnalytics'
import { getBackendUrl } from './apiClient'
import type { PublicHubActivityWindow } from './publicHub'

/** Ready bucket entries may render from cache while refreshing. */
export const BUCKET_MOMENTS_CACHE_READY_MS = 30 * 60 * 1000
/** Empty bucket entries expire quickly — corpus may backfill. */
export const BUCKET_MOMENTS_CACHE_EMPTY_MS = 2 * 60 * 1000

const STORAGE_PREFIX = 'sp:bucketMoments:v1:'
const memory = new Map<string, BucketMomentsCacheEntry>()

interface BucketMomentsCacheEntry {
  version: 1
  cachedAt: number
  backendUrl: string
  activityWindow: PublicHubActivityWindow
  bucketT: number
  moments: FigmaMomentRow[]
  empty: boolean
}

function normalizeBackendUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function bucketMomentsCacheKey(
  bucketT: number,
  activityWindow: PublicHubActivityWindow,
  backendUrl: string = getBackendUrl(),
): string {
  return `${normalizeBackendUrl(backendUrl)}:${activityWindow}:${bucketT}`
}

function storageKey(
  bucketT: number,
  activityWindow: PublicHubActivityWindow,
  backendUrl: string = getBackendUrl(),
): string {
  return `${STORAGE_PREFIX}${bucketMomentsCacheKey(bucketT, activityWindow, backendUrl)}`
}

function ttlForEntry(entry: BucketMomentsCacheEntry): number {
  return entry.empty ? BUCKET_MOMENTS_CACHE_EMPTY_MS : BUCKET_MOMENTS_CACHE_READY_MS
}

function entryFresh(entry: BucketMomentsCacheEntry, now = Date.now()): boolean {
  return now-entry.cachedAt <= ttlForEntry(entry)
}

function parseStorageEntry(raw: string): BucketMomentsCacheEntry | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const entry = parsed as Partial<BucketMomentsCacheEntry>
    if (entry.version !== 1) return null
    if (entry.backendUrl !== normalizeBackendUrl(getBackendUrl())) return null
    if (typeof entry.activityWindow !== 'string') return null
    if (typeof entry.bucketT !== 'number' || !Number.isFinite(entry.bucketT)) return null
    if (typeof entry.cachedAt !== 'number' || !Number.isFinite(entry.cachedAt)) return null
    if (!Array.isArray(entry.moments)) return null
    return entry as BucketMomentsCacheEntry
  } catch {
    return null
  }
}

function readStorageEntry(
  bucketT: number,
  activityWindow: PublicHubActivityWindow,
): BucketMomentsCacheEntry | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null
  try {
    const raw = window.sessionStorage.getItem(storageKey(bucketT, activityWindow))
    if (!raw) return null
    const entry = parseStorageEntry(raw)
    if (!entry || entry.activityWindow !== activityWindow || entry.bucketT !== bucketT) return null
    if (!entryFresh(entry)) {
      window.sessionStorage.removeItem(storageKey(bucketT, activityWindow))
      return null
    }
    return entry
  } catch {
    return null
  }
}

function writeStorageEntry(entry: BucketMomentsCacheEntry): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return
  try {
    window.sessionStorage.setItem(
      storageKey(entry.bucketT, entry.activityWindow, entry.backendUrl),
      JSON.stringify(entry),
    )
  } catch {
    /* quota / private mode */
  }
}

function readEntry(
  bucketT: number,
  activityWindow: PublicHubActivityWindow,
): BucketMomentsCacheEntry | null {
  const key = bucketMomentsCacheKey(bucketT, activityWindow)
  const fromMemory = memory.get(key)
  if (fromMemory) {
    if (!entryFresh(fromMemory)) {
      memory.delete(key)
      return null
    }
    return fromMemory
  }

  const stored = readStorageEntry(bucketT, activityWindow)
  if (!stored) return null
  memory.set(key, stored)
  return stored
}

export function hasBucketMomentsCache(
  bucketT: number,
  activityWindow: PublicHubActivityWindow,
): boolean {
  return readEntry(bucketT, activityWindow) != null
}

export function readBucketMomentsCache(
  bucketT: number,
  activityWindow: PublicHubActivityWindow,
): FigmaMomentRow[] | undefined {
  return readEntry(bucketT, activityWindow)?.moments
}

export function writeBucketMomentsCache(
  bucketT: number,
  activityWindow: PublicHubActivityWindow,
  moments: FigmaMomentRow[],
): void {
  const entry: BucketMomentsCacheEntry = {
    version: 1,
    cachedAt: Date.now(),
    backendUrl: normalizeBackendUrl(getBackendUrl()),
    activityWindow,
    bucketT,
    moments,
    empty: moments.length === 0,
  }
  const key = bucketMomentsCacheKey(bucketT, activityWindow)
  memory.set(key, entry)
  writeStorageEntry(entry)
}

/** Test-only — clears in-memory L1 only (sessionStorage preserved). */
export function clearBucketMomentsMemoryForTests(): void {
  memory.clear()
}

/** Test-only — clears memory and sessionStorage bucket cache entries. */
export function clearBucketMomentsCache(): void {
  memory.clear()
  if (typeof window === 'undefined' || !window.sessionStorage) return
  const keys: string[] = []
  for (let i = 0; i < window.sessionStorage.length; i++) {
    const key = window.sessionStorage.key(i)
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key)
  }
  keys.forEach((key) => window.sessionStorage.removeItem(key))
}
