import { readFileSync } from 'node:fs'
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
  it('rejects redirects and omits ambient credentials even when a caller requests them', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok'))
    const response = await fetchWithTimeout('https://api.streampulse.stream/v1/extension/health', {
      redirect: 'follow', credentials: 'include',
    }, { fetchImpl })
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ redirect: 'error', credentials: 'omit' }))
    await readResponseText(response)
  })

  it('classifies an already cancelled request as cancellation', async () => {
    const upstream = new AbortController()
    upstream.abort()
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true)
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    })
    await expect(fetchWithTimeout('https://api.streampulse.stream/v1/extension/health', {
      signal: upstream.signal,
    }, { fetchImpl })).rejects.toThrow('extension_api_cancelled')
  })

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
  it('keeps browser update checks out of timers, polling, health, and settings mounts', () => {
    const sources = [
      '../src/content/livePoll.ts',
      '../src/content/entry.ts',
      '../src/background/service-worker.ts',
      '../src/ui/SettingsWorkspace.tsx',
    ].map(path => readFileSync(new URL(path, import.meta.url), 'utf8'))
    expect(sources.every(source => !source.includes('.requestUpdateCheck('))).toBe(true)
    const explicitUpdateModule = readFileSync(
      new URL('../src/background/extensionUpdateCheck.ts', import.meta.url),
      'utf8',
    )
    expect(explicitUpdateModule.match(/\.requestUpdateCheck\(/g)).toHaveLength(1)
  })

  it('bypasses the browser cache for live extension API reads', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      login: 'xqc',
      streamId: '123456',
      rollups: [],
    }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchPulseChannel('xqc', {
      baseUrl: 'https://api.streampulse.stream',
      window: 'full',
      streamId: '123456',
    })

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ cache: 'no-store' }))
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined()
  })

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

  it('falls back from an unavailable exact-stream Full route to channel Full only on 404/405/409', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ login: 'xqc', streamId: '123456', rollups: [] }),
        { headers: { 'content-type': 'application/json' } },
      ))
    vi.stubGlobal('fetch', fetchMock)

    await fetchPulseChannel('xqc', {
      baseUrl: 'https://api.streampulse.stream',
      window: 'full',
      streamId: '123456',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.streampulse.stream/v1/extension/pulse/streams/123456?login=xqc&allowLiveBridge=true&window=full',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.streampulse.stream/v1/extension/pulse/channels/xqc?window=full',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('falls back from an exact-stream identity-conflict 409 and accepts normalized same-stream channel data', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'broadcaster_mismatch' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ login: 'XQC', streamId: '123456', rollups: [] }),
        { headers: { 'content-type': 'application/json' } },
      ))
    vi.stubGlobal('fetch', fetchMock)

    await fetchPulseChannel(' XqC ', {
      baseUrl: 'https://api.streampulse.stream',
      window: 'full',
      streamId: '123456',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.streampulse.stream/v1/extension/pulse/channels/xqc?window=full',
      expect.objectContaining({ signal: expect.any(AbortSignal), cache: 'no-store' }),
    )
  })

  it('rejects a 409 channel fallback whose normalized login differs from the active request', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 409 }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ login: 'other_channel', streamId: '123456', rollups: [] }),
        { headers: { 'content-type': 'application/json' } },
      )))

    await expect(fetchPulseChannel('xqc', {
      baseUrl: 'https://api.streampulse.stream',
      window: 'full',
      streamId: '123456',
    })).rejects.toThrow(/pulse_login_mismatch/)
  })

  it('rejects a channel Full fallback whose stream identity differs', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 405 }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ login: 'xqc', streamId: 'other-stream', rollups: [] }),
        { headers: { 'content-type': 'application/json' } },
      )))

    await expect(fetchPulseChannel('xqc', {
      baseUrl: 'https://api.streampulse.stream',
      window: 'full',
      streamId: '123456',
    })).rejects.toThrow(/pulse_stream_mismatch/)
  })

  it('does not fall back from an exact-stream Full route on a server error', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchPulseChannel('xqc', {
      baseUrl: 'https://api.streampulse.stream',
      window: 'full',
      streamId: '123456',
    })).rejects.toThrow(/pulse 500/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
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

  it('asks for a VOD without the live bridge when nothing shows it is the live stream', async () => {
    // Shape of the Oct 7 ohnepixel VOD while the channel was live again (2026-10-09 probe).
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      mode: 'vod',
      vodId: '2894307326',
      streamId: '317950783460',
      channelLogin: 'ohnepixel',
      startedAt: '2026-10-07T14:46:57Z',
      durationSeconds: 30300,
      coverageStatus: 'partial',
      resolutionState: 'helix_exact',
    }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const vod = await fetchPulseVod('2894307326', { baseUrl: 'https://custom.example', streamId: '317967537252' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(requested.pathname).toBe('/v1/extension/pulse/vods/2894307326')
    expect(requested.searchParams.get('allowLiveBridge')).toBeNull()
    expect(requested.searchParams.get('streamId')).toBeNull()
    expect(requested.searchParams.get('window')).toBe('recent')
    expect(vod).toMatchObject({ mode: 'vod', streamId: '317950783460' })
  })

  it('upgrades to the live bridge, with the stream as an equality assertion, only for the live archive', async () => {
    const startedAt = new Date(Date.now() - 2 * 3600_000).toISOString()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      const body = url.pathname.startsWith('/v1/extension/pulse/channels/')
        ? { login: 'channel', isLive: true, tracking: true, streamId: 'provider-stream', startedAt, currentOffsetSeconds: 7200, rollups: [], lanes: { composite: [], chat: [], seventv: [] }, recap: null }
        : url.searchParams.get('allowLiveBridge') === 'true'
          ? {
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
          }
          : { mode: 'vod', vodId: '123456', streamId: 'provider-stream', channelLogin: 'channel', startedAt, durationSeconds: 7200, coverageStatus: 'partial' }
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const vod = await fetchPulseVod('123456', { baseUrl: 'https://custom.example' })

    const urls = fetchMock.mock.calls.map(call => new URL(String(call[0])))
    expect(urls.map(url => url.pathname)).toEqual([
      '/v1/extension/pulse/vods/123456',
      '/v1/extension/pulse/channels/channel',
      '/v1/extension/pulse/vods/123456',
    ])
    expect(urls[0]?.searchParams.get('allowLiveBridge')).toBeNull()
    expect(urls[2]?.searchParams.get('allowLiveBridge')).toBe('true')
    expect(urls[2]?.searchParams.get('streamId')).toBe('provider-stream')
    expect(vod.mode).toBe('live_dvr')
  })

  it('a 429 from the live bridge on a later poll keeps the live DVR and honours Retry-After', async () => {
    const startedAt = new Date(Date.now() - 2 * 3600_000).toISOString()
    let bridgeStatus = 200
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.startsWith('/v1/extension/pulse/channels/')) {
        return new Response(JSON.stringify({ login: 'channel', isLive: true, tracking: true, streamId: 'live-stream', startedAt, currentOffsetSeconds: 7200, rollups: [], lanes: { composite: [], chat: [], seventv: [] }, recap: null }), { headers: { 'content-type': 'application/json' } })
      }
      if (url.searchParams.get('allowLiveBridge') === 'true') {
        if (bridgeStatus === 429) {
          return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { 'content-type': 'application/json', 'Retry-After': '120' } })
        }
        return new Response(JSON.stringify({ mode: 'live_dvr', vodId: '777777', streamId: 'live-stream', login: 'channel', isLive: true, tracking: true, provisional: true, resolutionState: 'live_archive_validated', retryable: true, currentOffsetSeconds: 120, rollups: [], lanes: { composite: [], chat: [], seventv: [] } }), { headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ mode: 'vod', vodId: '777777', streamId: 'live-stream', channelLogin: 'channel', startedAt, durationSeconds: 7200, coverageStatus: 'partial' }), { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    expect((await fetchPulseVod('777777', { baseUrl: 'https://custom.example' })).mode).toBe('live_dvr')
    fetchMock.mockClear()

    bridgeStatus = 429
    const polled = await fetchPulseVod('777777', { baseUrl: 'https://custom.example', streamId: 'live-stream' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('allowLiveBridge')).toBe('true')
    expect(polled).toMatchObject({ mode: 'live_dvr', streamId: 'live-stream' })

    fetchMock.mockClear()
    const waiting = await fetchPulseVod('777777', { baseUrl: 'https://custom.example', streamId: 'live-stream' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(waiting.mode).toBe('live_dvr')
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
