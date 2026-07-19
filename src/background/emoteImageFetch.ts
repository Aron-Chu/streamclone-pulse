/**
 * Hardened emote-image fetch for the extension service worker.
 * Content scripts must not fetch CDN bytes directly — they message the SW.
 */

const MAX_CACHE = 48
/** Reject declared or buffered bodies larger than this (5 MiB). */
export const EMOTE_IMAGE_MAX_BYTES = 5 * 1024 * 1024
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
}

const emoteBytesCache = new Map<string, CachedEmoteBytes>()

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

/** Test helper — clears the SW emote byte cache. */
export function clearEmoteImageCacheForTests(): void {
  emoteBytesCache.clear()
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
    return { mimeType: cached.mimeType, buffer: cached.buffer }
  }

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

    if (emoteBytesCache.size >= MAX_CACHE) {
      const firstKey = emoteBytesCache.keys().next().value
      if (firstKey) emoteBytesCache.delete(firstKey)
    }
    emoteBytesCache.set(url, { mimeType, buffer })

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
