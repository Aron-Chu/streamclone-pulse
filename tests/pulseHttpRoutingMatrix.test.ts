import { describe, expect, it, vi } from 'vitest'
import {
  createInjectedPulseHttpRouter,
  parsePulseChannelUrl,
} from '../src/background/pulseHttpRoutes.ts'
import {
  createPulseCoordinatorState,
  handleGetPulse,
  pulseCacheKey,
} from '../src/background/pulseGetCoordinator.ts'
import {
  createWatchCoordinatorState,
  ensureWatchCoalesced,
} from '../src/background/watchCoordinator.ts'
import type { PulseCacheEntry } from '../src/shared/storage.ts'

const BASE_URL = 'http://localhost:8081'

function countCalls(
  calls: Array<{ method: string; url: string }>,
  method: string,
  urlPattern: RegExp,
): number {
  return calls.filter(call => call.method === method && urlPattern.test(call.url)).length
}

function pulseGets(calls: Array<{ method: string; url: string }>, window: 'recent' | 'full'): number {
  return calls.filter(call => {
    if (call.method !== 'GET') return false
    const parsed = parsePulseChannelUrl(call.url)
    return parsed?.window === window
  }).length
}

function watchPosts(calls: Array<{ method: string; url: string }>): number {
  return countCalls(calls, 'POST', /\/v1\/analytics\/channels\/[^/]+\/watch$/)
}

describe('pulse HTTP routing matrix (B5)', () => {
  it('cold recent GET → GET pulse/channels/{login} without ?window=full', async () => {
    const router = createInjectedPulseHttpRouter({ baseUrl: BASE_URL })
    const state = createPulseCoordinatorState()
    let now = 1000

    await handleGetPulse(
      { login: 'xqc', window: 'recent' },
      {
        now: () => now,
        getCached: async () => null,
        getCoverage: async () => null,
        fetchPulse: router.fetchPulse,
      },
      state,
    )

    expect(pulseGets(router.calls, 'recent')).toBe(1)
    expect(pulseGets(router.calls, 'full')).toBe(0)
    expect(router.calls[0]?.url).toBe(`${BASE_URL}/v1/extension/pulse/channels/xqc`)
  })

  it('explicit full → GET ...?window=full', async () => {
    const router = createInjectedPulseHttpRouter({ baseUrl: BASE_URL })
    const state = createPulseCoordinatorState()

    await handleGetPulse(
      { login: 'xqc', window: 'full', explicitFull: true },
      {
        getCached: async () => null,
        getCoverage: async () => null,
        fetchPulse: router.fetchPulse,
      },
      state,
    )

    expect(pulseGets(router.calls, 'full')).toBe(1)
    expect(router.calls[0]?.url).toBe(`${BASE_URL}/v1/extension/pulse/channels/xqc?window=full`)
  })

  it('allowWatch cold → POST watch + GET pulse; watch soft-fail still allows GET', async () => {
    const router = createInjectedPulseHttpRouter({ baseUrl: BASE_URL, watchOk: false })
    const pulseState = createPulseCoordinatorState()
    const watchState = createWatchCoordinatorState()
    let now = 5000

    await handleGetPulse(
      { login: 'xqc', window: 'recent', allowWatch: true },
      {
        now: () => now,
        getCached: async () => null,
        getCoverage: async () => null,
        ensureTracked: async login => {
          await ensureWatchCoalesced(
            login,
            { postWatch: router.postWatch, now: () => now },
            watchState,
          )
        },
        fetchPulse: router.fetchPulse,
      },
      pulseState,
    )

    expect(watchPosts(router.calls)).toBe(1)
    expect(pulseGets(router.calls, 'recent')).toBe(1)
  })

  it('two concurrent cold same login → one GET', async () => {
    const router = createInjectedPulseHttpRouter({ baseUrl: BASE_URL })
    const state = createPulseCoordinatorState()
    let now = 9000

    const deps = {
      now: () => now,
      getCached: async () => null,
      getCoverage: async () => null,
      fetchPulse: async (login: string, window: 'recent' | 'full') => {
        await new Promise(resolve => setTimeout(resolve, 15))
        return router.fetchPulse(login, window, false)
      },
    }

    await Promise.all([
      handleGetPulse({ login: 'xqc', window: 'recent' }, deps, state),
      handleGetPulse({ login: 'xqc', window: 'recent' }, deps, state),
    ])

    expect(pulseGets(router.calls, 'recent')).toBe(1)
  })

  it('fresh cache → zero HTTP', async () => {
    const router = createInjectedPulseHttpRouter({ baseUrl: BASE_URL })
    const state = createPulseCoordinatorState()
    const now = 50_000
    const entry: PulseCacheEntry = {
      payload: {
        login: 'xqc',
        streamId: 's1',
        tracking: true,
        currentOffsetSeconds: 600,
        rollups: [],
      } as PulseCacheEntry['payload'],
      fetchedAt: now - 100,
      window: 'recent',
      streamId: 's1',
    }

    await handleGetPulse(
      { login: 'xqc', window: 'recent' },
      {
        now: () => now,
        getCached: async () => entry,
        getCoverage: async () => null,
        fetchPulse: router.fetchPulse,
      },
      state,
    )

    expect(router.calls).toHaveLength(0)
  })

  it('different logins → separate GETs', async () => {
    const router = createInjectedPulseHttpRouter({ baseUrl: BASE_URL })
    const state = createPulseCoordinatorState()

    await handleGetPulse(
      { login: 'xqc', window: 'recent' },
      {
        getCached: async () => null,
        getCoverage: async () => null,
        fetchPulse: router.fetchPulse,
      },
      state,
    )
    await handleGetPulse(
      { login: 'shroud', window: 'recent' },
      {
        getCached: async () => null,
        getCoverage: async () => null,
        fetchPulse: router.fetchPulse,
      },
      state,
    )

    expect(pulseGets(router.calls, 'recent')).toBe(2)
    expect(parsePulseChannelUrl(router.calls[0]!.url)?.login).toBe('xqc')
    expect(parsePulseChannelUrl(router.calls[1]!.url)?.login).toBe('shroud')
  })

  it('watch failure does not prevent pulse GET count', async () => {
    const router = createInjectedPulseHttpRouter({ baseUrl: BASE_URL, watchOk: false })
    const pulseState = createPulseCoordinatorState()
    const watchState = createWatchCoordinatorState()

    const result = await handleGetPulse(
      { login: 'xqc', window: 'recent', allowWatch: true },
      {
        getCached: async () => null,
        getCoverage: async () => null,
        ensureTracked: async login => {
          const watch = await ensureWatchCoalesced(
            login,
            { postWatch: router.postWatch },
            watchState,
          )
          expect(watch.ok).toBe(false)
        },
        fetchPulse: router.fetchPulse,
      },
      pulseState,
    )

    expect(watchPosts(router.calls)).toBe(1)
    expect(pulseGets(router.calls, 'recent')).toBe(1)
    expect(result.payload?.login).toBe('xqc')
    expect(result.network.syncFetches).toBe(1)
  })

  it('records cache keys separately for recent vs full', async () => {
    const router = createInjectedPulseHttpRouter({ baseUrl: BASE_URL })
    const state = createPulseCoordinatorState()
    const keys: string[] = []

    const deps = {
      getCached: async (login: string, window: 'recent' | 'full') => {
        keys.push(pulseCacheKey(login, window))
        return null
      },
      getCoverage: async () => null,
      fetchPulse: router.fetchPulse,
    }

    await handleGetPulse({ login: 'xqc', window: 'recent' }, deps, state)
    await handleGetPulse({ login: 'xqc', window: 'full', explicitFull: true }, deps, state)

    expect(new Set(keys)).toEqual(new Set(['xqc:recent:-', 'xqc:full:-']))
    expect(pulseGets(router.calls, 'recent')).toBe(1)
    expect(pulseGets(router.calls, 'full')).toBe(1)
  })
})
