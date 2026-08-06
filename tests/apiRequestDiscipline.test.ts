import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEVICE_CREDENTIAL_STORAGE_KEY } from '../src/background/deviceAuth.ts'
import {
  fetchExtensionHealth,
  fetchPulseChannel,
  fetchPulseVod,
  fetchWithTimeout,
  isDeviceTokenOriginAllowed,
  readResponseText,
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

  it('distinguishes caller cancellation from the request timeout', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    const upstream = new AbortController()
    const pending = fetchWithTimeout('https://api.streampulse.stream/v1/extension/health', {
      signal: upstream.signal,
    }, { fetchImpl, timeoutMs: 500 })
    upstream.abort()
    await expect(pending).rejects.toThrow(/extension_api_cancelled/)
  })

  it('rejects oversized response bodies before parsing', async () => {
    await expect(readResponseText(new Response('12345'), 4)).rejects.toThrow(
      /extension_api_response_too_large/,
    )
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

  it('uses the exact-stream endpoint for a valid Full stream identity', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ login: 'xqc', streamId: '123456', rollups: [] }), {
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchPulseChannel('xqc', {
      baseUrl: 'https://api.streampulse.stream',
      window: 'full',
      streamId: '123456',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.streampulse.stream/v1/extension/pulse/streams/123456?login=xqc&allowLiveBridge=true&window=full',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('rejects an exact-stream response whose identity differs from the requested stream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ login: 'xqc', streamId: 'other-stream', rollups: [] }),
      { headers: { 'content-type': 'application/json' } },
    )))
    await expect(fetchPulseChannel('xqc', {
      baseUrl: 'https://api.streampulse.stream',
      window: 'full',
      streamId: '123456',
    })).rejects.toThrow(/pulse_stream_mismatch/)
  })

  it('rejects malformed pulse envelopes instead of treating them as empty data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
      headers: { 'content-type': 'application/json' },
    })))
    await expect(fetchPulseChannel('xqc', { baseUrl: 'https://api.streampulse.stream' }))
      .rejects.toThrow(/extension_api_invalid_pulse_payload/)
  })

  it('allows device credentials only on the canonical hosted origin', () => {
    expect(isDeviceTokenOriginAllowed('https://api.streampulse.stream')).toBe(true)
    expect(isDeviceTokenOriginAllowed('http://localhost:8081')).toBe(false)
    expect(isDeviceTokenOriginAllowed('https://custom.example')).toBe(false)
    expect(isDeviceTokenOriginAllowed('https://api.streampulse.stream.evil')).toBe(false)
  })

  it('does not attach a stored device token to a custom backend origin', async () => {
    const credential = {
      token: `spdev_${'a'.repeat(64)}`,
      principalId: 'c'.repeat(64),
      deviceId: `dev_${'b'.repeat(32)}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      principalKind: 'device',
    }
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension' },
      storage: { local: { get: vi.fn(async () => ({ [DEVICE_CREDENTIAL_STORAGE_KEY]: credential })) } },
    })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, version: 'test', time: 1 }), {
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchExtensionHealth('https://custom.example')
    const [, init] = fetchMock.mock.calls[0]!
    expect(new Headers(init?.headers).get('Authorization')).toBeNull()
  })

  it('preserves VOD missing and backend-error semantics for non-2xx responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'temporarily unavailable' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        })),
    )

    await expect(fetchPulseVod('123456')).resolves.toMatchObject({
      vodId: null,
      coverageStatus: 'missing',
    })
    await expect(fetchPulseVod('123456')).resolves.toMatchObject({
      vodId: null,
      coverageStatus: 'error',
    })
  })

  it('sends a VOD route candidate directly to the read-only live bridge', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      mode: 'live_dvr',
      vodId: null,
      streamId: 'provider-stream',
      login: 'channel',
      isLive: true,
      tracking: true,
      provisional: true,
      resolutionState: 'live_stream_validated',
      retryable: true,
      currentOffsetSeconds: 120,
      rollups: [],
      lanes: { composite: [], chat: [], seventv: [] },
    }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchPulseVod('123456', { baseUrl: 'https://custom.example' })

    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(requested.pathname).toBe('/v1/extension/pulse/vods/123456')
    expect(requested.searchParams.get('allowLiveBridge')).toBe('true')
    expect(requested.searchParams.get('streamId')).toBeNull()
    expect(requested.searchParams.get('window')).toBe('recent')
  })

  it('uses the validated stream as an equality assertion on growing-VOD polls', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      mode: 'live_dvr',
      vodId: '123456',
      streamId: 'provider-stream',
      login: 'channel',
      isLive: true,
      tracking: true,
      provisional: true,
      resolutionState: 'live_archive_validated',
      retryable: true,
      currentOffsetSeconds: 120,
      rollups: [],
      lanes: { composite: [], chat: [], seventv: [] },
    }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchPulseVod('123456', {
      baseUrl: 'https://custom.example',
      streamId: 'provider-stream',
    })

    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(requested.searchParams.get('streamId')).toBe('provider-stream')
    expect(requested.searchParams.get('window')).toBe('recent')
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
