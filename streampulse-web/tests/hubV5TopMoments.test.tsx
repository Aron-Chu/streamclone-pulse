import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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

const feed = vi.hoisted(() => ({ load: vi.fn(), vod: vi.fn() }))
vi.mock('../src/lib/momentsFeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/momentsFeed')>()),
  loadMomentsWindow: feed.load,
}))
vi.mock('../src/lib/momentsFeedVod', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/momentsFeedVod')>()),
  momentVods: { peek: () => undefined, read: feed.vod },
}))

import { HubV5BigMoments } from '../src/ui/components/hub/v5/HubV5BigMoments'
import { HubV5PickingUp, UP_DOWN, UP_FIRST } from '../src/ui/components/hub/v5/HubV5PickingUp'
import { HubV5TopPeek, TOP_DAY_KEY, useTopToday } from '../src/ui/components/hub/v5/HubV5TopMoments'
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
const big = () => document.getElementById('big-moments')
const stage = () => big()!.querySelector<HTMLElement>('.hv5-bm')!
const front = () => big()!.querySelector<HTMLElement>('.hv5-bm-card[data-pos="0"]')!
const peek = () => document.querySelector<HTMLElement>('.hv5-f3-peek')!
const peekRows = () => [...peek().querySelectorAll<HTMLElement>('.hv5-tm-list > .hv5-tm-it')]
/** The ids Top moments today shows (useTopToday's shown list), as the probe writes them. */
const ids = (): string[] => JSON.parse(screen.getByTestId('ids').textContent!) ?? []
const source = () => screen.getByTestId('source').textContent
const upRows = () => [...rail().querySelectorAll<HTMLElement>('.hv5-fd-list > li')]

/** A mouse moving onto or off the carousel, as React reads it (jsdom has no PointerEvent). */
function mouse(target: Element, type: 'pointerover' | 'pointerout') {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } })
  fireEvent(target, event)
}

interface PageProps { attempt: number; hub?: PublicHub | null; nowMs?: number; reading?: boolean; busiest?: HubLivePulseMoment[] }
function Page({ attempt, hub = null, nowMs = NOW, reading = true, busiest }: PageProps) {
  const top = useTopToday({ hub, savedAt: null, reading, attempt, nowMs, busiest })
  return (
    <>
      <output data-testid="ids">{JSON.stringify(top.shown?.rows.map((r) => r.id) ?? null)}</output>
      <output data-testid="source">{top.shown?.source ?? ''}</output>
      <HubV5TopPeek top={top} nowMs={nowMs} />
      <HubV5BigMoments top={top} nowMs={nowMs} />
      <HubV5PickingUp top={top} nowMs={nowMs} />
    </>
  )
}
const view = (p: PageProps) => <MemoryRouter><div className="hub-v5"><Page {...p} /></div></MemoryRouter>

beforeEach(() => {
  vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '1')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  items = fixture.items
  feed.load.mockReset().mockImplementation((q: MomentsWindowQuery) => Promise.resolve(answer(items, q)))
  feed.vod.mockReset().mockResolvedValue(null)
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('Top moments today from the Moments list (the carousel, M1)', () => {
  it('shows the day’s top 20 that hold up, with the game chips, All moments and rows 1–3 in the phone peek', async () => {
    render(view({ attempt: 1 }))
    await waitFor(() => expect(ids().length).toBeGreaterThan(0))
    expect(screen.getByRole('heading', { name: 'Top moments today' }).closest('#big-moments')).toBeTruthy()
    expect(reads()).toEqual([{ from: Math.floor((NOW - 24 * 3600_000) / 600_000) * 600_000, sort: 'top', verdict: 'ok', limit: 50, category: null }])
    const snap = answer(items, reads()[0]!)
    expect(ids()).toEqual(topFeedRows(snap).map((r) => r.id))
    expect(ids().length).toBeLessThanOrEqual(20)
    expect(within(big()!).getByRole('link', { name: 'All moments →' }).getAttribute('href')).toBe('/analytics/moments')
    const chips = within(within(big()!).getByRole('group', { name: 'Show one game' })).getAllByRole('button').slice(1)
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual(snap.categories!.map((g) => `${g.name}, ${g.moments} ${g.moments === 1 ? 'moment' : 'moments'} that hold up today`))
    // the list's (i): ended streams drop out of the list too, until B1
    fireEvent.click(screen.getByRole('button', { name: 'About Top moments today' }))
    const tip = document.querySelector('[data-hub-toggletip-pop]')!.textContent!
    expect(tip).toContain('from the Moments page’s own list')
    expect(tip).toContain('Streams that have ended drop out.')
    fireEvent.click(screen.getByRole('button', { name: 'About Top moments today' }))
    expect(peekRows()).toHaveLength(3)
    expect(peekRows()[0]!.querySelector('button')!.getAttribute('aria-label')).toMatch(/^1\. .+ Open it in Top moments below\.$/)
    // Picking up has none of the day's rows
    expect(rail().querySelector('.hv5-tm-it')).toBeNull()
  })

  it('brings a peek row’s card to the front of the carousel and the carousel into view', async () => {
    render(view({ attempt: 1 }))
    await waitFor(() => expect(peekRows()).toHaveLength(3))
    const third = peekRows()[2]!.querySelector('button')!
    const name = third.getAttribute('aria-label')!.match(/^3\. ([^,]+),/)![1]
    fireEvent.click(third)
    await waitFor(() => expect(front().querySelector('strong')!.textContent).toBe(name))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    expect(document.activeElement).toBe(stage())
    // the peek's link goes down to the carousel
    expect(within(peek()).getByRole('link', { name: 'Top moments ↓' }).getAttribute('href')).toBe('#big-moments')
  })

  it('reads a picked game once and links to its moments', async () => {
    render(view({ attempt: 1 }))
    await waitFor(() => expect(ids().length).toBeGreaterThan(0))
    const ow = fixture.items.find((i) => i.category?.name === 'Overwatch')!.category!.id
    fireEvent.click(await screen.findByRole('button', { name: /^Overwatch, / }))
    await waitFor(() => expect(reads().at(-1)).toMatchObject({ category: ow, verdict: 'ok', sort: 'top' }))
    expect(reads()).toHaveLength(2)
    await waitFor(() => expect(within(big()!).getByRole('link', { name: /^All Overwatch moments →$/ }).getAttribute('href')).toBe('/analytics/moments?category=Overwatch'))
    expect(ids()).toEqual(topFeedRows(answer(items, reads().at(-1)!)).map((r) => r.id))
  })

  it('keeps what a read brings waiting while the mouse is over the carousel, and lets it in when it leaves', async () => {
    const { rerender } = render(view({ attempt: 1 }))
    await waitFor(() => expect(ids().length).toBeGreaterThan(0))
    const before = ids()
    mouse(stage(), 'pointerover')
    const top = fixture.items.find((i) => i.id === before[0])!
    const fresh = { ...top, id: `${top.id}-new`, login: 'newcomer', streamId: 'new-stream', minuteStart: NOW - MIN, score: top.score + 1 }
    items = [...fixture.items, fresh]
    rerender(view({ attempt: 2 }))
    await waitFor(() => expect(feed.load).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(ids()).toEqual(before)
    mouse(stage(), 'pointerout')
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
    matches: on && query.includes('1100px'), media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList)

  it('lists only what is heating up now, strongest × first, with how many more a minute beside it', () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
    render(view({ attempt: 1, hub: hubWith([hot('alpha', 2, 120, 60), hot('bravo', 3, 45, 15), hot('charlie', 1.6, 240, 150)]), nowMs: at }))
    expect(within(rail()).getByRole('heading', { name: 'Picking up now' })).toBeTruthy()
    const links = upRows().map((li) => li.querySelector('a')!)
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual([
      'BRAVO, chat 3.0 times its usual, 30 more messages a minute, Overwatch 2. Opens the stream page.',
      'ALPHA, chat 2.0 times its usual, 60 more messages a minute, Overwatch 2. Opens the stream page.',
      'CHARLIE, chat 1.6 times its usual, 90 more messages a minute, Overwatch 2. Opens the stream page.',
    ])
    expect(links[0]!.querySelector('.hv5-up-add')!.textContent).toBe('+30/min')
    expect(rail().querySelector('.hv5-up-n')!.textContent).toBe('3')
    // no day's moments in the rail
    expect(within(rail()).queryByText('Top moments today')).toBeNull()
  })

  it('shows every row from 1100 px; narrower, the first 6 and Show all in place', () => {
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

  it('fades the list’s bottom only while more of it is below', () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
    let scrolled = 0
    const own = (el: Element, n: number) => (el.classList.contains('hv5-tm-body') ? n : 0)
    const sh = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) { return own(this, 900) })
    const ch = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) { return own(this, 600) })
    const st = vi.spyOn(Element.prototype, 'scrollTop', 'get').mockImplementation(() => scrolled)
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
    }
    // the CSS masks only a body with more below, so the last line never sits in the fade
    const css = readFileSync(resolve(__dirname, '../src/ui/components/hub/v5/hub-v5.css'), 'utf8')
    expect(css.match(/\.hv5-top \.hv5-tm-body \{([^}]*)\}/)![1]).not.toContain('mask-image')
    expect(css).toMatch(/\.hv5-top \.hv5-tm-body\[data-more\] \{ mask-image: linear-gradient\(180deg/)
  })
})

describe('Top moments today’s fallbacks', () => {
  const hubRows = hubTopRows(capture).map((r) => r.id)

  it('shows grey rows in the peek while it waits, and never waits forever', async () => {
    let fail!: (error: unknown) => void
    feed.load.mockImplementation(() => new Promise((_, reject) => { fail = reject }))
    const { rerender } = render(view({ attempt: 0 }))
    expect(peek().hasAttribute('data-wait')).toBe(true)
    expect(big()).toBeNull()
    rerender(view({ attempt: 1 }))
    await waitFor(() => expect(feed.load).toHaveBeenCalledTimes(1))
    // no first answer (the read's 8 seconds ran out): the hub's rows
    rerender(view({ attempt: 1, hub: capture }))
    await act(async () => fail(normalizeApiError(0, {})))
    await waitFor(() => expect(ids()).toEqual(hubRows))
    expect(peek().hasAttribute('data-wait')).toBe(false)
    expect(big()).toBeTruthy()
  })

  it('stays on the hub’s rows for the visit after a 404, with no chips', async () => {
    feed.load.mockImplementation(() => Promise.reject(normalizeApiError(404, {})))
    const { rerender } = render(view({ attempt: 1, hub: capture }))
    await waitFor(() => expect(ids()).toEqual(hubRows))
    expect(source()).toBe('hub')
    expect(screen.queryByRole('group', { name: 'Show one game' })).toBeNull()
    expect(within(big()!).getByRole('link', { name: 'All moments →' })).toBeTruthy()
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
    expect(peekRows()[0]!.classList.contains('hv5-tm-old')).toBe(true)
    expect(peek().className).toContain('hv5-f2-stale')
    rerender(view({ attempt: 2, hub: capture, nowMs: NOW + 15 * MIN }))
    expect(ids()).toEqual(before)
    rerender(view({ attempt: 2, hub: capture, nowMs: NOW + 15 * MIN + 1 }))
    expect(ids()).toEqual(hubRows)
    feed.load.mockImplementation((q: MomentsWindowQuery) => Promise.resolve(answer(items, q)))
    rerender(view({ attempt: 3, hub: capture, nowMs: NOW + 16 * MIN }))
    await waitFor(() => expect(ids()).toEqual(before))
    expect(source()).toBe('feed')
  })

  it('lets a change of source in at once while the mouse is over the carousel', async () => {
    const { rerender } = render(view({ attempt: 1, hub: capture }))
    await waitFor(() => expect(ids().length).toBeGreaterThan(0))
    mouse(stage(), 'pointerover')
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
    expect(big()!.querySelector('.hv5-bm-q')!.textContent).toBe('No standout moments on streams live now yet.')
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
    await waitFor(() => expect(big()?.querySelector('.hv5-bm-q')?.textContent).toBe('Unavailable right now.'))
    expect(within(peek()).getByText('Unavailable right now.')).toBeTruthy()
    expect(rail().querySelector('.hv5-tm-q')!.textContent).toBe('Unavailable right now.')
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    // a read runs again: grey rows
    rerender(view({ attempt: 1, reading: true }))
    expect(peek().hasAttribute('data-wait')).toBe(true)
    expect(big()).toBeNull()
  })

  it('says live on a card only while the hub’s answer is under 15 minutes old', () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
    const at = Date.parse(capture.generatedAt)
    const { rerender } = render(view({ attempt: 1, hub: capture, nowMs: at + 15 * MIN }))
    expect(front().hasAttribute('data-live')).toBe(true)
    // the server still sends that answer later: its streams may have ended since
    rerender(view({ attempt: 1, hub: capture, nowMs: at + 15 * MIN + 1 }))
    expect(front().hasAttribute('data-live')).toBe(false)
  })

  it('says none yet when the hub has no standout moments, and keeps the link', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
    render(view({ attempt: 1, hub: { ...capture, livePulseMoments: [] } }))
    expect(big()!.querySelector('.hv5-bm-q')!.textContent).toBe('No standout moments on streams live now yet.')
    expect(within(big()!).getByRole('link', { name: 'All moments →' })).toBeTruthy()
    expect(within(peek()).getByText('No standout moments on streams live now yet.')).toBeTruthy()
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
      expect(big()!.querySelectorAll('.hv5-bm-card')).toHaveLength(10)
      const last = big()!.querySelector<HTMLElement>('.hv5-bm-card[data-i="9"]')!
      expect(last.querySelector('.hv5-bm-lbl')!.textContent).toBe('Busiest minute')
      expect(last.querySelector('.hv5-bm-x')!.textContent).toBe('388chat/min')
      const kept = JSON.parse(window.localStorage.getItem(TOP_DAY_KEY)!) as { id: string }[]
      expect(kept.map((r) => r.id)).toEqual(hubRows)
    })

    it('shows busiest minutes when the hub has no standout moments, in place of "none yet"', () => {
      vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
      window.localStorage.removeItem(TOP_DAY_KEY)
      render(view({ attempt: 1, hub: { ...capture, livePulseMoments: [] }, nowMs: at, busiest: fill.slice(0, 2) }))
      expect(big()!.querySelector('.hv5-bm-q')).toBeNull()
      expect(big()!.querySelectorAll('.hv5-bm-card')).toHaveLength(2)
      expect(peekRows().map((r) => r.textContent)).toEqual([expect.stringContaining('Busiest minute · 1,204 chat/min'), expect.stringContaining('Busiest minute · 412 chat/min')])
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
