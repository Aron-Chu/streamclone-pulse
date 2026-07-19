import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearEmoteImageCacheForTests,
  EMOTE_IMAGE_MAX_BYTES,
  fetchEmoteImageBytes,
  isApprovedEmoteImageUrl,
} from '../src/background/emoteImageFetch.ts'

afterEach(() => {
  clearEmoteImageCacheForTests()
  vi.restoreAllMocks()
})

function imageResponse(opts: {
  body?: ArrayBuffer
  status?: number
  contentType?: string | null
  contentLength?: string | null
}): Response {
  const body = opts.body ?? new Uint8Array([1, 2, 3, 4]).buffer
  const headers = new Headers()
  if (opts.contentType !== null) {
    headers.set('content-type', opts.contentType ?? 'image/webp')
  }
  if (opts.contentLength != null) {
    headers.set('content-length', opts.contentLength)
  } else if (opts.contentLength !== null) {
    headers.set('content-length', String(body.byteLength))
  }
  return new Response(body, { status: opts.status ?? 200, headers })
}

describe('isApprovedEmoteImageUrl', () => {
  it('allows approved HTTPS emote CDN hosts', () => {
    expect(isApprovedEmoteImageUrl('https://cdn.7tv.app/emote/abc/4x.webp')).toBe(true)
    expect(isApprovedEmoteImageUrl('https://static-cdn.jtvnw.net/emoticons/v2/1/default/dark/2.0')).toBe(true)
    expect(isApprovedEmoteImageUrl('https://cdn.frankerfacez.com/emote/1/4')).toBe(true)
  })

  it('rejects HTTP and unsupported hosts', () => {
    expect(isApprovedEmoteImageUrl('http://cdn.7tv.app/emote/abc/4x.webp')).toBe(false)
    expect(isApprovedEmoteImageUrl('https://evil.example/emote.webp')).toBe(false)
    expect(isApprovedEmoteImageUrl('javascript:alert(1)')).toBe(false)
  })
})

describe('fetchEmoteImageBytes', () => {
  it('fetches and caches approved image responses', async () => {
    const fetchImpl = vi.fn(async () => imageResponse({}))
    const first = await fetchEmoteImageBytes('https://cdn.7tv.app/emote/a/1x.webp', { fetchImpl })
    const second = await fetchEmoteImageBytes('https://cdn.7tv.app/emote/a/1x.webp', { fetchImpl })
    expect(first.mimeType).toBe('image/webp')
    expect(first.buffer.byteLength).toBe(4)
    expect(second.buffer).toBe(first.buffer)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects unsupported host before fetch', async () => {
    const fetchImpl = vi.fn()
    await expect(
      fetchEmoteImageBytes('https://evil.example/x.webp', { fetchImpl }),
    ).rejects.toThrow(/host_rejected/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects non-image MIME and does not cache', async () => {
    const fetchImpl = vi.fn(async () => imageResponse({ contentType: 'text/html' }))
    await expect(
      fetchEmoteImageBytes('https://cdn.7tv.app/emote/a/1x.webp', { fetchImpl }),
    ).rejects.toThrow(/mime_rejected/)
    const fetchImpl2 = vi.fn(async () => imageResponse({}))
    await fetchEmoteImageBytes('https://cdn.7tv.app/emote/a/1x.webp', { fetchImpl: fetchImpl2 })
    expect(fetchImpl2).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized Content-Length before buffering', async () => {
    const fetchImpl = vi.fn(async () =>
      imageResponse({ contentLength: String(EMOTE_IMAGE_MAX_BYTES + 1) }),
    )
    await expect(
      fetchEmoteImageBytes('https://cdn.7tv.app/emote/a/1x.webp', { fetchImpl }),
    ).rejects.toThrow(/too_large/)
  })

  it('rejects oversized buffered bodies when Content-Length is absent', async () => {
    const huge = new ArrayBuffer(EMOTE_IMAGE_MAX_BYTES + 8)
    const fetchImpl = vi.fn(async () => imageResponse({ body: huge, contentLength: null }))
    await expect(
      fetchEmoteImageBytes('https://cdn.7tv.app/emote/a/1x.webp', { fetchImpl }),
    ).rejects.toThrow(/too_large/)
  })

  it('maps abort to timeout', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    await expect(
      fetchEmoteImageBytes('https://cdn.7tv.app/emote/a/1x.webp', {
        fetchImpl,
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/timeout/)
  })
})
