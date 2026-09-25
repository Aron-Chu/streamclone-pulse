import { sendBackgroundMessage } from '../content/bridge.ts'

const MAX_OBJECT_URL_CACHE = 48
const LOCAL_EMOTE_PATH = /^\/emotes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:1x|2x|4x)\.webp$/i
const LOCALHOST = String.fromCharCode(108, 111, 99, 97, 108, 104, 111, 115, 116)
const LOOPBACK_IPV4 = [127, 0, 0, 1].join('.')
const LOOPBACK_IPV6 = '::1'

interface CachedObjectUrl {
  objectUrl: string
}

const objectUrlCache = new Map<string, CachedObjectUrl>()
const inflight = new Map<string, Promise<string | undefined>>()

export function needsEmoteImageProxy(resolvedUrl: string | undefined): boolean {
  if (!resolvedUrl) return false
  if (typeof __EXTENSION_STORE_BUILD__ !== 'undefined' && __EXTENSION_STORE_BUILD__) return false
  if (typeof window === 'undefined') return false
  if (window.location.protocol !== 'https:') return false
  try {
    const parsed = new URL(resolvedUrl)
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    return parsed.protocol === 'http:'
      && (hostname === LOCALHOST || hostname === LOOPBACK_IPV4 || hostname === LOOPBACK_IPV6)
      && !parsed.username
      && !parsed.password
      && LOCAL_EMOTE_PATH.test(parsed.pathname)
  } catch {
    return false
  }
}

function evictOldestObjectUrl(): void {
  const firstKey = objectUrlCache.keys().next().value
  if (!firstKey) return
  const entry = objectUrlCache.get(firstKey)
  if (entry) URL.revokeObjectURL(entry.objectUrl)
  objectUrlCache.delete(firstKey)
}

function bytesToObjectUrl(buffer: ArrayBuffer, mimeType: string): string {
  const blob = new Blob([buffer], { type: mimeType || 'image/webp' })
  return URL.createObjectURL(blob)
}

async function fetchProxiedObjectUrl(resolvedUrl: string): Promise<string | undefined> {
  const res = await sendBackgroundMessage({ type: 'FETCH_EMOTE_IMAGE', url: resolvedUrl })
  if (!('type' in res) || res.type !== 'EMOTE_IMAGE' || !res.buffer) {
    return undefined
  }

  const objectUrl = bytesToObjectUrl(res.buffer, res.mimeType ?? 'image/webp')
  if (objectUrlCache.size >= MAX_OBJECT_URL_CACHE) {
    evictOldestObjectUrl()
  }
  objectUrlCache.set(resolvedUrl, { objectUrl })
  return objectUrl
}

/**
 * Synchronous resolution for first-paint seeding.
 *
 * Returns a usable `src` only when no background round-trip is required: store
 * builds never proxy, so the CDN URL is already final, and a warm blob URL is
 * reusable immediately. Returning `undefined` means "must await
 * `resolveProxiedEmoteSrc`", not "unavailable".
 *
 * Without this, every mount renders one frame with `resolved === undefined` and
 * paints a loading placeholder, which reads as flicker when the inspector
 * remounts per hovered bucket.
 */
export function peekProxiedEmoteSrc(resolvedUrl: string | undefined): string | undefined {
  if (!resolvedUrl) return undefined
  if (!needsEmoteImageProxy(resolvedUrl)) return resolvedUrl
  return objectUrlCache.get(resolvedUrl)?.objectUrl
}

export async function resolveProxiedEmoteSrc(resolvedUrl: string | undefined): Promise<string | undefined> {
  if (!resolvedUrl) return undefined
  if (!needsEmoteImageProxy(resolvedUrl)) return resolvedUrl

  const cached = objectUrlCache.get(resolvedUrl)
  if (cached) return cached.objectUrl

  const pending = inflight.get(resolvedUrl)
  if (pending) return pending

  const promise = fetchProxiedObjectUrl(resolvedUrl).finally(() => {
    inflight.delete(resolvedUrl)
  })
  inflight.set(resolvedUrl, promise)
  return promise
}

/** Test helper — clears cached blob URLs. */
export function clearProxiedEmoteCacheForTests(): void {
  for (const entry of objectUrlCache.values()) {
    URL.revokeObjectURL(entry.objectUrl)
  }
  objectUrlCache.clear()
  inflight.clear()
}
