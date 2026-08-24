import { describe, expect, it, vi } from 'vitest'
import {
  createPulseCoordinatorState,
  handleGetPulse,
  pulseCacheKey,
} from '../src/background/pulseGetCoordinator.ts'
import {
  PULSE_CACHE_TTL_MS,
  type PulseCacheEntry,
  type PulseCacheWindow,
} from '../src/shared/storage.ts'
import {
  PULSE_REVALIDATE_FAILURE_COOLDOWN_MS,
  PULSE_REVALIDATE_MIN_GAP_MS,
} from '../src/background/pulseRevalidateGate.ts'

function fakePayload(login = 'xqc'): PulseCacheEntry['payload'] {
  return {
    login,
    streamId: 's1',
    tracking: true,
    currentOffsetSeconds: 600,
    rollups: [],
  } as PulseCacheEntry['payload']
}

describe('production pulse GET_PULSE coordinator matrix', () => {
  it('cold cache one tab → exactly one sync fetch', async () => {
    const cache = new Map<string, PulseCacheEntry>()
    let fetches = 0
    const state = createPulseCoordinatorState()
    const result = await handleGetPulse(
      { login: 'xqc', window: 'recent' },
      {
        getCached: async (login, window) => cache.get(pulseCacheKey(login, window)) ?? null,
        getCoverage: async () => null,
        fetchPulse: async (login, window) => {
          fetches += 1
          const payload = fakePayload(login)
          cache.set(pulseCacheKey(login, window), {
            payload,
            fetchedAt: Date.now(),
            window,
            streamId: 's1',
          })
          return { payload, coverageTier: null }
        },
      },
      state,
    )
    expect(fetches).toBe(1)
    expect(result.network.syncFetches).toBe(1)
    expect(result.payload?.login).toBe('xqc')
  })

  it('cold cache two tabs same login/window → one upstream fetch', async () => {
    const cache = new Map<string, PulseCacheEntry>()
    let fetches = 0
    const state = createPulseCoordinatorState()
    const deps = {
      getCached: async (login: string, window: PulseCacheWindow) =>
        cache.get(pulseCacheKey(login, window)) ?? null,
      getCoverage: async () => null,
      fetchPulse: async (login: string, window: PulseCacheWindow) => {
        fetches += 1
        await new Promise(r => setTimeout(r, 15))
        const payload = fakePayload(login)
        cache.set(pulseCacheKey(login, window), {
          payload,
          fetchedAt: Date.now(),
          window,
          streamId: 's1',
        })
        return { payload, coverageTier: null }
      },
    }
    const [a, b] = await Promise.all([
      handleGetPulse({ login: 'xqc', window: 'recent' }, deps, state),
      handleGetPulse({ login: 'xqc', window: 'recent' }, deps, state),
    ])
    expect(fetches).toBe(1)
    expect(a.payload).toEqual(b.payload)
  })

  it('fresh cache → zero upstream', async () => {
    let fetches = 0
    const now = 100_000
    const state = createPulseCoordinatorState()
    const entry: PulseCacheEntry = {
      payload: fakePayload(),
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
        fetchPulse: async () => {
          fetches += 1
          return { payload: fakePayload(), coverageTier: null }
        },
      },
      state,
    )
    expect(fetches).toBe(0)
  })

  it('stale cache → return cache + exactly one revalidate', async () => {
    let fetches = 0
    const softFailures: boolean[] = []
    const now = 100_000
    const state = createPulseCoordinatorState()
    const entry: PulseCacheEntry = {
      payload: fakePayload(),
      fetchedAt: now - (PULSE_REVALIDATE_MIN_GAP_MS + 10),
      window: 'recent',
      streamId: 's1',
    }
    const result = await handleGetPulse(
      { login: 'xqc', window: 'recent' },
      {
        now: () => now,
        getCached: async () => entry,
        getCoverage: async () => null,
        fetchPulse: async () => {
          fetches += 1
          return { payload: fakePayload(), coverageTier: null }
        },
        onBroadcast: (_l, _p, _e, _c, meta) => {
          if (meta?.softStaleFailure) softFailures.push(true)
        },
      },
      state,
    )
    expect(result.payload).toBe(entry.payload)
    expect(result.network.asyncRevalidatesScheduled).toBe(1)
    await vi.waitFor(() => expect(fetches).toBe(1))
    expect(softFailures).toEqual([])
  })

  it('failed stale revalidation during cooldown does not retry-storm', async () => {
    let fetches = 0
    let soft = 0
    const t0 = 50_000
    const state = createPulseCoordinatorState()
    const entry: PulseCacheEntry = {
      payload: fakePayload(),
      fetchedAt: t0 - (PULSE_REVALIDATE_MIN_GAP_MS + 10),
      window: 'recent',
      streamId: 's1',
    }
    const deps = {
      getCached: async () => entry,
      getCoverage: async () => null,
      fetchPulse: async () => {
        fetches += 1
        return { payload: null, coverageTier: null, error: 'upstream_down' }
      },
      onBroadcast: (_l: string, _p: unknown, _e: unknown, _c: unknown, meta?: { softStaleFailure?: boolean }) => {
        if (meta?.softStaleFailure) soft += 1
      },
    }
    await handleGetPulse({ login: 'xqc', window: 'recent' }, { ...deps, now: () => t0 }, state)
    await vi.waitFor(() => expect(fetches).toBe(1))
    await vi.waitFor(() => expect(soft).toBe(1))

    // Immediate second stale hit during cooldown — no new fetch.
    await handleGetPulse(
      { login: 'xqc', window: 'recent' },
      { ...deps, now: () => t0 + 100 },
      state,
    )
    expect(fetches).toBe(1)

    // After cooldown — exactly one new request.
    await handleGetPulse(
      { login: 'xqc', window: 'recent' },
      { ...deps, now: () => t0 + PULSE_REVALIDATE_FAILURE_COOLDOWN_MS + 1 },
      state,
    )
    await vi.waitFor(() => expect(fetches).toBe(2))
  })

  it('explicit Full cold fetch uses full window key (separate from recent)', async () => {
    const keys: string[] = []
    const state = createPulseCoordinatorState()
    await handleGetPulse(
      { login: 'xqc', window: 'full', explicitFull: true },
      {
        getCached: async () => null,
        getCoverage: async () => null,
        fetchPulse: async (login, window) => {
          keys.push(pulseCacheKey(login, window))
          return { payload: fakePayload(), coverageTier: null }
        },
      },
      state,
    )
    expect(keys).toEqual(['xqc:full:-'])
  })

  it('coalesces one Full sequence per stream activation and preserves recent on failure', async () => {
    let fullFetches = 0
    const recentPayload = fakePayload()
    const recentEntry: PulseCacheEntry = {
      payload: recentPayload,
      fetchedAt: Date.now(),
      window: 'recent',
      streamId: 's1',
    }
    const state = createPulseCoordinatorState()
    const deps = {
      getCached: async (_login: string, window: PulseCacheWindow) => window === 'recent' ? recentEntry : null,
      getCoverage: async () => null,
      fetchPulse: async (_login: string, window: PulseCacheWindow) => {
        expect(window).toBe('full')
        fullFetches += 1
        await new Promise(resolve => setTimeout(resolve, 15))
        return { payload: null, coverageTier: null, error: 'pulse 409' }
      },
    }

    const [first, second] = await Promise.all([
      handleGetPulse({ login: 'xqc', window: 'full', streamId: 's1', explicitFull: true }, deps, state),
      handleGetPulse({ login: 'xqc', window: 'full', streamId: 's1', explicitFull: true }, deps, state),
    ])

    expect(fullFetches).toBe(1)
    expect(first.payload).toBe(recentPayload)
    expect(second.payload).toBe(recentPayload)
    expect(first.error).toBe('pulse 409')
  })

  it('stored Full preference alone does not imply syncFetch when recent cache is fresh', async () => {
    // Activation with stored Full preference still polls recent until user unlocks.
    let fetches = 0
    const now = 80_000
    const state = createPulseCoordinatorState()
    await handleGetPulse(
      { login: 'xqc', window: 'recent' },
      {
        now: () => now,
        getCached: async () => ({
          payload: fakePayload(),
          fetchedAt: now - 50,
          window: 'recent',
          streamId: 's1',
        }),
        getCoverage: async () => null,
        fetchPulse: async () => {
          fetches += 1
          return { payload: fakePayload(), coverageTier: null }
        },
      },
      state,
    )
    expect(fetches).toBe(0)
  })

  it('local watch registration runs at most once per cold allowWatch path', async () => {
    let watches = 0
    let fetches = 0
    const cache = new Map<string, PulseCacheEntry>()
    const state = createPulseCoordinatorState()
    await handleGetPulse(
      { login: 'xqc', window: 'recent', allowWatch: true },
      {
        getCached: async (login, window) => cache.get(pulseCacheKey(login, window)) ?? null,
        getCoverage: async () => null,
        ensureTracked: async () => {
          watches += 1
        },
        fetchPulse: async (login, window) => {
          fetches += 1
          const payload = fakePayload(login)
          cache.set(pulseCacheKey(login, window), {
            payload,
            fetchedAt: Date.now(),
            window,
            streamId: 's1',
          })
          return { payload, coverageTier: null }
        },
      },
      state,
    )
    expect(watches).toBe(1)
    expect(fetches).toBe(1)
  })

  it('past-TTL entry is cold again', async () => {
    let fetches = 0
    const now = 200_000
    const state = createPulseCoordinatorState()
    await handleGetPulse(
      { login: 'xqc', window: 'recent' },
      {
        now: () => now,
        getCached: async () => ({
          payload: fakePayload(),
          fetchedAt: now - (PULSE_CACHE_TTL_MS + 1),
          window: 'recent',
          streamId: 's1',
        }),
        getCoverage: async () => null,
        fetchPulse: async () => {
          fetches += 1
          return { payload: fakePayload(), coverageTier: null }
        },
      },
      state,
    )
    expect(fetches).toBe(1)
  })
})
