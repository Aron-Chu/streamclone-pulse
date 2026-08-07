import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient, composeAbortSignals, normalizeApiError } from '../src/lib/apiClient'
import { clearBetaKey, setBetaKey } from '../src/lib/auth'

describe('composeAbortSignals', () => {
  it('aborts when any input signal aborts', () => {
    const a = new AbortController()
    const b = new AbortController()
    const composed = composeAbortSignals(a.signal, b.signal)
    expect(composed.signal.aborted).toBe(false)
    a.abort()
    expect(composed.signal.aborted).toBe(true)
    composed.cleanup()
  })

  it('aborts immediately when an input is already aborted', () => {
    const a = new AbortController()
    a.abort()
    const composed = composeAbortSignals(a.signal, new AbortController().signal)
    expect(composed.signal.aborted).toBe(true)
  })

  it('cleanup removes listeners so later aborts are ignored', () => {
    const a = new AbortController()
    const b = new AbortController()
    const composed = composeAbortSignals(a.signal, b.signal)
    composed.cleanup()
    a.abort()
    expect(composed.signal.aborted).toBe(false)
  })
})

describe('apiClient', () => {
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

  it('surfaces unreachable on fetch abort timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            const error = new DOMException('Aborted', 'AbortError')
            reject(error)
          }),
      ),
    )

    await expect(apiClient('/v1/extension/health', { timeoutMs: 10 })).rejects.toMatchObject({
      kind: 'unreachable',
    })
  })

  it('passes composed signal that aborts when caller signal aborts', async () => {
    const caller = new AbortController()
    let seenSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            seenSignal = init?.signal ?? undefined
            const onAbort = () => {
              reject(new DOMException('Aborted', 'AbortError'))
            }
            if (init?.signal?.aborted) {
              onAbort()
              return
            }
            init?.signal?.addEventListener('abort', onAbort, { once: true })
          }),
      ),
    )

    const pending = apiClient('/v1/extension/health', {
      signal: caller.signal,
      timeoutMs: 60_000,
    })
    // Allow fetch to start
    await Promise.resolve()
    expect(seenSignal).toBeTruthy()
    expect(seenSignal?.aborted).toBe(false)
    caller.abort()
    await expect(pending).rejects.toMatchObject({ kind: 'unreachable' })
    expect(seenSignal?.aborted).toBe(true)
  })

  it('does not retry when caller aborts', async () => {
    const caller = new AbortController()
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            calls += 1
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            )
          }),
      ),
    )

    const pending = apiClient('/v1/extension/health', {
      signal: caller.signal,
      timeoutMs: 60_000,
    })
    await Promise.resolve()
    caller.abort()
    await expect(pending).rejects.toMatchObject({ kind: 'unreachable' })
    expect(calls).toBe(1)
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
})
