/**
 * /analytics against a slow hub API (U8, 10-28). The real page, the real
 * usePublicHubData and the real apiClient, with fetch stubbed by URL and each
 * reply delayed on fake timers. The live API builds a cold hub body in 17 s to
 * over 30 s; the page waits on it to the hard cap, says so plainly, and never
 * reads the wait as given up. Nothing here reaches the live API.
 */
import { StrictMode } from 'react'
import { act, cleanup, render, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getBackendUrl } from '../src/lib/apiClient'
import type { HubChannelScreenerV1 } from '../src/lib/channelScreenerContract'
import { primePublicHub, resetPrimedPublicHubForTests } from '../src/lib/hubEarlyFetch'
import { normalizePublicHub, type HubLiveChannel, type HubMoment, type PublicHub } from '../src/lib/publicHub'
import { clearPublicHubCacheForTests, writePublicHubCache } from '../src/lib/publicHubCache'
import AnalyticsHubV5Page from '../src/routes/analytics/AnalyticsHubV5Page'
import { hubClock } from '../src/ui/components/hub/v5/hubV5Model'

const MIN = 60_000
const T0 = new Date(2026, 9, 28, 10, 55).getTime()
const iso = (t: number) => new Date(t).toISOString()

function screener(at: number): HubChannelScreenerV1 {
  const metric = {
    state: 'ready', currentPerMin: 120, baselinePerMin: 60, absoluteDeltaPerMin: 60, changePct: 100, multiplier: 2,
    currentMeasuredMinutes: 5, currentExpectedMinutes: 5, baselineMeasuredMinutes: 40, baselineExpectedMinutes: 40, baselineCoveragePct: 100,
  }
  return {
    version: 1,
    measuredAt: at,
    baselineKind: 'current_stream_measured_average',
    state: 'ready',
    currentWindow: { start: at - 5 * MIN, end: at, expectedMinutes: 5, measuredMinutes: 5, coveragePct: 100 },
    baselineWindow: null,
    baselineMeasuredMinutes: 40,
    evidence: null,
    chat: metric,
    emotes: null,
  } as unknown as HubChannelScreenerV1
}

const channel = (login: string, over: Partial<HubLiveChannel> = {}): HubLiveChannel => ({
  login,
  displayName: login.toUpperCase(),
  category: 'Just Chatting',
  streamId: `s-${login}`,
  viewers: 1000,
  chatPerMin: 0,
  seventvPerMin: 0,
  coverageState: 'synced',
  trendPct: 0,
  ...over,
}) as HubLiveChannel

/** A hub body with one feed row: `who`'s chat spike, on the screener's word. */
function hubBody(asOf: number, who: string, windowMinutes = 1440): PublicHub {
  const base = normalizePublicHub(null)
  return {
    ...base,
    generatedAt: iso(asOf),
    poolSize: 500,
    activity: { ...base.activity, windowMinutes, channelCount: 1, points: [] },
    liveChannels: [channel(who, { startedAt: iso(asOf - 9 * MIN), viewers: 7000, screenerV1: screener(asOf) })],
    moments: [{ kind: 'chat_spike', login: who, displayName: who.toUpperCase(), label: 'Chat spike', at: asOf - 2 * MIN } as HubMoment],
  } as PublicHub
}

/** A hub answer as the page saves it: only one that names its corpus pipeline is kept. */
function savedBody(asOf: number, who: string): PublicHub {
  return normalizePublicHub({
    ...hubBody(asOf, who),
    corpusPipeline: {
      topN: 500,
      state: 'healthy',
      generatedAt: iso(asOf),
      collectorActive: 10,
      collectorMax: 50,
      roster: {
        live: 1, collectorTracking: 1, expectedCollectorRows: 1, liveCollectorDeficitRows: 0,
        metadataOnly: 0, metadataStale: 0, admissionDisabled: 0, capacityBlocked: 0,
        warming: 0, collecting: 1, viewerOnly: 0, zeroChatAfterAge: 0,
      },
    },
  })
}

/** One reply: after `ms`, with `status` (200 by default); a negative `ms` never answers. */
type Reply = number | { ms: number; status: number }
let plan: { hub24: Reply[]; hub30: Reply[] }
let served = { hub24: 0, hub30: 0 }

function reply(r: Reply, body: () => unknown, signal?: AbortSignal | null): Promise<Response> {
  const { ms, status } = typeof r === 'number' ? { ms: r, status: 200 } : r
  return new Promise((resolve, reject) => {
    const timer = ms < 0 ? undefined : setTimeout(() => resolve(new Response(JSON.stringify(status === 200 ? body() : { error: 'gateway' }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })), ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')) }, { once: true })
  })
}

const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input))
  const signal = init?.signal
  if (url.pathname === '/v1/public/hub') {
    const window = url.searchParams.get('activityWindow')
    if (window === '24h') return reply(plan.hub24[served.hub24++] ?? -1, () => hubBody(Date.now(), 'alpha'), signal)
    if (window === '30m') return reply(plan.hub30[served.hub30++] ?? -1, () => hubBody(Date.now(), 'thirty', 30), signal)
  }
  if (url.pathname === '/v1/public/stats') {
    return reply(200, () => ({ updatedAt: iso(Date.now()), streamsTracked: 10, momentsDetected: 5, chatMessagesProcessed: 100, emotesIndexed: 3, vodsAnalyzed: 1 }), signal)
  }
  if (url.pathname === '/v1/public/status') return reply(200, () => ({ updatedAt: iso(Date.now()), components: { api: 'up' }, status: 'ok' }), signal)
  return reply(-1, () => null, signal)
})

/** Hub requests made for `window`. */
const requests = (window: '24h' | '30m') => fetchMock.mock.calls.filter(([input]) => {
  const url = new URL(String(input))
  return url.pathname === '/v1/public/hub' && url.searchParams.get('activityWindow') === window
}).length

const page = (strict = false) => {
  const tree = <MemoryRouter initialEntries={['/analytics']}><AnalyticsHubV5Page /></MemoryRouter>
  return strict ? <StrictMode>{tree}</StrictMode> : tree
}
const rail = () => document.getElementById('latest')!
const peek = () => document.querySelector<HTMLElement>('.hv5-f3-peek')!
const bannerText = () => document.querySelector('.hx-health-banner')?.textContent ?? ''
const enabledRetry = () =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Try again') && !b.disabled) ?? null

/** Runs the clock to `sec` seconds after the page opened. */
async function at(sec: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(Math.max(0, T0 + sec * 1000 - Date.now())) })
}

/** The feed and its phone peek both say `line`, and nothing else stands in for rows. */
function expectFeedSays(line: string) {
  expect(within(rail()).getByText(line)).toBeTruthy()
  expect(within(peek()).getByText(line)).toBeTruthy()
}

function expectFeedRows(who: string) {
  expect(within(rail()).getAllByText(who).length).toBeGreaterThan(0)
  expect(within(peek()).getAllByText(who).length).toBeGreaterThan(0)
  expect(document.body.textContent).not.toContain('Loading live feed…')
  expect(peek().hasAttribute('data-wait')).toBe(false)
}

function expectCardsWaiting() {
  expect(document.querySelector('#busiest .hv5-bzs-wait')).toBeTruthy()
  expect(document.querySelector('#channels')!.getAttribute('aria-busy')).toBe('true')
  expect(document.body.textContent).not.toContain('Unavailable right now.')
  expect(document.body.textContent).not.toContain('Measured activity unavailable')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  localStorage.clear()
  clearPublicHubCacheForTests()
  resetPrimedPublicHubForTests()
  served = { hub24: 0, hub30: 0 }
})

afterEach(() => {
  cleanup()
  resetPrimedPublicHubForTests()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('/analytics on a slow hub API (U8)', () => {
  it('first visit, the 24h read answers at 40 s: the feed loads, then shows its rows, from one request', async () => {
    plan = { hub24: [40_000], hub30: [-1] }
    render(page())
    await at(10)
    expectFeedSays('Loading live feed…')
    expect(bannerText()).toBe('')
    expectCardsWaiting()

    for (const sec of [21, 39]) {
      await at(sec)
      expectFeedSays('Loading live feed…')
      expect(peek().hasAttribute('data-wait')).toBe(true)
      // Past the deadline: one plain line, and no Try again to start the read over.
      expect(bannerText()).toBe('Live data is slow — still loading…')
      expect(enabledRetry()).toBeNull()
      expectCardsWaiting()
    }

    await at(41)
    expectFeedRows('ALPHA')
    expect(bannerText()).not.toContain('slow')
    expect(requests('24h')).toBe(1)
    expect(requests('30m')).toBe(1)
  })

  it('both reads hit the hard cap: unavailable at last, the feed and peek still on screen', async () => {
    plan = { hub24: [-1], hub30: [-1] }
    render(page())
    for (const sec of [21, 89]) {
      await at(sec)
      expectFeedSays('Loading live feed…')
      expect(bannerText()).toBe('Live data is slow — still loading…')
      expect(enabledRetry()).toBeNull()
      expectCardsWaiting()
    }

    await at(92)
    expectFeedSays('Unavailable right now.')
    expect(peek().querySelector('h2')!.textContent).toBe('Live now')
    expect(within(document.querySelector<HTMLElement>('#busiest')!).getByText('Unavailable right now.')).toBeTruthy()
    expect(document.body.textContent).toContain('Measured activity unavailable')
    expect(bannerText()).toContain('Hub temporarily unavailable')
    expect(enabledRetry()).toBeTruthy()
    expect(requests('24h')).toBe(1)
    expect(requests('30m')).toBe(1)
  })

  // D4, D7: a 504 is not asked again, and the 30m view still under way fills the page.
  it('reads each window once on a cold load whose 24h read gets a 504', async () => {
    plan = { hub24: [{ ms: 35_000, status: 504 }], hub30: [50_000] }
    render(page())
    await at(36)
    expectFeedSays('Loading live feed…')
    expect(requests('24h')).toBe(1)

    await at(52)
    expectFeedRows('THIRTY')
    expect(requests('24h')).toBe(1)
    expect(requests('30m')).toBe(1)
  })

  it('a saved copy two hours old: headed with its time, refreshing, then the hub answer', async () => {
    vi.setSystemTime(T0 - 120 * MIN)
    writePublicHubCache(getBackendUrl(), '24h', savedBody(Date.now(), 'bravo'))
    vi.setSystemTime(T0)
    plan = { hub24: [40_000], hub30: [-1] }
    render(page())
    const saved = hubClock(T0 - 120 * MIN)
    const note = () => document.querySelector('.figma-hub-fallback-banner--info')?.textContent ?? ''
    expect(peek().querySelector('h2')!.textContent).toBe(`Saved ${saved}`)
    expect(note()).toBe(`Cached snapshot · Saved at ${saved} · refreshing...`)

    await at(21)
    expect(peek().querySelector('h2')!.textContent).toBe(`Saved ${saved}`)
    expect(note()).toBe(`Cached snapshot · Saved at ${saved} · refreshing...`)
    expect(bannerText()).toContain('Live data is slow — still loading…')
    expect(bannerText()).toContain('Coverage status is unknown in this snapshot')
    expect(enabledRetry()).toBeNull()

    await at(41)
    expectFeedRows('ALPHA')
    expect(peek().querySelector('h2')!.textContent).toBe('Live now')
    expect(note()).toBe('')
    expect(requests('24h')).toBe(1)
  })

  // D6: a StrictMode remount takes the primed read back; it is never started twice.
  it('adopts the request main.tsx primed, under StrictMode, with one 24h request', async () => {
    plan = { hub24: [40_000], hub30: [-1] }
    primePublicHub({ pathname: '/analytics', search: '' })
    render(page(true))
    await at(21)
    expectFeedSays('Loading live feed…')
    await at(41)
    expectFeedRows('ALPHA')
    expect(requests('24h')).toBe(1)
  })
})
