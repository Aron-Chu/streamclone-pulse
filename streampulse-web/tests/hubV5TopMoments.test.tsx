import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeApiError } from '../src/lib/apiClient'
import type { MomentsFeedCategoryFacet, MomentsFeedItem, MomentsFeedSnapshot, MomentsWindowQuery } from '../src/lib/momentsFeed'
import { normalizePublicHub, type HubLiveChannel, type HubLivePulseMoment, type PublicHub } from '../src/lib/publicHub'
import type { HubChannelScreenerV1 } from '../src/lib/channelScreenerContract'

const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/moments_feed_v1.json'), 'utf8')) as { generatedAt: number; items: MomentsFeedItem[] }
const NOW = fixture.generatedAt
const MIN = 60_000
// The hub answer of 2026-10-30 07:19Z, trimmed: its rows are aldo_geo, e11ysa, findjeremiah and supertf.
const capture = normalizePublicHub(JSON.parse(readFileSync(resolve(__dirname, 'fixtures/hub_live_pulse_20261030.json'), 'utf8')))

const feed = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../src/lib/momentsFeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/momentsFeed')>()),
  loadMomentsWindow: feed.load,
}))

import { formatLiftRatio, formatLiftWords } from '@streampulse/pulse-core'
import { HubV5PickingUp, UP_DOWN, UP_FIRST, upOld } from '../src/ui/components/hub/v5/HubV5PickingUp'
import { feedClockFloor } from '../src/ui/components/hub/v5/hubV5FeedModel'
import { HubV5TopList, TOP_DAY_KEY, TOP_LIST_ROWS, useTopToday } from '../src/ui/components/hub/v5/HubV5TopMoments'
import { hubTopRows, topFeedRows } from '../src/ui/components/hub/v5/hubV5TopModel'

/** The backend as the list reads it: the window, the verdict and the game filter the moments, the total and the games facet. */
function answer(items: MomentsFeedItem[], q: MomentsWindowQuery): MomentsFeedSnapshot {
  const day = items.filter((i) => i.minuteStart >= q.from && (!q.verdict || i.verdict === q.verdict))
  const mine = day.filter((i) => !q.category || i.category?.id === q.category)
  const games = new Map<string, MomentsFeedCategoryFacet>()
  for (const i of day) if (i.category) {
    const g = games.get(i.category.id) ?? { ...i.category, moments: 0, liveChannels: 0 }
    g.moments++
    games.set(i.category.id, g)
  }
  return {
    items: [...mine].sort((a, b) => b.score - a.score).slice(0, q.limit), generatedAt: NOW, stale: false, total: mine.length,
    verdicts: { ok: mine.length, warn: 0, bad: 0 },
    categories: [...games.values()].sort((a, b) => b.moments - a.moments), nextCursor: null,
  }
}
let items = fixture.items
const reads = () => feed.load.mock.calls.map((c) => c[0] as MomentsWindowQuery)
const rail = () => document.getElementById('latest')!
/** Top moments today, the still list under the chart (H1, 11-19). */
const tops = () => document.getElementById('top-moments')!
const topList = () => tops().querySelector<HTMLElement>('.hv5-tm-list')!
const topRows = () => [...tops().querySelectorAll<HTMLElement>('.hv5-tm-list > .hv5-tm-it')]
/** The ids Top moments today shows (useTopToday's shown list), as the probe writes them. */
const ids = (): string[] => JSON.parse(screen.getByTestId('ids').textContent!) ?? []
const source = () => screen.getByTestId('source').textContent
const upRows = () => [...rail().querySelectorAll<HTMLElement>('.hv5-fd-list > li')]

/** A mouse moving onto or off the list, as React reads it (jsdom has no PointerEvent). */
function mouse(target: Element, type: 'pointerover' | 'pointerout') {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } })
  fireEvent(target, event)
}

interface PageProps { attempt: number; hub?: PublicHub | null; nowMs?: number; reading?: boolean; busiest?: HubLivePulseMoment[]; list?: boolean }
function Page({ attempt, hub = null, nowMs = NOW, reading = true, busiest, list = true }: PageProps) {
  const top = useTopToday({ hub, savedAt: null, reading, attempt, nowMs, busiest })
  return (
    <>
      <output data-testid="ids">{JSON.stringify(top.shown?.rows.map((r) => r.id) ?? null)}</output>
      <output data-testid="source">{top.shown?.source ?? ''}</output>
      {list ? <HubV5TopList top={top} nowMs={nowMs} /> : null}
      <HubV5PickingUp top={top} nowMs={nowMs} />
    </>
  )
}
/** The location state a link sent, as the probe writes it. */
function Where() {
  const location = useLocation()
  return <output data-testid="where">{JSON.stringify(location.state ?? null)}</output>
}
const view = (p: PageProps) => <MemoryRouter><div className="hub-v5"><Page {...p} /></div><Where /></MemoryRouter>

/** Keyboard focus or not: the element reports :focus-visible as asked (as hubV5ImageUrls.test.tsx does), whatever jsdom makes of it. */
function focusVisible(on = true) {
  const matches = Element.prototype.matches
  return vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
    return selector === ':focus-visible' ? on : matches.call(this, selector)
  })
}

beforeEach(() => {
  vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '1')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  items = fixture.items
  feed.load.mockReset().mockImplementation((q: MomentsWindowQuery) => Promise.resolve(answer(items, q)))
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('Top moments today from the Moments list (the still list, H1)', () => {
  it('shows the day’s top 20 that hold up, with the game chips, All moments and the first 5 as links to their moments', async () => {
    render(view({ attempt: 1 }))
    await waitFor(() => expect(ids().length).toBeGreaterThan(0))
    expect(screen.getByRole('heading', { name: 'Top moments today' }).closest('#top-moments')).toBeTruthy()
    expect(reads()).toEqual([{ from: Math.floor((NOW - 24 * 3600_000) / 600_000) * 600_000, sort: 'top', verdict: 'ok', limit: 50, category: null }])
    const snap = answer(items, reads()[0]!)
    const rows = topFeedRows(snap)
    expect(ids()).toEqual(rows.map((r) => r.id))
    expect(ids().length).toBeLessThanOrEqual(20)
    expect(within(tops()).getByRole('link', { name: 'All moments →' }).getAttribute('href')).toBe('/analytics/moments')
    const chips = within(within(tops()).getByRole('group', { name: 'Show one game' })).getAllByRole('button').slice(1)
    // The accessible name, from the hidden text: the visible parts are aria-hidden (WCAG 2.5.3).
    expect(snap.categories!.map((g) => within(tops()).getByRole('button', { name: `${g.name}, ${g.moments} ${g.moments === 1 ? 'moment' : 'moments'} that hold up today` }))).toEqual(chips)
    // the list's (i): ended streams drop out of the list too, until B1
    fireEvent.click(screen.getByRole('button', { name: 'About Top moments today' }))
    const tip = document.querySelector('[data-hub-toggletip-pop]')!.textContent!
    expect(tip).toContain('from the Moments page’s own list')
    expect(tip).toContain('Streams that have ended drop out.')
    fireEvent.click(screen.getByRole('button', { name: 'About Top moments today' }))
    // five rows, each a link that opens its moment (no carousel to scroll down to)
    expect(topRows()).toHaveLength(TOP_LIST_ROWS)
    const first = within(topRows()[0]!).getByRole('link', { name: /^1\. .+ Opens the moment\.$/ })
    expect(first.getAttribute('href')).toBe(rows[0]!.href)
    expect(within(tops()).queryAllByRole('button', { name: /^\d\. / })).toHaveLength(0)
    // Picking up has none of the day's rows
    expect(rail().querySelector('.hv5-tm-it')).toBeNull()
  })

  it('keeps what a read brings waiting while keyboard focus is in the list, so a row never moves under Enter', async () => {
    const { rerender } = render(view({ attempt: 1 }))
    await waitFor(() => expect(topRows()).toHaveLength(TOP_LIST_ROWS))
    const before = ids()
    const link = topRows()[1]!.querySelector('a')!
    const keyboard = focusVisible()
    act(() => link.focus())
    const top = fixture.items.find((i) => i.id === before[0])!
    const fresh = { ...top, id: `${top.id}-new`, login: 'newcomer', streamId: 'new-stream', minuteStart: NOW - MIN, score: top.score + 1 }
    items = [...fixture.items, fresh]
    rerender(view({ attempt: 2 }))
    await waitFor(() => expect(feed.load).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(ids()).toEqual(before)
    // focus moving between rows keeps it held; leaving the list lets it in
    act(() => topRows()[2]!.querySelector('a')!.focus())
    expect(ids()).toEqual(before)
    act(() => (document.activeElement as HTMLElement).blur())
    await waitFor(() => expect(ids()[0]).toBe(fresh.id))
    keyboard.mockRestore()
  })

  it('holds nothing for a tap’s or a click’s focus, which is not :focus-visible', async () => {
    const { rerender } = render(view({ attempt: 1 }))
    await waitFor(() => expect(topRows()).toHaveLength(TOP_LIST_ROWS))
    const before = ids()
    const tap = focusVisible(false)
    act(() => topRows()[1]!.querySelector('a')!.focus())
    const top = fixture.items.find((i) => i.id === before[0])!
    const fresh = { ...top, id: `${top.id}-new`, login: 'newcomer', streamId: 'new-stream', minuteStart: NOW - MIN, score: top.score + 1 }
    items = [...fixture.items, fresh]
    rerender(view({ attempt: 2 }))
    await waitFor(() => expect(ids()[0]).toBe(fresh.id))
    tap.mockRestore()
  })

  it('lets a waiting read in when the list leaves the page', async () => {
    const { rerender } = render(view({ attempt: 1 }))
    await waitFor(() => expect(ids().length).toBeGreaterThan(0))
    const before = ids()
    mouse(topList(), 'pointerover')
    const top = fixture.items.find((i) => i.id === before[0])!
    const fresh = { ...top, id: `${top.id}-new`, login: 'newcomer', streamId: 'new-stream', minuteStart: NOW - MIN, score: top.score + 1 }
    items = [...fixture.items, fresh]
    rerender(view({ attempt: 2 }))
    await waitFor(() => expect(feed.load).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(ids()).toEqual(before)
    // gone with the mouse still over it: no pointerout comes, the unmount lets the read in
    rerender(view({ attempt: 2, list: false }))
    await waitFor(() => expect(ids()[0]).toBe(fresh.id))
  })

  it('tells the moment it opens that it came from the hub', async () => {
    render(view({ attempt: 1 }))
    await waitFor(() => expect(topRows()).toHaveLength(TOP_LIST_ROWS))
    expect(screen.getByTestId('where').textContent).toBe('null')
    fireEvent.click(within(topRows()[0]!).getByRole('link'))
    expect(JSON.parse(screen.getByTestId('where').textContent!)).toEqual({ from: 'hub' })
  })

  it('reads a picked game once and links to its moments', async () => {
    render(view({ attempt: 1 }))
    await waitFor(() => expect(ids().length).toBeGreaterThan(0))
    const ow = fixture.items.find((i) => i.category?.name === 'Overwatch')!.category!.id
    fireEvent.click(await screen.findByRole('button', { name: /^Overwatch, / }))
    await waitFor(() => expect(reads().at(-1)).toMatchObject({ category: ow, verdict: 'ok', sort: 'top' }))
    expect(reads()).toHaveLength(2)
    await waitFor(() => expect(within(tops()).getByRole('link', { name: /^All Overwatch moments →$/ }).getAttribute('href')).toBe('/analytics/moments?category=Overwatch'))
    expect(ids()).toEqual(topFeedRows(answer(items, reads().at(-1)!)).map((r) => r.id))
  })

  it('keeps what a read brings waiting while the mouse is over the list, and lets it in when it leaves', async () => {
    const { rerender } = render(view({ attempt: 1 }))
    await waitFor(() => expect(ids().length).toBeGreaterThan(0))
    const before = ids()
    mouse(topList(), 'pointerover')
    const top = fixture.items.find((i) => i.id === before[0])!
    const fresh = { ...top, id: `${top.id}-new`, login: 'newcomer', streamId: 'new-stream', minuteStart: NOW - MIN, score: top.score + 1 }
    items = [...fixture.items, fresh]
    rerender(view({ attempt: 2 }))
    await waitFor(() => expect(feed.load).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(ids()).toEqual(before)
    mouse(topList(), 'pointerout')
    await waitFor(() => expect(ids()[0]).toBe(fresh.id))
  })
})

describe('Picking up now, the rail (M1 + P1)', () => {
  const at = Date.parse(capture.generatedAt)
  const hot = (login: string, x: number, now: number, usual: number) => ({
    login, displayName: login.toUpperCase(), category: 'Overwatch 2', streamId: `s-${login}`, coverageState: 'synced',
    screenerV1: screener({ multiplier: x, currentPerMin: now, baselinePerMin: usual, absoluteDeltaPerMin: now - usual }),
  }) as unknown as HubLiveChannel
  const hubWith = (channels: HubLiveChannel[]) => ({ ...capture, liveChannels: channels })
  const wide = (on: boolean) => vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: on && query.includes('1536px'), media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList)

  it('lists only what is heating up now, strongest × first, with how many more a minute beside it', () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
    render(view({ attempt: 1, hub: hubWith([hot('alpha', 2, 120, 60), hot('bravo', 3, 45, 15), hot('charlie', 1.6, 240, 150)]), nowMs: at }))
    expect(within(rail()).getByRole('heading', { name: 'Picking up now' })).toBeTruthy()
    const links = upRows().map((li) => li.querySelector('a')!)
    // The accessible name, from the hidden text: the visible parts are aria-hidden (WCAG 2.5.3).
    expect([
      'BRAVO, 3.0 times more chat, 30 more messages a minute, Overwatch 2. Opens the stream page.',
      'ALPHA, 2.0 times more chat, 60 more messages a minute, Overwatch 2. Opens the stream page.',
      'CHARLIE, 1.6 times more chat, 90 more messages a minute, Overwatch 2. Opens the stream page.',
    ].map((name) => within(rail()).getByRole('link', { name }))).toEqual(links)
    expect(links[0]!.querySelector('.hv5-up-add')!.textContent).toBe('+30/min')
    // the count shows as a number and reads as '3 channels' (a span's aria-label is not read, HUB-LIVE-9)
    expect(rail().querySelector('.hv5-up-n > [aria-hidden]')!.textContent).toBe('3')
    expect(rail().querySelector('.hv5-up-n .hv5-vh')!.textContent).toBe('3 channels')
    // no day's moments in the rail
    expect(within(rail()).queryByText('Top moments today')).toBeNull()
  })

  it('writes each row’s strength in pulse-core’s words, the figure still bold (Z06)', () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
    render(view({ attempt: 1, hub: hubWith([hot('alpha', 2, 120, 60), hot('bravo', 3, 45, 15), hot('charlie', 1.6, 240, 150)]), nowMs: at }))
    const strength = upRows().map((li) => li.querySelector('.hv5-f2-x')!)
    expect(strength.map((el) => el.textContent)).toEqual([3, 2, 1.6].map((x) => formatLiftWords(x, 'chat')))
    expect(strength.map((el) => el.querySelector('b')!.textContent)).toEqual([3, 2, 1.6].map((x) => `${formatLiftRatio(x)}×`))
  })

  it('shows every row in the right column from 1536 px (L1, 11-16); narrower, the first 6 and Show all in place (B1, 11-11)', () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
    const many = hubWith(Array.from({ length: 8 }, (_, i) => hot(`c${i}`, 2 + i / 10, 120, 60)))
    const mq = wide(true)
    const { unmount } = render(view({ attempt: 1, hub: many, nowMs: at }))
    expect(upRows()).toHaveLength(8)
    expect(within(rail()).queryByRole('button', { name: /^Show / })).toBeNull()
    unmount()
    mq.mockRestore()
    const narrow = wide(false)
    try {
      render(view({ attempt: 1, hub: many, nowMs: at }))
      expect(upRows()).toHaveLength(UP_FIRST)
      const all = within(rail()).getByRole('button', { name: 'Show all 8' })
      expect(all.getAttribute('aria-expanded')).toBe('false')
      fireEvent.click(all)
      expect(upRows()).toHaveLength(8)
      fireEvent.click(within(rail()).getByRole('button', { name: 'Show fewer' }))
      expect(upRows()).toHaveLength(UP_FIRST)
    } finally {
      narrow.mockRestore()
    }
  })

  it('says when nothing is picking up, and waits for the hub’s first answer', () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
    const { rerender } = render(view({ attempt: 0 }))
    expect(within(rail()).getByRole('status').textContent).toBe('Loading channels picking up')
    rerender(view({ attempt: 1, hub: hubWith([]), nowMs: at }))
    expect(rail().querySelector('.hv5-tm-q')!.textContent).toBe('Nothing is picking up right now.')
  })

  it('says it can’t tell when the chat counts didn’t load, keeping the last list greyed for up to 3 minutes', () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
    // every screener came back unavailable (the 10-30 outage answer)
    const outage = normalizePublicHub(JSON.parse(readFileSync(resolve(__dirname, 'fixtures/hub_screener_down_20261030.json'), 'utf8'))).liveChannels
    const good = hubWith([hot('alpha', 2, 120, 60), hot('bravo', 3, 45, 15)])
    const down = (ms: number) => ({ ...capture, generatedAt: new Date(ms).toISOString(), liveChannels: outage })
    const { rerender } = render(view({ attempt: 1, hub: good, nowMs: at }))
    expect(upRows()).toHaveLength(2)
    rerender(view({ attempt: 2, hub: down(at + 60_000), nowMs: at + 60_000 }))
    expect(rail().querySelector('[data-up-down]')!.textContent).toBe(UP_DOWN)
    expect(within(rail()).queryByText('Nothing is picking up right now.')).toBeNull()
    expect(rail().querySelector('.hv5-fd-list')!.classList.contains('hv5-up-old')).toBe(true)
    expect(upRows()).toHaveLength(2)
    expect(rail().classList.contains('hv5-f2-stale')).toBe(true)
    expect(rail().querySelector('.hv5-up-n')).toBeNull()
    // past 3 minutes the old list goes; the line stays
    rerender(view({ attempt: 3, hub: down(at + 4 * MIN), nowMs: at + 4 * MIN }))
    expect(rail().querySelector('[data-up-down]')!.textContent).toBe(UP_DOWN)
    expect(upRows()).toHaveLength(0)
    expect(within(rail()).queryByRole('status')).toBeNull()
    // counts back: the fresh list, not greyed
    rerender(view({ attempt: 4, hub: { ...good, generatedAt: new Date(at + 5 * MIN).toISOString() }, nowMs: at + 5 * MIN }))
    expect(rail().querySelector('[data-up-down]')).toBeNull()
    expect(upRows()).toHaveLength(2)
    expect(rail().querySelector('.hv5-up-old')).toBeNull()
  })

  it('says it can’t tell on a first answer that is already down, never "loading" forever', () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
    const outage = normalizePublicHub(JSON.parse(readFileSync(resolve(__dirname, 'fixtures/hub_screener_down_20261030.json'), 'utf8')))
    render(view({ attempt: 1, hub: outage, nowMs: Date.parse(outage.generatedAt) }))
    expect(rail().querySelector('[data-up-down]')!.textContent).toBe(UP_DOWN)
    expect(within(rail()).queryByText('Loading channels picking up')).toBeNull()
  })

  it('fades the list’s bottom only while more of it is below (the sticky column from 1536 px, L1 11-16)', () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
    let scrolled = 0
    const own = (el: Element, n: number) => (el.classList.contains('hv5-tm-body') ? n : 0)
    const sh = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) { return own(this, 900) })
    const ch = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) { return own(this, 600) })
    const st = vi.spyOn(Element.prototype, 'scrollTop', 'get').mockImplementation(() => scrolled)
    // measured only in the column (S1, 11-19), by a ResizeObserver, which reports once as it starts observing
    const mq = wide(true)
    vi.stubGlobal('ResizeObserver', class { constructor(private readonly cb: () => void) {} observe() { this.cb() } unobserve() {} disconnect() {} })
    try {
      render(view({ attempt: 1, hub: hubWith([hot('alpha', 2, 120, 60)]), nowMs: at }))
      const body = rail().querySelector<HTMLElement>('.hv5-tm-body')!
      expect(body.hasAttribute('data-more')).toBe(true)
      scrolled = 300
      fireEvent.scroll(body)
      expect(body.hasAttribute('data-more')).toBe(false)
      scrolled = 120
      fireEvent.scroll(body)
      expect(body.hasAttribute('data-more')).toBe(true)
    } finally {
      sh.mockRestore()
      ch.mockRestore()
      st.mockRestore()
      mq.mockRestore()
      vi.unstubAllGlobals()
    }
    // the CSS masks only a body with more below, and only in the column from 1536 px, so the last line never sits in the fade
    const css = readFileSync(resolve(__dirname, '../src/ui/components/hub/v5/hub-v5.css'), 'utf8')
    const column = css.slice(css.indexOf('@media (min-width: 1536px) {'))
    expect(column.match(/\.hv5-up \.hv5-tm-body \{([^}]*)\}/)![1]).not.toContain('mask-image')
    expect(column).toMatch(/\.hv5-up \.hv5-tm-body\[data-more\] \{ mask-image: linear-gradient\(180deg/)
    expect(css.slice(0, css.indexOf('@media (min-width: 1536px) {'))).not.toMatch(/\.hv5-tm-body\[data-more\]/)
  })
})

describe('Top moments today’s fallbacks', () => {
  const hubRows = hubTopRows(capture).map((r) => r.id)

  it('shows five grey rows while it waits, and never waits forever', async () => {
    let fail!: (error: unknown) => void
    feed.load.mockImplementation(() => new Promise((_, reject) => { fail = reject }))
    const { rerender } = render(view({ attempt: 0 }))
    expect(tops().hasAttribute('data-wait')).toBe(true)
    expect(tops().querySelectorAll('.hv5-tm-wait > li')).toHaveLength(TOP_LIST_ROWS)
    rerender(view({ attempt: 1 }))
    await waitFor(() => expect(feed.load).toHaveBeenCalledTimes(1))
    // no first answer (the read's 8 seconds ran out): the hub's rows
    rerender(view({ attempt: 1, hub: capture }))
    await act(async () => fail(normalizeApiError(0, {})))
    await waitFor(() => expect(ids()).toEqual(hubRows))
    expect(tops().hasAttribute('data-wait')).toBe(false)
    expect(topRows()).toHaveLength(TOP_LIST_ROWS)
  })

  it('describes the hub’s list of 5 in its (i): its 10 highest-scoring, one row per moment, a busiest minute under 5', async () => {
    feed.load.mockImplementation(() => Promise.reject(normalizeApiError(404, {})))
    render(view({ attempt: 1, hub: capture }))
    await waitFor(() => expect(ids()).toEqual(hubRows))
    fireEvent.click(screen.getByRole('button', { name: 'About Top moments today' }))
    const tip = document.querySelector('[data-hub-toggletip-pop]')!.textContent!
    expect(tip).toContain('the hub sends its 10 highest-scoring, from the 12 chattiest live channels.')
    expect(tip).toContain('strongest × first, one row per moment.')
    expect(tip).toContain(`Under ${TOP_LIST_ROWS}, a “Busiest minute” row fills in for other channels`)
    expect(tip).not.toMatch(/card|carousel|latest 10/)
  })

  it('stays on the hub’s rows for the visit after a 404, with no chips', async () => {
    feed.load.mockImplementation(() => Promise.reject(normalizeApiError(404, {})))
    const { rerender } = render(view({ attempt: 1, hub: capture }))
    await waitFor(() => expect(ids()).toEqual(hubRows))
    expect(source()).toBe('hub')
    expect(screen.queryByRole('group', { name: 'Show one game' })).toBeNull()
    expect(within(tops()).getByRole('link', { name: 'All moments →' })).toBeTruthy()
    rerender(view({ attempt: 2, hub: capture }))
    rerender(view({ attempt: 3, hub: capture }))
    await act(async () => {})
    expect(feed.load).toHaveBeenCalledTimes(1)
  })

  it('shows the hub’s rows when the first read fails, and the list once a later read answers', async () => {
    feed.load.mockImplementationOnce(() => Promise.reject(normalizeApiError(503, {})))
    const { rerender } = render(view({ attempt: 1, hub: capture }))
    await waitFor(() => expect(ids()).toEqual(hubRows))
    // the hub's next read reads the list again; the hub's rows stay up while it runs
    rerender(view({ attempt: 2, hub: capture }))
    expect(ids()).toEqual(hubRows)
    await waitFor(() => expect(ids()).toEqual(topFeedRows(answer(items, reads()[1]!)).map((r) => r.id)))
    expect(feed.load).toHaveBeenCalledTimes(2)
  })

  it('keeps the last list greyed for 15 minutes after a later read fails, then the hub’s rows, then the list again', async () => {
    const { rerender } = render(view({ attempt: 1, hub: capture }))
    await waitFor(() => expect(ids().length).toBeGreaterThan(0))
    const before = ids()
    feed.load.mockImplementation(() => Promise.reject(normalizeApiError(503, {})))
    rerender(view({ attempt: 2, hub: capture }))
    await waitFor(() => expect(source()).toBe('feed-old'))
    expect(ids()).toEqual(before)
    expect(topRows()[0]!.classList.contains('hv5-tm-old')).toBe(true)
    expect(tops().className).toContain('hv5-f2-stale')
    rerender(view({ attempt: 2, hub: capture, nowMs: NOW + 15 * MIN }))
    expect(ids()).toEqual(before)
    rerender(view({ attempt: 2, hub: capture, nowMs: NOW + 15 * MIN + 1 }))
    expect(ids()).toEqual(hubRows)
    feed.load.mockImplementation((q: MomentsWindowQuery) => Promise.resolve(answer(items, q)))
    rerender(view({ attempt: 3, hub: capture, nowMs: NOW + 16 * MIN }))
    await waitFor(() => expect(ids()).toEqual(before))
    expect(source()).toBe('feed')
  })

  it('lets a change of source in at once while the mouse is over the list', async () => {
    const { rerender } = render(view({ attempt: 1, hub: capture }))
    await waitFor(() => expect(ids().length).toBeGreaterThan(0))
    mouse(topList(), 'pointerover')
    feed.load.mockImplementation(() => Promise.reject(normalizeApiError(503, {})))
    rerender(view({ attempt: 2, hub: capture }))
    await act(async () => {})
    // the kept list runs out: the hub's rows, whose ids are not the list's, so nothing waits
    rerender(view({ attempt: 2, hub: capture, nowMs: NOW + 15 * MIN + 1 }))
    expect(ids()).toEqual(hubRows)
  })

  it('keeps the chips and All when a picked game’s first read fails, with the hub’s rows from that game only', async () => {
    render(view({ attempt: 1, hub: capture }))
    await waitFor(() => expect(ids().length).toBeGreaterThan(0))
    const all = ids()
    feed.load.mockImplementation((q: MomentsWindowQuery) => (q.category ? Promise.reject(normalizeApiError(503, {})) : Promise.resolve(answer(items, q))))
    fireEvent.click(await screen.findByRole('button', { name: /^IRL, / }))
    const irl = hubTopRows(capture).filter((r) => r.game === 'IRL').map((r) => r.id)
    expect(irl.length).toBeGreaterThan(0)
    expect(irl.length).toBeLessThan(hubRows.length)
    await waitFor(() => expect(ids()).toEqual(irl))
    const chips = screen.getByRole('group', { name: 'Show one game' })
    expect(within(chips).getByRole('button', { name: /^IRL, / }).getAttribute('aria-pressed')).toBe('true')
    // a game the hub has no rows for: none, and the hub's line says so
    fireEvent.click(within(chips).getByRole('button', { name: /^Overwatch, / }))
    await waitFor(() => expect(ids()).toHaveLength(0))
    expect(tops().querySelector('.hv5-fd-quiet')!.textContent).toBe('No standout moments on streams live now yet.')
    fireEvent.click(within(chips).getByRole('button', { name: 'All' }))
    await waitFor(() => expect(ids()).toEqual(all))
  })

  it('goes back to All’s last list, greyed, when All’s read fails after a pick', async () => {
    const { rerender } = render(view({ attempt: 1, hub: capture }))
    await waitFor(() => expect(ids().length).toBeGreaterThan(0))
    const all = ids()
    fireEvent.click(await screen.findByRole('button', { name: /^Overwatch, / }))
    await waitFor(() => expect(reads()).toHaveLength(2))
    await waitFor(() => expect(ids()).not.toEqual(all))
    feed.load.mockImplementation(() => Promise.reject(normalizeApiError(503, {})))
    rerender(view({ attempt: 2, hub: capture }))
    await waitFor(() => expect(source()).toBe('feed-old'))
    fireEvent.click(within(screen.getByRole('group', { name: 'Show one game' })).getByRole('button', { name: 'All' }))
    await waitFor(() => expect(ids()).toEqual(all))
    expect(source()).toBe('feed-old')
    expect(screen.getByRole('group', { name: 'Show one game' })).toBeTruthy()
  })

  it('says unavailable with no Try again of its own when there is nothing at all (the page banner has the one, Q5b)', async () => {
    feed.load.mockImplementation(() => Promise.reject(normalizeApiError(404, {})))
    const { rerender } = render(view({ attempt: 1, reading: false }))
    await waitFor(() => expect(within(tops()).getByText('Unavailable right now.')).toBeTruthy())
    expect(rail().querySelector('.hv5-tm-q')!.textContent).toBe('Unavailable right now.')
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    // a read runs again: grey rows
    rerender(view({ attempt: 1, reading: true }))
    expect(tops().hasAttribute('data-wait')).toBe(true)
  })

  it('says none yet when the hub has no standout moments, and keeps the link', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
    render(view({ attempt: 1, hub: { ...capture, livePulseMoments: [] } }))
    expect(tops().querySelector('.hv5-fd-quiet')!.textContent).toBe('No standout moments on streams live now yet.')
    expect(within(tops()).getByRole('link', { name: 'All moments →' })).toBeTruthy()
    expect(feed.load).not.toHaveBeenCalled()
  })

  describe('the busiest-minute fill (board 2A, 11-02)', () => {
    const at = Date.parse(capture.generatedAt)
    const busy = (login: string, chatPerMin: number, ago = 3 * 60): HubLivePulseMoment => ({
      login, displayName: login, streamId: `h-${login}`, offsetSeconds: 900, at: at - ago * MIN, score: 100, label: 'Corpus peak', chatPerMin,
      topEmotes: [{ name: 'KEKW', provider: '7tv', count: 30, sharePct: 0 }],
    }) as HubLivePulseMoment
    const fill = [busy('kaicenat', 1204), busy('caseoh_', 412), busy('jynxzi', 388), busy('lacy', 300), busy('supertf', 9000), busy('aldo_geo', 5000)]

    it('fills the hub’s rows to 10 with other channels’ busiest minutes, after them, labelled, and keeps none of them', () => {
      vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
      window.localStorage.removeItem(TOP_DAY_KEY)
      render(view({ attempt: 1, hub: capture, nowMs: at, busiest: fill }))
      // the hub's 7 rows, then 3 of the 4 channels it does not show, the most chat first
      expect(ids()).toEqual([...hubRows, ...['kaicenat', 'caseoh_', 'jynxzi'].map((l) => `busiest|${l}|h-${l}|${at - 180 * MIN}|900`)])
      // the list shows the first 5, the hub's own; the rest are on the Moments page
      expect(topRows()).toHaveLength(TOP_LIST_ROWS)
      expect(topRows().some((r) => r.textContent!.includes('Busiest minute'))).toBe(false)
      const kept = JSON.parse(window.localStorage.getItem(TOP_DAY_KEY)!) as { id: string }[]
      expect(kept.map((r) => r.id)).toEqual(hubRows)
    })

    it('shows busiest minutes when the hub has no standout moments, in place of "none yet"', () => {
      vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
      window.localStorage.removeItem(TOP_DAY_KEY)
      render(view({ attempt: 1, hub: { ...capture, livePulseMoments: [] }, nowMs: at, busiest: fill.slice(0, 2) }))
      expect(tops().querySelector('.hv5-fd-quiet')).toBeNull()
      expect(topRows().map((r) => r.textContent)).toEqual([expect.stringContaining('Busiest minute · 1,204 chat/min'), expect.stringContaining('Busiest minute · 412 chat/min')])
    })
  })
})

function screener(over: Record<string, number> = {}): HubChannelScreenerV1 {
  const at = Date.parse(capture.generatedAt)
  return {
    version: 1, measuredAt: at, baselineKind: 'current_stream_measured_average', state: 'ready',
    currentWindow: { start: at - 5 * MIN, end: at, expectedMinutes: 5, measuredMinutes: 5, coveragePct: 100 },
    baselineWindow: null, baselineMeasuredMinutes: 40, evidence: null, emotes: null,
    chat: {
      state: 'ready', currentPerMin: 120, baselinePerMin: 60, absoluteDeltaPerMin: 60, changePct: 100, multiplier: 2,
      currentMeasuredMinutes: 5, currentExpectedMinutes: 5, baselineMeasuredMinutes: 40, baselineExpectedMinutes: 40, baselineCoveragePct: 100,
      ...over,
    },
  } as unknown as HubChannelScreenerV1
}

describe('Picking up now on an old answer (H01, 11-13)', () => {
  it('says when it last knew, rather than listing channels from a stale read', () => {
    const asOf = NOW - 20 * MIN
    render(<MemoryRouter><HubV5PickingUp nowMs={NOW} top={{ shown: null, up: { up: [], upWindow: '' }, upAsOf: asOf, upSaved: false, art: new Map() }} /></MemoryRouter>)
    expect(rail().querySelector('[data-up-down]')!.textContent).toBe(upOld(feedClockFloor(asOf)))
    expect(upOld('12:40 AM')).toBe("Can't tell right now — last known at 12:40 AM.")
    expect(within(rail()).queryByText('Loading channels picking up')).toBeNull()
  })
  it('drops the old rows, the count and "Show all N" in place of the line (round 2)', () => {
    const asOf = NOW - 16 * MIN
    const up = Array.from({ length: 8 }, (_, i) => ({ login: `c${i}`, name: `C${i}`, cat: null, streamId: `s${i}`, avatar: null, x: 6, add: 300 }))
    render(<MemoryRouter><HubV5PickingUp nowMs={NOW} top={{ shown: null, up: { up, upWindow: '' }, upAsOf: asOf, upSaved: false, art: new Map() }} /></MemoryRouter>)
    expect(rail().querySelector('[data-up-down]')!.textContent).toBe(upOld(feedClockFloor(asOf)))
    expect(rail().querySelectorAll('li')).toHaveLength(0)
    expect(within(rail()).queryByRole('button', { name: /Show all/ })).toBeNull()
    expect(rail().querySelector('.hv5-up-n')).toBeNull()
  })
})

describe('Top today’s strength in pulse-core’s words (Z06)', () => {
  it('writes each row’s “6.2× more emotes” as formatLiftWords does, the figure still bold', async () => {
    render(view({ attempt: 1 }))
    await waitFor(() => expect(topRows()).toHaveLength(TOP_LIST_ROWS))
    const rows = topFeedRows(answer(items, reads()[0]!)).slice(0, TOP_LIST_ROWS)
    const strong = rows.flatMap((row, i) => (row.x != null ? [[row.x, row.kind, topRows()[i]!] as const] : []))
    expect(strong.length).toBeGreaterThan(0)
    for (const [x, kind, li] of strong) {
      const phrase = li.querySelector('.hv5-f2-x:not(.hv5-f2-plain)')!
      expect(phrase.textContent).toBe(formatLiftWords(x, kind))
      expect(phrase.querySelector('b')!.textContent).toBe(`${formatLiftRatio(x)}×`)
    }
  })
})
