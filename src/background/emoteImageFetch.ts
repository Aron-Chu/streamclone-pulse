const MAX_CACHE = 48

interface CachedEmoteBytes {
  mimeType: string
  buffer: ArrayBuffer
}

const emoteBytesCache = new Map<string, CachedEmoteBytes>()

export interface EmoteImageBytes {
  mimeType: string
  buffer: ArrayBuffer
}

export async function fetchEmoteImageBytes(url: string): Promise<EmoteImageBytes> {
  const cached = emoteBytesCache.get(url)
  if (cached) {
    return { mimeType: cached.mimeType, buffer: cached.buffer }
  }

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`emote_image_${res.status}`)
  }

  const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/webp'
  const buffer = await res.arrayBuffer()

  if (emoteBytesCache.size >= MAX_CACHE) {
    const firstKey = emoteBytesCache.keys().next().value
    if (firstKey) emoteBytesCache.delete(firstKey)
  }
  emoteBytesCache.set(url, { mimeType, buffer })

  return { mimeType, buffer }
}
