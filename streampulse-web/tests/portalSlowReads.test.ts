import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsStreamDetail } from '@streampulse/analytics-console'
import { apiClient } from '../src/lib/apiClient'
import { fetchNewsroom } from '../src/lib/newsroom'
import { fetchPublicHubBase } from '../src/lib/publicHub'
import { SLOW_READ_TIMEOUT_MS } from '../src/lib/portalTimeouts'
import { portalAnalyticsApi } from '../src/lib/streamcloneAnalytics'
import portalTimingFixture from './fixtures/portal_vod_timing_v1.json'

// OP1-RES-002 / CX-RES-005 (CIR-M5b): a slow but successful first-paint read
// must not be cut by the 8 s default deadline. Every request is answered by a
// stubbed fetch; nothing leaves the test process.

const hubBody = {
  generatedAt: '2026-10-05T12:00:00.000Z',
  poolSize: 0,
  corpus: { streamsTracked: 1, momentsDetected: 0, chatMessagesProcessed: 0, emotesIndexed: 0, vodsAnalyzed: 0 },
  coverage: { databaseOk: true, state: 'operational' },
  activity: { points: [], channelCount: 0, windowMinutes: 1440 },
  liveChannels: [],
  moments: [],
  topEmotes: [],
  topMovers: [],
}

type Reply = { delayMs?: number; status?: number; body: unknown }

function stubFetch(reply: (url: string) => Reply) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const { delayMs = 0, status = 200, body } = reply(String(input))
    if (delayMs <= 0) return Promise.resolve(new Response(JSON.stringify(body), { status }))
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response(JSON.stringify(body), { status })), delayMs)
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal?.reason) }, { once: true })
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function settle<T>(promise: Promise<T>) {
  return promise.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))
}

describe('slow first-paint reads', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps the 8 s default for ordinary calls', async () => {
    stubFetch(() => ({ delayMs: 9_000, body: hubBody }))
    const result = settle(apiClient('/v1/public/hub?activityWindow=24h'))
    await vi.advanceTimersByTimeAsync(9_000)
    expect(await result).toMatchObject({ ok: false, error: { kind: 'timeout' } })
  })

  it('renders a hub body that arrives after 9 s', async () => {
    expect(SLOW_READ_TIMEOUT_MS).toBeGreaterThan(9_000)
    stubFetch(() => ({ delayMs: 9_000, body: hubBody }))
    const result = settle(fetchPublicHubBase(undefined, '24h'))
    await vi.advanceTimersByTimeAsync(9_000)
    const settled = await result
    expect(settled.ok).toBe(true)
    expect(settled.ok && settled.value.hubEndpointOk).toBe(true)
  })

  it('lets a caller keep the 8 s default for the small recovery read', async () => {
    stubFetch(() => ({ delayMs: 9_000, body: hubBody }))
    const result = settle(fetchPublicHubBase(undefined, '30m', undefined, 8_000))
    await vi.advanceTimersByTimeAsync(9_000)
    expect(await result).toMatchObject({ ok: false, error: { kind: 'timeout' } })
  })

  it('still reports a hub body that never arrives as a timeout', async () => {
    stubFetch(() => ({ delayMs: SLOW_READ_TIMEOUT_MS + 5_000, body: hubBody }))
    const result = settle(fetchPublicHubBase(undefined, '24h'))
    await vi.advanceTimersByTimeAsync(SLOW_READ_TIMEOUT_MS)
    expect(await result).toMatchObject({ ok: false, error: { kind: 'timeout' } })
  })

  it('renders a session detail that arrives after 9 s', async () => {
    stubFetch(url => url.includes('/minutes')
      ? { body: { minutes: [] } }
      : { delayMs: 9_000, body: portalTimingFixture })
    const result = settle(portalAnalyticsApi.getAnalyticsStream('321192454233', { sparse: false }))
    await vi.advanceTimersByTimeAsync(9_000)
    await vi.advanceTimersByTimeAsync(100)
    const settled = await result
    expect(settled.ok).toBe(true)
    expect(settled.ok && (settled.value as AnalyticsStreamDetail).stream?.streamId).toBe('321192454233')
  }, 10_000)

  it('renders a hosted channel live frame that arrives after 9 s', async () => {
    stubFetch(() => ({ delayMs: 9_000, body: { channel: 'xqc', state: 'not_collected', rollups: [], topEmotes: [], sources: [], updatedAt: 0 } }))
    const result = settle(portalAnalyticsApi.getAnalyticsLive('xqc'))
    await vi.advanceTimersByTimeAsync(9_000)
    const settled = await result
    expect(settled.ok).toBe(true)
    expect(settled.ok && (settled.value as AnalyticsStreamDetail).state).toBe('not_collected')
  })

  it('does not cut a legacy session story read at 8 s; the story list keeps 8 s', async () => {
    // The 9 s body reaches validation (and is rejected as malformed) instead of
    // being aborted, which is the deadline behaviour under test.
    stubFetch(() => ({ delayMs: 9_000, body: {} }))
    const story = settle(fetchNewsroom({ storyId: 'story-1' }))
    const list = settle(fetchNewsroom())
    await vi.advanceTimersByTimeAsync(9_000)
    expect(await story).toMatchObject({ ok: false, error: { message: 'Malformed newsroom response' } })
    expect(await list).toMatchObject({ ok: false, error: { kind: 'timeout' } })
  })
})

describe('channel live read failures', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('rejects instead of answering an empty "unknown" frame', async () => {
    vi.useFakeTimers()
    stubFetch(() => ({ status: 500, body: { error: 'stream_unavailable' } }))
    const result = settle(portalAnalyticsApi.getAnalyticsLive('xqc'))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await result).toMatchObject({ ok: false, error: { kind: 'server', status: 500 } })
  })

  it('still maps a genuinely empty channel answer', async () => {
    stubFetch(() => ({ body: { channel: 'xqc', state: 'not_collected', rollups: [], topEmotes: [], sources: [], updatedAt: 0 } }))
    const live = await portalAnalyticsApi.getAnalyticsLive('xqc') as AnalyticsStreamDetail
    expect(live.state).toBe('not_collected')
  })
})
