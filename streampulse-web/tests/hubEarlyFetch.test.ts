import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hasPrimedPublicHub,
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  // The primed hand-over is the d3-v5 hub's (VITE_PUBLIC_HUB_V5); the flag-off case is tested below.
  vi.stubEnv('VITE_PUBLIC_HUB_V5', 'on')
  resetPrimedPublicHubForTests()
  clearPublicHubCacheForTests()
  localStorage.clear()
  api.apiClient.mockReset()
  api.backend = 'https://api.streampulse.stream'
})

afterEach(() => {
  vi.unstubAllEnvs()
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
  })

  it('primes only /analytics, reading the window like the page', () => {
    expect(primedHubRequestForLocation({ pathname: '/analytics', search: '' })).toEqual({
      path: '/v1/public/hub?activityWindow=24h', activityWindow: '24h', timeoutMs: SLOW_READ_TIMEOUT_MS,
    })
    expect(primedHubRequestForLocation({ pathname: '/analytics/', search: '?window=7d' })?.path).toBe('/v1/public/hub?activityWindow=7d')
    expect(primedHubRequestForLocation({ pathname: '/analytics', search: '?activityWindow=30m' })).toMatchObject({ activityWindow: '30m', timeoutMs: undefined })
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
    expect(api.apiClient).toHaveBeenCalledWith('/v1/public/hub?activityWindow=7d', { timeoutMs: SLOW_READ_TIMEOUT_MS })
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

  it('drops the primed request when the backend changed', () => {
    api.apiClient.mockReturnValue(new Promise(() => {}))
    primePublicHub({ pathname: '/analytics', search: '' })
    api.backend = 'http://localhost:8081'
    expect(takePrimedPublicHub('/v1/public/hub?activityWindow=24h')).toBeNull()
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
    // An already-aborted signal never adopts.
    const aborted = new AbortController()
    aborted.abort()
    expect(takePrimedPublicHub('/v1/public/hub?activityWindow=24h', aborted.signal)).toBeNull()
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
      // The page mounts the hook with the window from the same rule (AnalyticsLandingPage `usePublicHubData({ enabled: true, activityWindow })`).
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

describe('hub early fetch: VITE_PUBLIC_HUB_V5 off', () => {
  it('never adopts a primed request: the hook makes its own read, as before', async () => {
    vi.stubEnv('VITE_PUBLIC_HUB_V5', '')
    api.apiClient.mockImplementation(async () => ({ data: hubBody(1440), status: 200 }))
    const primed = primePublicHub({ pathname: '/analytics', search: '' })
    const { result, unmount } = renderHook(() => usePublicHubData({ enabled: true, activityWindow: '24h', pollMs: 0 }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(api.apiClient.mock.calls.filter(([path]) => path === primed)).toHaveLength(2)
    expect(hasPrimedPublicHub()).toBe(true)
    unmount()
  })
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
