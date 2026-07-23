/**
 * Hardened emote-image fetch for the extension service worker.
 * Content scripts must not fetch CDN bytes directly — they message the SW.
 */

/** Reject declared or buffered bodies larger than this (5 MiB). */
export const EMOTE_IMAGE_MAX_BYTES = 5 * 1024 * 1024
/** Total byte budget for the in-memory SW emote cache (12 MiB). */
export const EMOTE_CACHE_MAX_TOTAL_BYTES = 12 * 1024 * 1024
/** Abort stalled CDN fetches. */
export const EMOTE_IMAGE_TIMEOUT_MS = 10_000

const APPROVED_EMOTE_HOSTS = new Set([
  'cdn.7tv.app',
  'static-cdn.jtvnw.net',
  'cdn.frankerfacez.com',
])

interface CachedEmoteBytes {
  mimeType: string
  buffer: ArrayBuffer
  byteLength: number
}

const emoteBytesCache = new Map<string, CachedEmoteBytes>()
const emoteInFlight = new Map<string, Promise<EmoteImageBytes>>()
let emoteCacheTotalBytes = 0

export interface EmoteImageBytes {
  mimeType: string
  buffer: ArrayBuffer
}

export function isApprovedEmoteImageUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return false
    if (url.username || url.password) return false
    return APPROVED_EMOTE_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

function isImageMime(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('image/')
}

function touchCacheEntry(url: string, entry: CachedEmoteBytes): void {
  emoteBytesCache.delete(url)
  emoteBytesCache.set(url, entry)
}

function evictUntilWithinBudget(incomingBytes: number): void {
  const limit = Math.max(0, EMOTE_CACHE_MAX_TOTAL_BYTES - incomingBytes)
  while (emoteCacheTotalBytes > limit && emoteBytesCache.size > 0) {
    const firstKey = emoteBytesCache.keys().next().value
    if (!firstKey) break
    const stale = emoteBytesCache.get(firstKey)
    emoteBytesCache.delete(firstKey)
    if (stale) {
      emoteCacheTotalBytes = Math.max(0, emoteCacheTotalBytes - stale.byteLength)
    }
  }
}

function putCacheEntry(url: string, mimeType: string, buffer: ArrayBuffer): void {
  const byteLength = buffer.byteLength
  const existing = emoteBytesCache.get(url)
  if (existing) {
    emoteCacheTotalBytes = Math.max(0, emoteCacheTotalBytes - existing.byteLength)
    emoteBytesCache.delete(url)
  }
  evictUntilWithinBudget(byteLength)
  emoteBytesCache.set(url, { mimeType, buffer, byteLength })
  emoteCacheTotalBytes += byteLength
}

/** Test helper — clears the SW emote byte cache and in-flight map. */
export function clearEmoteImageCacheForTests(): void {
  emoteBytesCache.clear()
  emoteInFlight.clear()
  emoteCacheTotalBytes = 0
}

/** Test helper — current cache occupancy in bytes. */
export function emoteImageCacheTotalBytesForTests(): number {
  return emoteCacheTotalBytes
}

async function fetchEmoteImageBytesUncached(
  url: string,
  options?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<EmoteImageBytes> {
  const fetchImpl = options?.fetchImpl ?? fetch
  const timeoutMs = options?.timeoutMs ?? EMOTE_IMAGE_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetchImpl(url, { signal: controller.signal, redirect: 'error' })
    if (!res.ok) {
      throw new Error(`emote_image_${res.status}`)
    }

    const contentLength = res.headers.get('content-length')
    if (contentLength != null) {
      const declared = Number(contentLength)
      if (Number.isFinite(declared) && declared > EMOTE_IMAGE_MAX_BYTES) {
        throw new Error('emote_image_too_large')
      }
    }

    const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || ''
    if (!isImageMime(mimeType)) {
      throw new Error('emote_image_mime_rejected')
    }

    const buffer = await res.arrayBuffer()
    if (buffer.byteLength > EMOTE_IMAGE_MAX_BYTES) {
      throw new Error('emote_image_too_large')
    }

    putCacheEntry(url, mimeType, buffer)
    return { mimeType, buffer }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('emote_image_timeout')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchEmoteImageBytes(
  url: string,
  options?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<EmoteImageBytes> {
  if (!isApprovedEmoteImageUrl(url)) {
    throw new Error('emote_image_host_rejected')
  }

  const cached = emoteBytesCache.get(url)
  if (cached) {
    touchCacheEntry(url, cached)
    return { mimeType: cached.mimeType, buffer: cached.buffer }
  }

  const existing = emoteInFlight.get(url)
  if (existing) {
    return existing
  }

  const pending = fetchEmoteImageBytesUncached(url, options).finally(() => {
    emoteInFlight.delete(url)
  })
  emoteInFlight.set(url, pending)
  return pending
}
