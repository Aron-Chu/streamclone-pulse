/**
 * /analytics with no hub answer on screen (10-28): the Live feed and its phone
 * peek stay in every state. Totals only or nothing: "Loading live feed…" while
 * a hub read runs, "Unavailable right now." once it gave up, never a quiet
 * hour; the cards wait with it and keep "Unavailable right now." through a
 * later poll's read (U1, U2). A saved copy waits with no rows, then names its
 * hour (Q1); Busiest now waits on it, Channels says when its count was live
 * (S1, U7) and the peek is headed with its time (U5); the note says its day
 * (N1). The hub hook is mocked and fetch never answers: no live API.
 */
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizePublicHub, type HubLiveChannel, type HubMoment, type PublicHub } from '../src/lib/publicHub'
import type { HubChannelScreenerV1 } from '../src/lib/channelScreenerContract'
import AnalyticsHubV5Page from '../src/routes/analytics/AnalyticsHubV5Page'
import { feedClockFloor } from '../src/ui/components/hub/v5/hubV5FeedModel'
import { hubClock } from '../src/ui/components/hub/v5/hubV5Model'

const MIN = 60_000
const NOW = new Date(2026, 9, 28, 10, 55).getTime()
const iso = (t: number) => new Date(t).toISOString()

const hubState = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('../src/hooks/usePublicHubData', () => ({ usePublicHubData: () => hubState.value }))

function setHub(over: Record<string, unknown>) {
  hubState.value = {
    data: null,
    loading: false,
    refreshing: false,
    activityRefreshing: false,
    error: null,
    loadSource: null,
    hubEndpointOk: true,
    liveEmpty: false,
    lastUpdated: null,
    lastSuccessfulPollAt: null,
    pollSequence: 1,
    cachedAt: null,
    retryBlocked: false,
    hubReadPending: false,
    hubReadRunning: false,
    hubReadLate: false,
    refresh: () => {},
    ...over,
  }
}

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

const hubWith = (asOf: number, liveChannels: HubLiveChannel[] = [], moments: HubMoment[] = []): PublicHub =>
  ({ ...normalizePublicHub(null), generatedAt: iso(asOf), poolSize: 500, liveChannels, moments }) as PublicHub

/** A hub answer with one row: ALPHA's chat spike, on the screener's word. */
const answered = (asOf = NOW - 20_000) => hubWith(
  asOf,
  [channel('alpha', { startedAt: iso(asOf - 9 * MIN), viewers: 7000, screenerV1: screener(asOf) })],
  [{ kind: 'chat_spike', login: 'alpha', displayName: 'ALPHA', label: 'Chat spike', at: asOf - 2 * MIN } as HubMoment],
)
/** The stats-only fallback: a fresh time, totals, and no rows at all. */
const totalsOnly = () => hubWith(NOW - 20_000)
/** A saved copy with channels on it but no feed rows. */
const savedCopy = (at: number) => hubWith(at, [channel('bravo'), channel('charlie'), channel('delta')])

const page = () => <MemoryRouter><AnalyticsHubV5Page /></MemoryRouter>
const rail = () => within(document.getElementById('latest')!)
const railEl = () => document.getElementById('latest')!
const peekEl = () => document.querySelector<HTMLElement>('.hv5-f3-peek')!

function expectWaiting(line: string) {
  // U6: the phone peek keeps its rows' height while it waits.
  expect(peekEl().hasAttribute('data-wait')).toBe(true)
  for (const el of [railEl(), peekEl()]) {
    expect(el).toBeTruthy()
    expect(within(el).getByText(line)).toBeTruthy()
    // grey dot, no time, no (i), and never a quiet hour
    expect(el.className).toContain('hv5-f2-stale')
    expect(el.querySelector('.hv5-f2-fresh')!.textContent).toBe('')
    expect(within(el).queryByText(/^Quiet right now/)).toBeNull()
    expect(within(el).queryByText(/^Nothing /)).toBeNull()
  }
  expect(rail().queryByRole('button', { name: 'About the Live feed' })).toBeNull()
}

/** The cards once the hub read gave up: Busiest now, the chart and Channels. */
function expectCardsUnavailable(container: HTMLElement) {
  expect(within(container.querySelector<HTMLElement>('#busiest')!).getByText('Unavailable right now.')).toBeTruthy()
  expect(container.querySelector('#busiest .hv5-bzc-pg-wait')).toBeNull()
  expect(within(container.querySelector<HTMLElement>('#channels')!).getByText('Unavailable right now.')).toBeTruthy()
  expect(screen.getByText('Measured activity unavailable')).toBeTruthy()
  expect(container.querySelector('[data-hub-bar-card-host]')).toBeNull()
}

/** The cards while the hub read runs: loading, never "Unavailable right now.". */
function expectCardsWaiting(container: HTMLElement) {
  expect(container.querySelector('#busiest .hv5-bzs-wait')).toBeTruthy()
  // The pager's room is kept, hidden and with nothing to press, so the header doesn't grow when the tiles land.
  const pagerRoom = container.querySelector('#busiest header .hv5-bzc-pg-wait')!
  expect(pagerRoom.getAttribute('aria-hidden')).toBe('true')
  expect(pagerRoom.querySelectorAll('.hv5-ib')).toHaveLength(2)
  expect(pagerRoom.querySelector('button')).toBeNull()
  expect(container.querySelector('#channels')!.getAttribute('aria-busy')).toBe('true')
  expect(screen.queryByText('Measured activity unavailable')).toBeNull()
  expect(within(container.querySelector<HTMLElement>('.hub-v5')!).queryAllByText('Unavailable right now.')).toHaveLength(0)
  // Kept in place for the answer.
  expect(container.querySelector('[data-hub-bar-card-host]')).toBeTruthy()
}

const banner = () => document.querySelector('.hx-health-banner')?.textContent ?? null

function expectRows() {
  expect(peekEl().hasAttribute('data-wait')).toBe(false)
  expect(peekEl().querySelector('h2')!.textContent).toBe('Live now')
  expect(rail().getAllByText('ALPHA').length).toBeGreaterThan(0)
  expect(within(peekEl()).getAllByText('ALPHA').length).toBeGreaterThan(0)
  expect(railEl().className).not.toContain('hv5-f2-stale')
  expect(railEl().querySelector('.hv5-f2-fresh')!.textContent).toMatch(/^as of /)
  expect(rail().getByRole('button', { name: 'About the Live feed' })).toBeTruthy()
  expect(screen.queryByText('Loading live feed…')).toBeNull()
  expect(rail().queryByText('Unavailable right now.')).toBeNull()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
  // nothing here may reach a real API
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('the Live feed with totals only or nothing (10-28)', () => {
  it('says it is loading while the hub read runs, then shows the hub answer with no extra click', () => {
    setHub({ data: totalsOnly(), loadSource: 'stats-fallback', hubReadPending: true, hubReadRunning: true, hubReadLate: true })
    const { container, rerender } = render(page())
    expectWaiting('Loading live feed…')
    expectCardsWaiting(container)
    // U4: nothing has failed yet, so no error and no Try again.
    expect(banner()).toBe('Live data is slow — still loading…')
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()

    setHub({ data: answered(), loadSource: 'full', hubReadPending: false, lastUpdated: NOW })
    rerender(page())
    expectRows()
  })

  it('says unavailable once the hub read gave up; a later poll’s read shows loading everywhere, slow only past its deadline', () => {
    setHub({ data: totalsOnly(), loadSource: 'stats-fallback', hubReadPending: false })
    const { container, rerender } = render(page())
    expectWaiting('Unavailable right now.')
    expectCardsUnavailable(container)
    expect(banner()).toContain('Hub temporarily unavailable')
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(false)

    // A poll's read: the feed and the cards wait on it; the banner keeps its text, Try again waits too.
    setHub({ data: totalsOnly(), loadSource: 'stats-fallback', refreshing: true, hubReadPending: true, hubReadRunning: true })
    rerender(page())
    expectWaiting('Loading live feed…')
    expectCardsWaiting(container)
    expect(banner()).toContain('Hub temporarily unavailable')
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(true)

    // Past its deadline it is called slow.
    setHub({ data: totalsOnly(), loadSource: 'stats-fallback', hubReadPending: true, hubReadRunning: true, hubReadLate: true })
    rerender(page())
    expect(banner()).toBe('Live data is slow — still loading…')

    // The read ended with no answer: back to unavailable.
    setHub({ data: totalsOnly(), loadSource: 'stats-fallback', hubReadPending: false })
    rerender(page())
    expectWaiting('Unavailable right now.')
    expectCardsUnavailable(container)

    setHub({ data: answered(), loadSource: 'full', hubReadPending: false })
    rerender(page())
    expectRows()
  })

  // U2: a read under way that the hook does not yet count as pending never reads as given up.
  it('never says unavailable while a first read loads', () => {
    setHub({ loading: true, hubReadPending: false })
    const { container } = render(page())
    expectWaiting('Loading live feed…')
    expectCardsWaiting(container)
  })

  // U2: another window's read is waited on, not given up for it.
  it('starts over on another window: its read is waited on, not given up', () => {
    let go!: (to: string) => void
    function Nav() {
      go = useNavigate()
      return null
    }
    setHub({ data: totalsOnly(), loadSource: 'stats-fallback', hubReadPending: false })
    const { container } = render(<MemoryRouter initialEntries={['/analytics?window=24h']}><AnalyticsHubV5Page /><Nav /></MemoryRouter>)
    expectCardsUnavailable(container)

    setHub({ data: totalsOnly(), loadSource: 'stats-fallback', refreshing: true, hubReadPending: true })
    act(() => go('/analytics?window=7d'))
    expectWaiting('Loading live feed…')
    expectCardsWaiting(container)
  })

  it('waits on the first read and says unavailable when both reads failed', () => {
    setHub({ loading: true, hubReadPending: true })
    const { rerender } = render(page())
    expectWaiting('Loading live feed…')

    setHub({ error: 'Hub unavailable', hubEndpointOk: false, hubReadPending: false })
    rerender(page())
    expectWaiting('Unavailable right now.')
    expect(screen.queryByText('No live data yet.')).toBeNull()
    // Nothing ever loaded: no "last loaded snapshot" to point at.
    expect(banner()).toContain('Live data is unavailable right now.')
    expect(banner()).not.toContain('last loaded snapshot')
    expect(document.querySelector('main[data-hub-state]')!.getAttribute('data-hub-state')).toBe('error')
  })

  it('reports a cold read under way as loading, not an error, even with its deadline error set', () => {
    setHub({ error: 'The hub took too long to respond.', hubEndpointOk: false, hubReadPending: true, hubReadRunning: true, hubReadLate: true })
    render(page())
    expect(document.querySelector('main[data-hub-state]')!.getAttribute('data-hub-state')).toBe('loading')
    expectWaiting('Loading live feed…')
  })

  it('keeps the quiet hour for a hub answer that has no rows', () => {
    setHub({ data: hubWith(NOW - 20_000), loadSource: 'full' })
    render(page())
    expect(rail().getByText('Quiet right now · nothing in the last hour')).toBeTruthy()
    expect(within(peekEl()).getByText('Quiet right now.')).toBeTruthy()
    expect(railEl().className).not.toContain('hv5-f2-stale')
  })
})

describe('a saved copy on screen (S1, Q1, N1, 10-28)', () => {
  const cachedAt = new Date(2026, 9, 28, 10, 50).getTime()

  it('waits on the hub read: feed and peek loading, Busiest now waiting, Channels timed', () => {
    setHub({ data: savedCopy(cachedAt), loadSource: 'cache', cachedAt, lastUpdated: cachedAt, hubReadPending: true })
    const { container } = render(page())
    expectWaiting('Loading live feed…')
    const busiest = container.querySelector('#busiest')!
    expect(busiest.querySelector('.hv5-bzs-wait')).toBeTruthy()
    expect(busiest.querySelector('.hv5-bzc-it')).toBeNull()
    expect(container.querySelector('[data-hv5-channel-count]')!.textContent).toBe(`3 of 500 live at ${hubClock(cachedAt)}`)
    expect(screen.getByText(`Cached snapshot · Saved at ${hubClock(cachedAt)} · refreshing...`)).toBeTruthy()
    // U5: never "Live now" over a saved copy.
    expect(peekEl().querySelector('h2')!.textContent).toBe(`Saved ${hubClock(cachedAt)}`)
  })

  it('names the saved hour once the read gave up, and Busiest now says it is unavailable', () => {
    setHub({ data: savedCopy(cachedAt), loadSource: 'cache', cachedAt, lastUpdated: cachedAt, hubReadPending: false })
    const { container } = render(page())
    const hour = feedClockFloor(cachedAt)
    expect(rail().getByText(`Nothing in the hour before ${hour}`)).toBeTruthy()
    expect(within(peekEl()).getByText(`Nothing in the hour before ${hour}.`)).toBeTruthy()
    expect(screen.queryByText(/^Quiet right now/)).toBeNull()
    expect(within(container.querySelector<HTMLElement>('#busiest')!).getByText('Unavailable right now.')).toBeTruthy()
    expect(peekEl().querySelector('h2')!.textContent).toBe(`Saved ${hubClock(cachedAt)}`)
    expect(peekEl().hasAttribute('data-wait')).toBe(false)
    expect(screen.getByText(`Cached snapshot · Saved at ${hubClock(cachedAt)}`)).toBeTruthy()
  })

  it('shows a saved copy’s own rows while the read runs', () => {
    const at = NOW - 10 * MIN
    setHub({ data: answered(at), loadSource: 'cache', cachedAt: at, lastUpdated: at, hubReadPending: true })
    render(page())
    expect(rail().getAllByText('ALPHA').length).toBeGreaterThan(0)
    expect(screen.queryByText('Loading live feed…')).toBeNull()
  })

  it('says the day on a copy saved before today', () => {
    const late = new Date(2026, 9, 27, 23, 30).getTime()
    setHub({ data: savedCopy(late), loadSource: 'cache', cachedAt: late, lastUpdated: late, hubReadPending: true })
    const { container } = render(page())
    expect(screen.getByText(`Cached snapshot · Saved yesterday, ${hubClock(late)} · refreshing...`)).toBeTruthy()
    expect(screen.getByText(/^Cached snapshot · Saved yesterday, 11:30\sPM · refreshing\.\.\.$/)).toBeTruthy()
    // U7: no "at" before a day.
    expect(container.querySelector('[data-hv5-channel-count]')!.textContent).toMatch(/^3 of 500 live yesterday, 11:30\sPM$/)
    expect(peekEl().querySelector('h2')!.textContent).toMatch(/^Saved yesterday, 11:30\sPM$/)
  })

  it('updates the data age without changing the saved-copy live region', () => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(NOW)
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    setHub({ data: savedCopy(cachedAt), loadSource: 'cache', cachedAt, lastUpdated: cachedAt,
      dataAsOf: NOW - 20 * MIN, hubReadPending: true })
    const { container } = render(page())
    const notice = container.querySelector<HTMLElement>('.figma-hub-fallback-banner--info')!
    expect(notice.getAttribute('role')).toBe('status')
    const originalNotice = notice.textContent
    expect(screen.getByTestId('hub-data-age').textContent).toBe('Data from about 20m ago')
    act(() => vi.advanceTimersByTime(MIN))
    expect(notice.textContent).toBe(originalNotice)
    expect(screen.getByTestId('hub-data-age').textContent).toBe('Data from about 21m ago')
    hidden.mockRestore()
  })
})
