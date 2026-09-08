import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient, normalizeApiError } from '../src/lib/momentsApiClient'
import { clearBetaKey, setBetaKey } from '../src/lib/auth'

describe('apiClient', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    localStorage.clear()
    clearBetaKey()
    vi.restoreAllMocks()
  })

  it('injects beta header on gated calls', async () => {
    await setBetaKey('secret-one')
    const fetchMock = vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      expect(init?.headers).toBeTruthy()
      const headers = new Headers(init?.headers)
      expect(headers.get('X-Streamclone-Beta-Key')).toBe('secret-one')
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await apiClient('/v1/extension/pulse/channels/xqc', { gated: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('bypasses the browser cache for dynamic portal reads', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      expect(init?.cache).toBe('no-store')
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await apiClient('/v1/public/hub?activityWindow=24h')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('preserves an explicit request cache mode', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      expect(init?.cache).toBe('reload')
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await apiClient('/v1/public/hub?activityWindow=24h', { cache: 'reload' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('normalizes 401 errors and dispatches auth:rejected', async () => {
    const rejected = vi.fn()
    window.addEventListener('auth:rejected', rejected)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: 'unauthorized',
            hint: 'Set X-Streamclone-Beta-Key header (Pulse extension options)',
          }),
          { status: 401 },
        ),
      ),
    )

    await expect(apiClient('/v1/extension/pulse/channels/xqc', { gated: true })).rejects.toMatchObject({
      kind: 'unauthorized',
    })
    expect(rejected).toHaveBeenCalledTimes(1)
  })

  it('normalizes 429/500/timeout kinds', () => {
    expect(normalizeApiError(429, { error: 'too many' }).kind).toBe('rate_limited')
    expect(normalizeApiError(500, { error: 'boom' }).kind).toBe('server')
    expect(normalizeApiError(400, { error: 'bad' }).kind).toBe('bad_request')
    expect(normalizeApiError(0, { error: 'timeout' }).kind).toBe('bad_request')
  })

  it('classifies caller cancellation as an aborted request', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })),
    )
    const request = apiClient('/v1/extension/health', { signal: controller.signal })
    controller.abort()
    await expect(request).rejects.toMatchObject({
      kind: 'aborted',
    })
  })

  it('classifies its own deadline separately and keeps it through body consumption', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start() {} }), { status: 200 })))
    await expect(apiClient('/v1/public/hub', { timeoutMs: 10 })).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('uses one total deadline across a failed attempt, backoff and the retry body', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        await new Promise(resolve => setTimeout(resolve, 100))
        return new Response('{}', { status: 500 })
      }
      return new Response(new ReadableStream({ start() {} }), { status: 200 })
    }))
    const started = Date.now()
    const result = apiClient('/v1/public/hub', { timeoutMs: 500 }).catch(error => error)
    await vi.advanceTimersByTimeAsync(500)
    expect(await result).toMatchObject({ kind: 'timeout' })
    expect(calls).toBe(2)
    expect(Date.now() - started).toBe(500)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not let credential-bearing calls follow redirects, even with a caller override', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      expect(init?.redirect).toBe('error')
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await apiClient('/v1/portal/profile', { gated: true, redirect: 'follow' })
    await apiClient('/v1/portal/profile', { headers: { Authorization: 'Bearer private' }, redirect: 'follow' })
    await apiClient('/v1/portal/profile', { headers: { 'X-Streamclone-Beta-Key': 'private' } })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('removes composed caller and body abort listeners after success', async () => {
    const added = vi.spyOn(AbortSignal.prototype, 'addEventListener')
    const removed = vi.spyOn(AbortSignal.prototype, 'removeEventListener')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })))
    const controller = new AbortController()
    await apiClient('/v1/public/hub', { signal: controller.signal })
    const abortAdds = added.mock.calls.filter(([type]) => type === 'abort').length
    const abortRemoves = removed.mock.calls.filter(([type]) => type === 'abort').length
    expect(abortRemoves).toBe(abortAdds)
  })

  it('bounds response bodies even without a Content-Length header', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('12345', { status: 200 })))
    await expect(apiClient('/v1/public/hub', { maxResponseBytes: 4 })).rejects.toMatchObject({ kind: 'response_too_large' })
  })

  it('retries once on 500 but not on 401', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1
        if (calls === 1) {
          return new Response(JSON.stringify({ error: 'server' }), { status: 500 })
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }),
    )

    const result = await apiClient('/v1/extension/health')
    expect(calls).toBe(2)
    expect(result.data).toEqual({ ok: true })
  })

  it('does not retry 401', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
      }),
    )

    await expect(apiClient('/v1/extension/pulse/channels/xqc', { gated: true })).rejects.toMatchObject({
      kind: 'unauthorized',
    })
    expect(calls).toBe(1)
  })

  it('does not retry a mutation after a lost response by default', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('connection lost') })
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiClient('/v1/pulse/clips/one', { method: 'PATCH', body: { status: 'saved' } })).rejects.toMatchObject({ kind: 'unreachable' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a mutation only with explicit server idempotency and sends its key', async () => {
    let calls = 0
    const fetchMock = vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      calls += 1
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('save-one')
      if (calls === 1) throw new TypeError('connection lost')
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await apiClient('/v1/pulse/clips/one', { method: 'PATCH', body: { status: 'saved' }, idempotencyKey: 'save-one' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('makes retry backoff abortable', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"server"}', { status: 500 })))
    const request = apiClient('/v1/public/hub', { signal: controller.signal })
    await Promise.resolve()
    controller.abort()
    await expect(request).rejects.toMatchObject({ kind: 'aborted' })
  })

  it('never retries 429 and preserves Retry-After', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":"slow down"}', { status: 429, headers: { 'Retry-After': '3' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiClient('/v1/public/hub')).rejects.toMatchObject({ kind: 'rate_limited', retryAfterMs: 3000 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses to attach credentials outside the configured origin or API paths', async () => {
    await setBetaKey('secret-one')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiClient('https://example.com/image.png', { gated: true })).rejects.toThrow('trusted StreamPulse boundary')
    await expect(apiClient('/provider/avatar.png', { gated: true })).rejects.toThrow('trusted StreamPulse boundary')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('applies the credential boundary even when the caller omits gated', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiClient('https://example.com/v1/portal/profile', { headers: { Authorization: 'Bearer private' } })).rejects.toThrow('trusted StreamPulse boundary')
    await expect(apiClient('/provider/avatar', { headers: { 'X-Streamclone-Beta-Key': 'private' } })).rejects.toThrow('trusted StreamPulse boundary')
    await expect(apiClient('https://example.com/v1/portal/profile', { credentials: 'include' })).rejects.toThrow('trusted StreamPulse boundary')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('binds support body credentials to the trusted route and forbids redirects without injecting beta auth', async () => {
    await setBetaKey('must-not-be-injected')
    const fetchMock = vi.fn(async (_url: RequestInfo, init?: RequestInit) => {
      expect(init?.redirect).toBe('error')
      expect(new Headers(init?.headers).has('X-Streamclone-Beta-Key')).toBe(false)
      return new Response('{"case_id":"one"}')
    })
    vi.stubGlobal('fetch', fetchMock)
    const options = { method: 'POST', sensitive: true, redirect: 'follow' as const, body: { turnstile_token: 'private', email: 'private@example.test' } }
    await apiClient('/v1/portal/support/cases', options)
    await expect(apiClient('https://untrusted.example/v1/portal/support/cases', options)).rejects.toThrow('trusted StreamPulse boundary')
    await expect(apiClient('/assets/collect', options)).rejects.toThrow('trusted StreamPulse boundary')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
