import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hasPrimedPublicHub,
  HUB_READ_HARD_CAP_MS,
  hubReadTimeoutMs,
  PRIMED_HUB_TTL_MS,
  primedHubRequestForLocation,
  primePublicHub,
  publicHubPath,
  resetPrimedPublicHubForTests,
  takePrimedPublicHub,
} from '../src/lib/hubEarlyFetch'
import { SLOW_READ_TIMEOUT_MS } from '../src/lib/portalTimeouts'
import { parseHubWindowParam } from '../src/lib/hubWindows'
import { publicHubPath as reexportedPath } from '../src/lib/publicHub'
import { usePublicHubData } from '../src/hooks/usePublicHubData'
import { clearPublicHubCacheForTests } from '../src/lib/publicHubCache'

const api = vi.hoisted(() => ({ apiClient: vi.fn(), backend: 'https://api.streampulse.stream' }))

vi.mock('../src/lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/apiClient')>()
  return {
    ...actual,
    apiClient: (...args: unknown[]) => api.apiClient(...args),
    getBackendUrl: () => api.backend,
  }
})

function hubBody(windowMinutes: number) {
  const bucketMinutes = windowMinutes <= 240 ? 1 : Math.ceil(windowMinutes / 240)
  const end = Math.floor(Date.now() / (bucketMinutes * 60_000)) * bucketMinutes * 60_000
  return {
    generatedAt: new Date(end).toISOString(),
    poolSize: 500,
    corpus: { streamsTracked: 1, momentsDetected: 1, chatMessagesProcessed: 1, emotesIndexed: 1, vodsAnalyzed: 1 },
    coverage: { databaseOk: true, state: 'ready' },
    activity: {
      windowMinutes,
      bucketMinutes,
      channelCount: 3,
      points: [{ t: end - bucketMinutes * 60_000, chat: 40, emotes: 12, seventv: 5, viewers: 1000, bucketComplete: true }],
    },
    liveChannels: [],
    moments: [],
    topEmotes: [],
    topMovers: [],
  }
}

/** The signal main.tsx's primed request runs with. */
function primedRequestSignal(): AbortSignal {
  return (api.apiClient.mock.calls[0][1] as { signal: AbortSignal }).signal
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  resetPrimedPublicHubForTests()
  clearPublicHubCacheForTests()
  localStorage.clear()
  api.apiClient.mockReset()
  api.backend = 'https://api.streampulse.stream'
})

afterEach(() => {
  vi.useRealTimers()
  resetPrimedPublicHubForTests()
})

describe('hub early fetch: paths', () => {
  it('builds the hub path and re-exports it from publicHub.ts', () => {
    expect(publicHubPath()).toBe('/v1/public/hub?activityWindow=24h')
    expect(publicHubPath('7d')).toBe('/v1/public/hub?activityWindow=7d')
    expect(publicHubPath('30m', 'moments')).toBe('/v1/public/hub?activityWindow=30m&include=livePulseMoments')
    expect(publicHubPath('24h', 'tickers')).toBe('/v1/public/hub?activityWindow=24h&include=topEmotes%2CtopMovers')
    expect(reexportedPath).toBe(publicHubPath)
    expect(hubReadTimeoutMs('24h')).toBe(SLOW_READ_TIMEOUT_MS)
    expect(hubReadTimeoutMs('30m')).toBeUndefined()
    expect(hubReadTimeoutMs('recent')).toBeUndefined()
    expect(hubReadTimeoutMs('30m', 'tickers')).toBeUndefined()
    expect(hubReadTimeoutMs('30m', 'moments')).toBe(SLOW_READ_TIMEOUT_MS)
    expect(hubReadTimeoutMs('recent', 'moments')).toBe(SLOW_READ_TIMEOUT_MS)
  })

  // The hook adopts the primed read as its own, which runs on past its deadline.
  it('primes only /analytics, reading the window like the page', () => {
    expect(HUB_READ_HARD_CAP_MS).toBe(90_000)
    expect(primedHubRequestForLocation({ pathname: '/analytics', search: '' })).toEqual({
      path: '/v1/public/hub?activityWindow=24h', activityWindow: '24h', timeoutMs: HUB_READ_HARD_CAP_MS,
    })
    expect(primedHubRequestForLocation({ pathname: '/analytics/', search: '?window=7d' })?.path).toBe('/v1/public/hub?activityWindow=7d')
    expect(primedHubRequestForLocation({ pathname: '/analytics', search: '?activityWindow=30m' })).toMatchObject({ activityWindow: '30m', timeoutMs: HUB_READ_HARD_CAP_MS })
    expect(primedHubRequestForLocation({ pathname: '/analytics', search: '?window=bogus' })?.activityWindow).toBe('24h')
    for (const pathname of ['/', '/analytics/xqc/123', '/moments', '/Analytics', '/analyticsx']) {
      expect(primedHubRequestForLocation({ pathname, search: '' })).toBeNull()
    }
    expect(primedHubRequestForLocation(null)).toBeNull()
  })
})

describe('hub early fetch: priming and hand-over', () => {
  it('starts the request once per load, and only on the hub route', () => {
    api.apiClient.mockReturnValue(new Promise(() => {}))
    expect(primePublicHub({ pathname: '/moments', search: '' })).toBeNull()
    expect(api.apiClient).not.toHaveBeenCalled()
    expect(primePublicHub({ pathname: '/analytics', search: '?window=7d' })).toBe('/v1/public/hub?activityWindow=7d')
    expect(primePublicHub({ pathname: '/analytics', search: '' })).toBeNull()
    expect(api.apiClient).toHaveBeenCalledTimes(1)
    expect(api.apiClient).toHaveBeenCalledWith('/v1/public/hub?activityWindow=7d', {
      timeoutMs: HUB_READ_HARD_CAP_MS, signal: expect.any(AbortSignal), slowOrigin: true,
    })
    expect(hasPrimedPublicHub()).toBe(true)
  })

  it('hands the promise over once, and only for the same path', async () => {
    const result = { data: { ok: 1 }, status: 200 }
    api.apiClient.mockResolvedValue(result)
    primePublicHub({ pathname: '/analytics', search: '' })
    expect(takePrimedPublicHub('/v1/public/hub?activityWindow=7d')).toBeNull()
    expect(hasPrimedPublicHub()).toBe(true)
    const taken = takePrimedPublicHub('/v1/public/hub?activityWindow=24h')
    await expect(taken).resolves.toBe(result)
    expect(takePrimedPublicHub('/v1/public/hub?activityWindow=24h')).toBeNull()
    expect(hasPrimedPublicHub()).toBe(false)
  })

  it('expires after 10 s', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'))
    api.apiClient.mockReturnValue(new Promise(() => {}))
    primePublicHub({ pathname: '/analytics', search: '' })
    vi.advanceTimersByTime(PRIMED_HUB_TTL_MS)
    expect(hasPrimedPublicHub()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(hasPrimedPublicHub()).toBe(false)
    expect(takePrimedPublicHub('/v1/public/hub?activityWindow=24h')).toBeNull()
  })

  // Nobody reads it any more: the origin need not go on building it.
  it('ends the request once nobody can adopt it', () => {
    vi.useFakeTimers()
    api.apiClient.mockReturnValue(new Promise(() => {}))
    primePublicHub({ pathname: '/analytics', search: '' })
    const primedSignal = primedRequestSignal()
    vi.advanceTimersByTime(PRIMED_HUB_TTL_MS)
    expect(primedSignal.aborted).toBe(false)
    vi.advanceTimersByTime(1)
    expect(primedSignal.aborted).toBe(true)
  })

  it('drops the primed request when the backend changed', () => {
    api.apiClient.mockReturnValue(new Promise(() => {}))
    primePublicHub({ pathname: '/analytics', search: '' })
    api.backend = 'http://localhost:8081'
    expect(takePrimedPublicHub('/v1/public/hub?activityWindow=24h')).toBeNull()
    expect(primedRequestSignal().aborted).toBe(true)
    api.backend = 'https://api.streampulse.stream'
    expect(takePrimedPublicHub('/v1/public/hub?activityWindow=24h')).toBeNull()
  })

  it('rejects an aborted adopter and puts the request back for the next one', async () => {
    const gate = deferred<{ data: unknown; status: number }>()
    api.apiClient.mockReturnValue(gate.promise)
    primePublicHub({ pathname: '/analytics', search: '' })
    const controller = new AbortController()
    const first = takePrimedPublicHub('/v1/public/hub?activityWindow=24h', controller.signal)!
    expect(hasPrimedPublicHub()).toBe(false)
    controller.abort()
    await expect(first).rejects.toEqual({ kind: 'aborted', message: 'Request was cancelled', status: 0 })
    expect(hasPrimedPublicHub()).toBe(true)
    const second = takePrimedPublicHub('/v1/public/hub?activityWindow=24h', new AbortController().signal)!
    gate.resolve({ data: 'body', status: 200 })
    await expect(second).resolves.toEqual({ data: 'body', status: 200 })
    expect(api.apiClient).toHaveBeenCalledTimes(1)
    // Adopted again in the same tick, as a StrictMode remount does: it runs on.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(primedRequestSignal().aborted).toBe(false)
    // An already-aborted signal never adopts.
    const aborted = new AbortController()
    aborted.abort()
    expect(takePrimedPublicHub('/v1/public/hub?activityWindow=24h', aborted.signal)).toBeNull()
  })

  it('ends the request when its adopter leaves and nobody takes it back', async () => {
    api.apiClient.mockReturnValue(new Promise(() => {}))
    primePublicHub({ pathname: '/analytics', search: '' })
    const controller = new AbortController()
    const first = takePrimedPublicHub('/v1/public/hub?activityWindow=24h', controller.signal)!
    controller.abort()
    await expect(first).rejects.toMatchObject({ kind: 'aborted' })
    // The page moved to another window in the same tick.
    expect(takePrimedPublicHub('/v1/public/hub?activityWindow=7d', new AbortController().signal)).toBeNull()
    expect(primedRequestSignal().aborted).toBe(false)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(primedRequestSignal().aborted).toBe(true)
    expect(hasPrimedPublicHub()).toBe(false)
  })

  it('ends the adopted request when the hook moves to another window', async () => {
    api.apiClient.mockImplementation((path: string) =>
      path.includes('=24h') ? new Promise(() => {}) : Promise.resolve({ data: hubBody(10_080), status: 200 }))
    primePublicHub({ pathname: '/analytics', search: '' })
    const { rerender, unmount } = renderHook(
      ({ activityWindow }: { activityWindow: '24h' | '7d' }) => usePublicHubData({ enabled: true, activityWindow, pollMs: 0 }),
      { initialProps: { activityWindow: '24h' } },
    )
    expect(hasPrimedPublicHub()).toBe(false)
    rerender({ activityWindow: '7d' })
    await waitFor(() => expect(primedRequestSignal().aborted).toBe(true))
    unmount()
  })

  it('never leaves an unhandled rejection when nobody adopts', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      api.apiClient.mockReturnValue(Promise.reject({ kind: 'network', message: 'offline', status: 0 }))
      primePublicHub({ pathname: '/analytics', search: '' })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})

describe('hub early fetch: parity with the first read on mount (plan §2.6)', () => {
  for (const search of ['', '?window=7d', '?activityWindow=30m', '?window=1y', '?window=bogus', '?window=3m&activityWindow=30m']) {
    it(`adopts the primed request for "/analytics${search}"`, async () => {
      const windowKey = parseHubWindowParam(search)
      const minutes = { '30m': 30, '24h': 1440, '7d': 10080, '1m': 43200, '3m': 129600, '1y': 525600 }[windowKey]
      api.apiClient.mockImplementation(async (path: string) => ({ data: hubBody(path.includes('=30m') ? 30 : minutes), status: 200 }))
      const primed = primePublicHub({ pathname: '/analytics', search })
      // The page mounts the hook with the window from the same rule (AnalyticsHubV5Page `usePublicHubData({ enabled: true, activityWindow })`).
      const { result, unmount } = renderHook(() => usePublicHubData({ enabled: true, activityWindow: windowKey, pollMs: 0 }))
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(api.apiClient.mock.calls[0][0]).toBe(primed)
      expect(api.apiClient.mock.calls.filter(([path]) => path === primed)).toHaveLength(1)
      expect(hasPrimedPublicHub()).toBe(false)
      expect(result.current.hubEndpointOk).toBe(true)
      unmount()
    })
  }
})

describe('hub early fetch: import boundary', () => {
  it('imports only ./apiClient, ./portalTimeouts and ./hubWindows', () => {
    const source = readFileSync(resolve(__dirname, '../src/lib/hubEarlyFetch.ts'), 'utf8')
    const imports = [...source.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map(match => match[1])
    expect(imports.sort()).toEqual(['./apiClient', './hubWindows', './portalTimeouts'])
    expect(source).not.toMatch(/import\(/)
  })

  it('pulls neither packages/* nor publicHub.ts in, even transitively', () => {
    const seen = new Set<string>()
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      const source = readFileSync(file, 'utf8')
      for (const [, spec] of source.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
        expect(spec).not.toMatch(/^@streampulse\//)
        expect(spec).not.toContain('packages/')
        expect(spec).not.toMatch(/publicHub$/)
        if (spec.startsWith('.')) visit(resolve(file, '..', `${spec.replace(/\.ts$/, '')}.ts`))
      }
    }
    visit(resolve(__dirname, '../src/lib/hubEarlyFetch.ts'))
    expect([...seen].map(file => file.replace(/\\/g, '/').split('/src/lib/')[1]).sort()).toEqual(
      expect.arrayContaining(['apiClient.ts', 'hubEarlyFetch.ts', 'hubWindows.ts', 'portalTimeouts.ts']),
    )
    expect([...seen].some(file => /publicHub\.ts$/.test(file))).toBe(false)
  })
})
