/**
 * /analytics with no hub answer on screen (10-28): Top moments today and its
 * phone peek stay in every state (the Moments list is off here, so their rows
 * are the hub's). Totals only or nothing: grey rows while a hub read runs,
 * "Unavailable right now." once it gave up, with the banner's Try again (the
 * rail has none of its own, Q5b); the cards wait with it and keep
 * "Unavailable right now." through a later poll's read (U1, U2).
 * A saved copy waits with no rows, then says it has none as of when it was
 * saved (Q1b); Busiest now waits on it, Channels says when its count was live (S1,
 * U7); the note says its day (N1). The hub hook is mocked and fetch never
 * answers: no live API.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizePublicHub, type HubLiveChannel, type HubLivePulseMoment, type HubMoment, type PublicHub } from '../src/lib/publicHub'
import type { HubChannelScreenerV1 } from '../src/lib/channelScreenerContract'
import AnalyticsHubV5Page from '../src/routes/analytics/AnalyticsHubV5Page'
import { TOP_HUB_EMPTY, TOP_NONE, topSavedLine } from '../src/ui/components/hub/v5/HubV5TopMoments'
import { hubClock, hubSavedClock } from '../src/ui/components/hub/v5/hubV5Model'

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
    pollAttempt: 0,
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

const hubWith = (asOf: number, liveChannels: HubLiveChannel[] = [], moments: HubMoment[] = [], livePulseMoments: HubLivePulseMoment[] = []): PublicHub =>
  ({ ...normalizePublicHub(null), generatedAt: iso(asOf), poolSize: 500, liveChannels, moments, livePulseMoments }) as PublicHub

/** A hub answer with one row: ALPHA's chat at 3× its own average, an hour in. */
const answered = (asOf = NOW - 20_000) => hubWith(
  asOf,
  [channel('alpha', { startedAt: iso(asOf - 62 * MIN), viewers: 7000, screenerV1: screener(asOf) })],
  [{ kind: 'chat_spike', login: 'alpha', displayName: 'ALPHA', label: 'Chat spike', at: asOf - 2 * MIN } as HubMoment],
  [{
    login: 'alpha', displayName: 'ALPHA', streamId: 's-alpha', offsetSeconds: 3600, at: asOf - 2 * MIN, score: 80, label: 'Chat spike',
    chatPerMin: 300, emotesPerMin: 40, category: 'Just Chatting',
    comparison: { chat: { state: 'ready', currentPerMin: 300, baselinePerMin: 100, multiplier: 3, baselineMeasuredMinutes: 40 } },
  } as HubLivePulseMoment],
)
/** The stats-only fallback: a fresh time, totals, and no rows at all. */
const totalsOnly = () => hubWith(NOW - 20_000)
/** A saved copy with channels on it but no feed rows. */
const savedCopy = (at: number) => hubWith(at, [channel('bravo'), channel('charlie'), channel('delta')])

const page = () => <MemoryRouter><AnalyticsHubV5Page /></MemoryRouter>
const rail = () => within(document.getElementById('latest')!)
const railEl = () => document.getElementById('latest')!
const peekEl = () => document.querySelector<HTMLElement>('.hv5-f3-peek')!

/** Nothing to show yet: grey rows, grey dot, no time, no (i), never "none yet". */
function expectLoading() {
  // U6: the phone peek keeps its rows' height while it waits.
  expect(peekEl().hasAttribute('data-wait')).toBe(true)
  expect(railEl().querySelector('.hv5-tm-wait')!.getAttribute('aria-busy')).toBe('true')
  expect(rail().getByRole('status').textContent).toBe('Loading top moments')
  expect(railEl().querySelector('.hv5-tm-it')).toBeNull()
  for (const el of [railEl(), peekEl()]) {
    expect(el.className).toContain('hv5-f2-stale')
    expect(el.querySelector('.hv5-f2-fresh')!.textContent).toBe('')
    expect(within(el).queryByText(TOP_NONE)).toBeNull()
    expect(within(el).queryByText(/^No standout moments/)).toBeNull()
  }
  expect(rail().queryByRole('button', { name: 'About Top moments today' })).toBeNull()
}

const bannerTryAgain = () => within(document.querySelector<HTMLElement>('.hx-health-banner')!).getByRole('button', { name: 'Try again' }) as HTMLButtonElement

/** The hub read gave up with nothing to show: "Unavailable right now.", and the banner's Try again reads the hub again (Q5b: one button). */
function expectUnavailable() {
  expect(peekEl().hasAttribute('data-wait')).toBe(false)
  expect(within(peekEl()).getByText(TOP_NONE)).toBeTruthy()
  expect(railEl().querySelector('.hv5-tm-q')!.textContent).toBe(TOP_NONE)
  expect(rail().queryByRole('button', { name: 'Try again' })).toBeNull()
  expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1)
  expect(bannerTryAgain()).toBeTruthy()
  expect(rail().queryByRole('status')).toBeNull()
  for (const el of [railEl(), peekEl()]) {
    expect(el.className).toContain('hv5-f2-stale')
    expect(el.querySelector('.hv5-f2-fresh')!.textContent).toBe('')
  }
  expect(rail().queryByRole('button', { name: 'About Top moments today' })).toBeNull()
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
  expect(peekEl().querySelector('h2')!.textContent).toBe('Top today')
  expect(rail().getByRole('button', { name: /^1\. ALPHA, chat 3\.0 times usual, Just Chatting, 2 min ago at / })).toBeTruthy()
  expect(within(peekEl()).getByRole('button', { name: /^1\. ALPHA, .+ Open it in Top moments below\.$/ })).toBeTruthy()
  expect(railEl().className).not.toContain('hv5-f2-stale')
  expect(railEl().querySelector('.hv5-f2-fresh')!.textContent).toMatch(/^as of /)
  expect(rail().getByRole('button', { name: 'About Top moments today' })).toBeTruthy()
  expect(railEl().querySelector('.hv5-tm-q')!.textContent).toBe('That’s all on streams live now. Every moment today →')
  expect(rail().queryByRole('status')).toBeNull()
  expect(rail().queryByText(TOP_NONE)).toBeNull()
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

describe('Top moments today with totals only or nothing (10-28)', () => {
  it('says it is loading while the hub read runs, then shows the hub answer with no extra click', () => {
    setHub({ data: totalsOnly(), loadSource: 'stats-fallback', hubReadPending: true, hubReadRunning: true, hubReadLate: true })
    const { container, rerender } = render(page())
    expectLoading()
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
    expectUnavailable()
    expectCardsUnavailable(container)
    expect(banner()).toContain('Hub temporarily unavailable')
    expect(bannerTryAgain().disabled).toBe(false)

    // A poll's read: the feed and the cards wait on it; the banner keeps its text, Try again waits too.
    setHub({ data: totalsOnly(), loadSource: 'stats-fallback', refreshing: true, hubReadPending: true, hubReadRunning: true })
    rerender(page())
    expectLoading()
    expectCardsWaiting(container)
    expect(banner()).toContain('Hub temporarily unavailable')
    expect(bannerTryAgain().disabled).toBe(true)

    // Past its deadline it is called slow.
    setHub({ data: totalsOnly(), loadSource: 'stats-fallback', hubReadPending: true, hubReadRunning: true, hubReadLate: true })
    rerender(page())
    expect(banner()).toBe('Live data is slow — still loading…')

    // The read ended with no answer: back to unavailable.
    setHub({ data: totalsOnly(), loadSource: 'stats-fallback', hubReadPending: false })
    rerender(page())
    expectUnavailable()
    expectCardsUnavailable(container)

    setHub({ data: answered(), loadSource: 'full', hubReadPending: false })
    rerender(page())
    expectRows()
  })

  it('says unavailable with no Try again anywhere while the server asks to wait', () => {
    setHub({ data: totalsOnly(), loadSource: 'stats-fallback', hubReadPending: false, retryBlocked: true })
    render(page())
    expect(railEl().querySelector('.hv5-tm-q')!.textContent).toBe(TOP_NONE)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  // U2: a read under way that the hook does not yet count as pending never reads as given up.
  it('never says unavailable while a first read loads', () => {
    setHub({ loading: true, hubReadPending: false })
    const { container } = render(page())
    expectLoading()
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
    expectLoading()
    expectCardsWaiting(container)
  })

  it('waits on the first read and says unavailable when both reads failed', () => {
    setHub({ loading: true, hubReadPending: true })
    const { rerender } = render(page())
    expectLoading()

    setHub({ error: 'Hub unavailable', hubEndpointOk: false, hubReadPending: false })
    rerender(page())
    expectUnavailable()
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
    expectLoading()
  })

  it('says none yet for a hub answer with no standout moments, and keeps the link', () => {
    setHub({ data: hubWith(NOW - 20_000), loadSource: 'full' })
    render(page())
    expect(railEl().querySelector('.hv5-tm-q')!.textContent).toBe(`${TOP_HUB_EMPTY} Every moment today →`)
    expect(rail().getByRole('link', { name: 'Every moment today →' }).getAttribute('href')).toBe('/analytics/moments?view=top')
    expect(within(peekEl()).getByText(TOP_HUB_EMPTY)).toBeTruthy()
    expect(railEl().className).not.toContain('hv5-f2-stale')
    expect(rail().getByRole('button', { name: 'About Top moments today' })).toBeTruthy()
  })
})

describe('a saved copy on screen (S1, Q1, N1, 10-28)', () => {
  const cachedAt = new Date(2026, 9, 28, 10, 50).getTime()

  it('waits on the hub read: the rail and peek loading, Busiest now waiting, Channels timed', () => {
    setHub({ data: savedCopy(cachedAt), loadSource: 'cache', cachedAt, lastUpdated: cachedAt, hubReadPending: true })
    const { container } = render(page())
    expectLoading()
    const busiest = container.querySelector('#busiest')!
    expect(busiest.querySelector('.hv5-bzs-wait')).toBeTruthy()
    expect(busiest.querySelector('.hv5-bzc-it')).toBeNull()
    expect(container.querySelector('[data-hv5-channel-count]')!.textContent).toBe(`3 of 500 live at ${hubClock(cachedAt)}`)
    expect(screen.getByText(`Cached snapshot · Saved at ${hubClock(cachedAt)} · refreshing...`)).toBeTruthy()
    expect(peekEl().querySelector('h2')!.textContent).toBe('Top today')
  })

  it('says the saved copy has none as of its time once the read gave up (Q1b), and Busiest now says it is unavailable', () => {
    setHub({ data: savedCopy(cachedAt), loadSource: 'cache', cachedAt, lastUpdated: cachedAt, hubReadPending: false })
    const { container } = render(page())
    const none = topSavedLine(0, hubSavedClock(cachedAt, NOW))
    expect(none).toMatch(/^No standout moments as of 10:50\sAM\.$/)
    expect(railEl().querySelector('.hv5-tm-q')!.textContent).toBe(`${none} Every moment today →`)
    expect(within(peekEl()).getByText(none)).toBeTruthy()
    expect(within(railEl()).queryByText(TOP_HUB_EMPTY)).toBeNull()
    fireEvent.click(rail().getByRole('button', { name: 'About Top moments today' }))
    const tip = document.querySelector('[data-hub-toggletip-pop]')!.textContent!
    expect(tip).toMatch(/on streams that were live at 10:50\sAM: /)
    expect(tip).not.toContain('live now')
    // its rows stay as saved: the tip doesn't say ended streams drop out
    expect(tip).not.toContain('drop out')
    for (const el of [railEl(), peekEl()]) {
      // a saved copy is never live: grey dot, and the time it was saved
      expect(el.className).toContain('hv5-f2-stale')
      expect(el.querySelector('.hv5-f2-fresh')!.textContent).toBe(`Saved ${hubSavedClock(cachedAt, NOW)}`)
    }
    expect(within(container.querySelector<HTMLElement>('#busiest')!).getByText('Unavailable right now.')).toBeTruthy()
    expect(peekEl().hasAttribute('data-wait')).toBe(false)
    expect(screen.getByText(`Cached snapshot · Saved at ${hubClock(cachedAt)}`)).toBeTruthy()
  })

  it('shows a saved copy’s own rows while the read runs', () => {
    const at = NOW - 10 * MIN
    setHub({ data: answered(at), loadSource: 'cache', cachedAt: at, lastUpdated: at, hubReadPending: true })
    render(page())
    expect(rail().getByRole('button', { name: /^1\. ALPHA, / })).toBeTruthy()
    expect(railEl().querySelector('.hv5-f2-fresh')!.textContent).toBe(`Saved ${hubSavedClock(at, NOW)}`)
    expect(rail().queryByRole('status')).toBeNull()
    // Q1b: its last line says as of when it was saved, not "on streams live now"
    expect(railEl().querySelector('.hv5-tm-q')!.textContent).toBe(`${topSavedLine(1, hubSavedClock(at, NOW))} Every moment today →`)
    expect(railEl().querySelector('.hv5-tm-q')!.textContent).toMatch(/^That’s all as of \d{1,2}:\d\d\s[AP]M\. /)
    // the copy's streams may have ended since: an opened row never says live now
    fireEvent.click(rail().getByRole('button', { name: /^1\. ALPHA, / }))
    expect(railEl().querySelector('.hv5-tm-det')).toBeTruthy()
    expect(railEl().querySelector('.hv5-tm-lv')).toBeNull()
  })

  it('says the day on a copy saved before today', () => {
    const late = new Date(2026, 9, 27, 23, 30).getTime()
    setHub({ data: savedCopy(late), loadSource: 'cache', cachedAt: late, lastUpdated: late, hubReadPending: true })
    const { container } = render(page())
    expect(screen.getByText(`Cached snapshot · Saved yesterday, ${hubClock(late)} · refreshing...`)).toBeTruthy()
    expect(screen.getByText(/^Cached snapshot · Saved yesterday, 11:30\sPM · refreshing\.\.\.$/)).toBeTruthy()
    // U7: no "at" before a day.
    expect(container.querySelector('[data-hv5-channel-count]')!.textContent).toMatch(/^3 of 500 live yesterday, 11:30\sPM$/)
  })

  it('says the day in the rail’s last line and (i) on a copy saved before today (Q1b)', () => {
    const late = new Date(2026, 9, 27, 23, 30).getTime()
    setHub({ data: savedCopy(late), loadSource: 'cache', cachedAt: late, lastUpdated: late, hubReadPending: false })
    const { unmount } = render(page())
    expect(railEl().querySelector('.hv5-tm-q')!.textContent).toMatch(/^No standout moments as of yesterday, 11:30\sPM\. Every moment today →$/)
    expect(within(peekEl()).getByText(/^No standout moments as of yesterday, 11:30\sPM\.$/)).toBeTruthy()
    fireEvent.click(rail().getByRole('button', { name: 'About Top moments today' }))
    expect(document.querySelector('[data-hub-toggletip-pop]')!.textContent).toMatch(/ on streams that were live yesterday, 11:30\sPM: /)
    unmount()
    setHub({ data: answered(late), loadSource: 'cache', cachedAt: late, lastUpdated: late, hubReadPending: false })
    render(page())
    expect(rail().getByRole('button', { name: /^1\. ALPHA, / })).toBeTruthy()
    expect(railEl().querySelector('.hv5-tm-q')!.textContent).toMatch(/^That’s all as of yesterday, 11:30\sPM\. Every moment today →$/)
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
