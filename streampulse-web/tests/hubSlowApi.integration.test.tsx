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
import { normalizePublicHub, type HubLiveChannel, type HubLivePulseMoment, type HubMoment, type PublicHub } from '../src/lib/publicHub'
import { clearPublicHubCacheForTests, writePublicHubCache } from '../src/lib/publicHubCache'
import AnalyticsHubV5Page from '../src/routes/analytics/AnalyticsHubV5Page'
import { TOP_NONE } from '../src/ui/components/hub/v5/HubV5TopMoments'
import { hubClock, hubSavedClock } from '../src/ui/components/hub/v5/hubV5Model'

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

/** A whole comparison as the hub sends it, so the page's reader keeps it: chat 3× the 40 minutes before `at`. */
function comparison(at: number) {
  const end = Math.floor(at / MIN) * MIN
  const sample = { currentMeasuredMinutes: 1, currentExpectedMinutes: 1, baselineMeasuredMinutes: 40, baselineExpectedMinutes: 40, baselineCoveragePct: 100 }
  return {
    baselineKind: 'current_stream_measured_average_before_event',
    eventAt: at,
    baselineWindow: { start: end - 40 * MIN, end, expectedMinutes: 40, measuredMinutes: 40, coveragePct: 100 },
    chat: { state: 'ready', currentPerMin: 300, baselinePerMin: 100, absoluteDeltaPerMin: 200, changePct: 200, multiplier: 3, ...sample },
    emotes: { state: 'ready', currentPerMin: 40, baselinePerMin: 40, absoluteDeltaPerMin: 0, changePct: 0, multiplier: 1, ...sample },
    evidence: { ircBound: true, eventRollupAvailable: true, baselineMeasuredMinutes: 40, baselineExpectedMinutes: 40, baselineCoveragePct: 100 },
  }
}

/** A hub body with one Top moments row: `who`'s chat at 3× its own average, an hour in. */
function hubBody(asOf: number, who: string, windowMinutes = 1440): PublicHub {
  const base = normalizePublicHub(null)
  return {
    ...base,
    generatedAt: iso(asOf),
    poolSize: 500,
    activity: { ...base.activity, windowMinutes, channelCount: 1, points: [] },
    liveChannels: [channel(who, { startedAt: iso(asOf - 62 * MIN), viewers: 7000, screenerV1: screener(asOf) })],
    moments: [{ kind: 'chat_spike', login: who, displayName: who.toUpperCase(), label: 'Chat spike', at: asOf - 2 * MIN } as HubMoment],
    livePulseMoments: [{
      login: who, displayName: who.toUpperCase(), streamId: `s-${who}`, offsetSeconds: 3600, at: asOf - 2 * MIN, score: 80, label: 'Chat spike',
      chatPerMin: 300, emotesPerMin: 40, category: 'Just Chatting', comparison: comparison(asOf - 2 * MIN),
    } as unknown as HubLivePulseMoment],
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

/** Top moments today and its phone peek wait in grey rows, and nothing stands in for them. */
function expectTopLoading() {
  expect(within(rail()).getByRole('status').textContent).toBe('Loading top moments')
  expect(rail().querySelector('.hv5-tm-it')).toBeNull()
  expect(peek().hasAttribute('data-wait')).toBe(true)
}

/** Both say "Unavailable right now."; the one Try again is the banner's (Q5b). */
function expectTopUnavailable() {
  expect(rail().querySelector('.hv5-tm-q')!.textContent).toBe(TOP_NONE)
  expect(within(rail()).queryByRole('button', { name: 'Try again' })).toBeNull()
  expect([...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('Try again'))).toHaveLength(1)
  expect(within(peek()).getByText(TOP_NONE)).toBeTruthy()
  expect(within(rail()).queryByRole('status')).toBeNull()
}

function expectTopRows(who: string) {
  expect(within(rail()).getByRole('button', { name: new RegExp(`^1\\. ${who}, chat 3\\.0 times usual`) })).toBeTruthy()
  expect(within(peek()).getByRole('button', { name: new RegExp(`^1\\. ${who}, `) })).toBeTruthy()
  expect(within(rail()).queryByRole('status')).toBeNull()
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
  it('first visit, the 24h read answers at 40 s: Top moments loads, then shows its rows, from one request', async () => {
    plan = { hub24: [40_000], hub30: [-1] }
    render(page())
    await at(10)
    expectTopLoading()
    expect(bannerText()).toBe('')
    expectCardsWaiting()

    for (const sec of [21, 39]) {
      await at(sec)
      expectTopLoading()
      // Past the deadline: one plain line, and no Try again to start the read over.
      expect(bannerText()).toBe('Live data is slow — still loading…')
      expect(enabledRetry()).toBeNull()
      expectCardsWaiting()
    }

    await at(41)
    expectTopRows('ALPHA')
    expect(bannerText()).not.toContain('slow')
    expect(requests('24h')).toBe(1)
    expect(requests('30m')).toBe(1)
  })

  it('both reads hit the hard cap: unavailable at last, Top moments and its peek still on screen', async () => {
    plan = { hub24: [-1], hub30: [-1] }
    render(page())
    for (const sec of [21, 89]) {
      await at(sec)
      expectTopLoading()
      expect(bannerText()).toBe('Live data is slow — still loading…')
      expect(enabledRetry()).toBeNull()
      expectCardsWaiting()
    }

    await at(92)
    expectTopUnavailable()
    expect(peek().querySelector('h2')!.textContent).toBe('Top today')
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
    expectTopLoading()
    expect(requests('24h')).toBe(1)

    await at(52)
    expectTopRows('THIRTY')
    expect(requests('24h')).toBe(1)
    expect(requests('30m')).toBe(1)
  })

  it('a saved copy two hours old: its rows with its time, refreshing, then the hub answer', async () => {
    vi.setSystemTime(T0 - 120 * MIN)
    writePublicHubCache(getBackendUrl(), '24h', savedBody(Date.now(), 'bravo'))
    vi.setSystemTime(T0)
    plan = { hub24: [40_000], hub30: [-1] }
    render(page())
    const saved = hubClock(T0 - 120 * MIN)
    const note = () => document.querySelector('.figma-hub-fallback-banner--info')?.textContent ?? ''
    const fresh = () => peek().querySelector('.hv5-f2-fresh')!.textContent
    expectTopRows('BRAVO')
    expect(fresh()).toBe(`Saved ${hubSavedClock(T0 - 120 * MIN, T0)}`)
    expect(note()).toBe(`Cached snapshot · Saved at ${saved} · refreshing...`)

    await at(21)
    expect(fresh()).toBe(`Saved ${hubSavedClock(T0 - 120 * MIN, Date.now())}`)
    expect(note()).toBe(`Cached snapshot · Saved at ${saved} · refreshing...`)
    expect(bannerText()).toContain('Live data is slow — still loading…')
    expect(bannerText()).toContain('Coverage status is unknown in this snapshot')
    expect(enabledRetry()).toBeNull()

    await at(41)
    expectTopRows('ALPHA')
    expect(fresh()).toMatch(/^as of /)
    expect(note()).toBe('')
    expect(requests('24h')).toBe(1)
  })

  // D6: a StrictMode remount takes the primed read back; it is never started twice.
  it('adopts the request main.tsx primed, under StrictMode, with one 24h request', async () => {
    plan = { hub24: [40_000], hub30: [-1] }
    primePublicHub({ pathname: '/analytics', search: '' })
    render(page(true))
    await at(21)
    expectTopLoading()
    await at(41)
    expectTopRows('ALPHA')
    expect(requests('24h')).toBe(1)
  })
})
