import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchExtensionHealth,
  fetchPulseChannel,
  fetchWithTimeout,
} from '../src/background/api.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('fetchWithTimeout', () => {
  it('maps AbortError to extension_api_timeout', async () => {
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
      fetchWithTimeout('https://api.streampulse.stream/v1/extension/health', undefined, {
        fetchImpl,
        timeoutMs: 15,
      }),
    ).rejects.toThrow(/extension_api_timeout/)
  })
})

describe('extension API discipline', () => {
  it('surfaces HTTP 401 from pulse channel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(fetchPulseChannel('someone', { baseUrl: 'https://api.streampulse.stream' })).rejects.toThrow(
      /pulse 401/,
    )
  })

  it('surfaces HTTP 429 from health', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('limited', { status: 429 })),
    )
    await expect(fetchExtensionHealth('https://api.streampulse.stream')).rejects.toThrow(/health 429/)
  })

  it('surfaces offline/network failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await expect(fetchExtensionHealth('https://api.streampulse.stream')).rejects.toThrow(/Failed to fetch/)
  })
})
