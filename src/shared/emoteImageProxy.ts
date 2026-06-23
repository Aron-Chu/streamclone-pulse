import { sendBackgroundMessage } from '../content/bridge.ts'

const MAX_OBJECT_URL_CACHE = 48

interface CachedObjectUrl {
  objectUrl: string
}

const objectUrlCache = new Map<string, CachedObjectUrl>()
const inflight = new Map<string, Promise<string | undefined>>()

export function needsEmoteImageProxy(resolvedUrl: string | undefined): boolean {
  if (!resolvedUrl) return false
  if (typeof window === 'undefined') return false
  if (window.location.protocol !== 'https:') return false
  return resolvedUrl.startsWith('http:')
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
