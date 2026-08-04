import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const getBackendUrl = vi.hoisted(() => vi.fn(async () => 'https://api.streampulse.stream'))

vi.mock('../src/shared/storage.ts', () => ({
  DEFAULT_BACKEND_URL: 'https://api.streampulse.stream',
  getBackendUrl,
}))

import {
  fetchAlwaysTracked,
  setAlwaysTracked,
} from '../src/background/api.ts'
import {
  classifyProtectError,
  classifyProtectHttpStatus,
  planWatchlistStartupSync,
  planWatchlistStorageDelta,
} from '../src/background/alwaysTrackedSync.ts'

describe('always-tracked API headers', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    getBackendUrl.mockResolvedValue('https://api.streampulse.stream')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('does not send removed beta-key authentication on always-tracked GET', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ channels: ['a'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as typeof fetch

    await fetchAlwaysTracked()

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    const headers = new Headers(init?.headers)
    expect(headers.get('X-Streamclone-Beta-Key')).toBeNull()
  })

  it('keeps JSON content type without removed beta-key authentication on always-tracked POST', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as typeof fetch

    await setAlwaysTracked('jynxzi', true)

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    const headers = new Headers(init?.headers)
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('X-Streamclone-Beta-Key')).toBeNull()
    expect(init?.body).toBe(JSON.stringify({ channel: 'jynxzi', track: true }))
  })
  it('soft-fails unauthorized Protect writes without throwing', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('unauthorized', { status: 401 }),
    ) as typeof fetch

    await expect(setAlwaysTracked('jynxzi', true)).resolves.toEqual({
      ok: false,
      status: 401,
      unauthorized: true,
    })
  })

  it('returns ok on successful Protect writes', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as typeof fetch

    await expect(setAlwaysTracked('jynxzi', true)).resolves.toEqual({ ok: true })
  })
})

describe('always-tracked reconciliation policy', () => {
  it('classifies Protect outcomes without treating browser writes as confirmation', () => {
    expect(classifyProtectHttpStatus(401, 'add')).toBe('unauthorized')
    expect(classifyProtectHttpStatus(409, 'add')).toBe('cap')
    expect(classifyProtectHttpStatus(503, 'remove')).toBe('retry')
    expect(classifyProtectHttpStatus(404, 'remove')).toBe('removed')
    expect(classifyProtectError(new Error('network failure'))).toBe('retry')
  })

  it('never plans removals from empty local plus non-empty backend (startup/hydrate)', () => {
    expect(planWatchlistStartupSync([], ['alpha', 'beta'])).toEqual({
      trackTrue: [],
      trackFalse: [],
    })
  })

  it('plans only track:true for local channels on startup sync', () => {
    expect(planWatchlistStartupSync(['alpha', 'beta'], ['beta', 'gamma'])).toEqual({
      trackTrue: ['alpha', 'beta'],
      trackFalse: [],
    })
  })

  it('plans no mutations when local read failed (null channels)', () => {
    expect(planWatchlistStartupSync(null, ['alpha'])).toEqual({
      trackTrue: [],
      trackFalse: [],
    })
  })

  it('plans exactly one removal for an explicit storage delta', () => {
    expect(planWatchlistStorageDelta(['alpha', 'beta'], ['alpha'])).toEqual({
      trackTrue: [],
      trackFalse: ['beta'],
    })
  })

  it('plans exactly one add for an explicit storage delta', () => {
    expect(planWatchlistStorageDelta(['alpha'], ['alpha', 'beta'])).toEqual({
      trackTrue: ['beta'],
      trackFalse: [],
    })
  })
})
