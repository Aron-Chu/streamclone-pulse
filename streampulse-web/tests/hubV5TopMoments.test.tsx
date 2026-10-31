import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeApiError } from '../src/lib/apiClient'
import type { MomentsFeedCategoryFacet, MomentsFeedItem, MomentsFeedSnapshot, MomentsWindowQuery } from '../src/lib/momentsFeed'
import { normalizePublicHub, type HubLiveChannel, type PublicHub } from '../src/lib/publicHub'
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

import { HubV5TopMoments, HubV5TopPeek, useTopToday } from '../src/ui/components/hub/v5/HubV5TopMoments'
import { hubTopRows, topFeedRows } from '../src/ui/components/hub/v5/hubV5TopModel'

/** The backend as the rail reads it: the window, the verdict and the game filter the moments, the total and the games facet. */
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
const peek = () => document.querySelector<HTMLElement>('.hv5-f3-peek')!
const rows = () => [...rail().querySelectorAll<HTMLElement>('.hv5-tm-list > .hv5-tm-it')]
const ids = () => rows().map((li) => li.dataset.id)

interface RailProps { attempt: number; hub?: PublicHub | null; nowMs?: number; reading?: boolean }
function Rail({ attempt, hub = null, nowMs = NOW, reading = true }: RailProps) {
  const top = useTopToday({ hub, savedAt: null, reading, attempt, nowMs })
  return <><HubV5TopPeek top={top} nowMs={nowMs} /><HubV5TopMoments top={top} nowMs={nowMs} /></>
}
const view = (p: RailProps) => <MemoryRouter><div className="hub-v5"><Rail {...p} /></div></MemoryRouter>

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

describe('Top moments today from the Moments list', () => {
  it('opens on the day’s top 20 that hold up, ranked, counted in the footer and the chips', async () => {
    render(view({ attempt: 1 }))
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    expect(screen.getByRole('heading', { name: 'Top moments today' })).toBeTruthy()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(reads()).toEqual([{ from: Math.floor((NOW - 24 * 3600_000) / 600_000) * 600_000, sort: 'top', verdict: 'ok', limit: 50, category: null }])
    const snap = answer(items, reads()[0]!)
    expect(ids()).toEqual(topFeedRows(snap).map((r) => r.id))
    expect(rows().length).toBeLessThanOrEqual(20)
    expect(rows()[0]!.querySelector('.hv5-tm-rk')?.textContent).toBe('1')
    expect(rail().querySelector('.hv5-tm-ft')?.textContent).toBe(`Top ${rows().length} of ${snap.total} today·Every moment →`)
    expect(within(rail().querySelector<HTMLElement>('.hv5-tm-ft')!).getByRole('link').getAttribute('href')).toBe('/analytics/moments?view=top')
    const chips = within(screen.getByRole('group', { name: 'Show one game' })).getAllByRole('button').slice(1)
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual(snap.categories!.map((g) => `${g.name}, ${g.moments} ${g.moments === 1 ? 'moment' : 'moments'} that hold up today`))
    // the list's (i): ended streams drop out of the list too, until B1
    fireEvent.click(screen.getByRole('button', { name: 'About Top moments today' }))
    const tip = document.querySelector('[data-hub-toggletip-pop]')!.textContent!
    expect(tip).toContain('from the Moments page’s own list')
    expect(tip).toContain('Streams that have ended drop out.')
    fireEvent.click(screen.getByRole('button', { name: 'About Top moments today' }))
    // the phone peek: rows 1–3
    expect([...peek().querySelectorAll<HTMLElement>('.hv5-tm-it')].map((li) => li.textContent)).toEqual(rows().slice(0, 3).map((li) => li.querySelector('button')!.textContent))
  })

  it('opens a row under itself with its minutes, Watch and Open in Moments, one row at a time; Esc closes it', async () => {
    render(view({ attempt: 1 }))
    await waitFor(() => expect(rows().length).toBeGreaterThan(1))
    const [first, second] = rows().map((li) => li.querySelector('button')!)
    fireEvent.click(first!)
    expect(first!.getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(screen.getByRole('link', { name: /Watch on Twitch/ })).toBeTruthy())
    const key = rows()[0]!.dataset.id!
    expect(screen.getByRole('link', { name: 'Open in Moments' }).getAttribute('href')).toBe(`/analytics/moments?m=${encodeURIComponent(key)}`)
    expect(document.getElementById(first!.getAttribute('aria-controls')!)!.querySelector('.hv5-tm-ch')).toBeTruthy()
    fireEvent.click(second!)
    expect(first!.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelectorAll('.hv5-tm-det')).toHaveLength(1)
    // taken (default prevented), so an open bar card under the chart stays
    expect(fireEvent.keyDown(second!, { key: 'Escape' })).toBe(false)
    expect(document.querySelectorAll('.hv5-tm-det')).toHaveLength(0)
    expect(fireEvent.keyDown(second!, { key: 'Escape' })).toBe(true)
  })

  it('reads a picked game once and links to its moments', async () => {
    render(view({ attempt: 1 }))
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const ow = fixture.items.find((i) => i.category?.name === 'Overwatch')!.category!.id
    fireEvent.click(await screen.findByRole('button', { name: /^Overwatch, / }))
    await waitFor(() => expect(reads().at(-1)).toMatchObject({ category: ow, verdict: 'ok', sort: 'top' }))
    expect(reads()).toHaveLength(2)
    await waitFor(() => expect(screen.getByRole('link', { name: /Overwatch.*moments →/ }).getAttribute('href')).toBe(`/analytics/moments?view=top&game=${ow}`))
    expect(within(rail().querySelector<HTMLElement>('.hv5-tm-ft')!).getByRole('link').getAttribute('href')).toBe(`/analytics/moments?view=top&game=${ow}`)
    // the footer names the game, as the 10-25 rail did
    const mine = answer(items, reads().at(-1)!)
    await waitFor(() => expect(rail().querySelector('.hv5-tm-ft')?.textContent)
      .toBe(`Top ${rows().length} of ${mine.total} Overwatch ${mine.total === 1 ? 'moment' : 'moments'} today·Every Overwatch moment →`))
  })

  it('keeps what a read brings behind the pill while the pointer is in the list or a row is open', async () => {
    const { rerender } = render(view({ attempt: 1 }))
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const before = ids()
    fireEvent.pointerEnter(rail().querySelector('.hv5-tm-wrap')!, { pointerType: 'mouse' })
    const top = fixture.items.find((i) => i.id === before[0])!
    const fresh = { ...top, id: `${top.id}-new`, login: 'newcomer', streamId: 'new-stream', minuteStart: NOW - MIN, score: top.score + 1 }
    items = [...fixture.items, fresh]
    rerender(view({ attempt: 2 }))
    const pill = await screen.findByRole('button', { name: 'Show 1 new moment' })
    expect(ids()).toEqual(before)
    // the pointer leaves with a row open: still held until it closes
    fireEvent.click(rows()[1]!.querySelector('button')!)
    fireEvent.pointerLeave(rail().querySelector('.hv5-tm-wrap')!)
    expect(ids()).toEqual(before)
    expect(pill.hidden).toBe(false)
    fireEvent.click(rows()[1]!.querySelector('button')!)
    await waitFor(() => expect(ids()[0]).toBe(fresh.id))
  })

  it('keeps Picking up on top of the list, closed until clicked', async () => {
    const hot = { login: 'alpha', displayName: 'ALPHA', category: 'Overwatch 2', streamId: 's-alpha', coverageState: 'synced', screenerV1: screener() } as unknown as HubLiveChannel
    render(view({ attempt: 1, hub: { ...capture, liveChannels: [hot] } }))
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const body = rail().querySelector('.hv5-tm-body')!
    expect(body.firstElementChild!.classList.contains('hv5-tm-up')).toBe(true)
    const up = within(body.firstElementChild as HTMLElement).getAllByRole('button')[0]!
    expect(up.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(up)
    expect(up.getAttribute('aria-expanded')).toBe('true')
  })

  it('opens a peek row in the rail', async () => {
    render(view({ attempt: 1 }))
    await waitFor(() => expect(peek().querySelectorAll('.hv5-tm-it')).toHaveLength(3))
    const second = within(peek()).getAllByRole('button')[1]!
    expect(second.getAttribute('aria-label')).toMatch(/^2\. .+ Open it in Top moments below\.$/)
    fireEvent.click(second)
    expect(rows()[1]!.querySelector('button')!.getAttribute('aria-expanded')).toBe('true')
    // focus goes to the opened row, so the next Tab and a screen reader carry on from there
    await waitFor(() => expect(document.activeElement).toBe(rows()[1]!.querySelector('button')))
  })

  it('keeps fitting the column at 1100–1535 px while a row is open; only Show more lifts it', async () => {
    const mq = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query.includes('1100px'), media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }) as MediaQueryList)
    // the column gives the list 246 px: 4 rows
    const box = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 250, left: 0, right: 300, width: 300, height: 250, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    try {
      render(view({ attempt: 1 }))
      await waitFor(() => expect(rows()).toHaveLength(4))
      const more = screen.getByRole('button', { name: /^Show \d+ more$/ })
      fireEvent.click(rows()[1]!.querySelector('button')!)
      expect(rows()[1]!.querySelector('button')!.getAttribute('aria-expanded')).toBe('true')
      expect(rows()).toHaveLength(4)
      expect(more.isConnected).toBe(true)
      fireEvent.click(rows()[1]!.querySelector('button')!)
      fireEvent.click(more)
      expect(rows().length).toBeGreaterThan(4)
      // Show fewer hides an open row 6: it closes, so the rail fits the column again and reads aren't held
      fireEvent.click(rows()[5]!.querySelector('button')!)
      expect(rail().querySelectorAll('.hv5-tm-det')).toHaveLength(1)
      fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
      expect(rows()).toHaveLength(4)
      expect(rail().querySelectorAll('.hv5-tm-det')).toHaveLength(0)
      expect(rail().classList.contains('hv5-fd-fit')).toBe(true)
      // an open row Show fewer keeps stays open
      fireEvent.click(screen.getByRole('button', { name: /^Show \d+ more$/ }))
      fireEvent.click(rows()[1]!.querySelector('button')!)
      fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
      expect(rows()[1]!.querySelector('button')!.getAttribute('aria-expanded')).toBe('true')
    } finally {
      mq.mockRestore()
      box.mockRestore()
    }
  })

  it('fades the list’s bottom only while more of it is below (≥ 1536 px)', async () => {
    let scrolled = 0
    const own = (el: Element, n: number) => (el.classList.contains('hv5-tm-body') ? n : 0)
    const sh = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) { return own(this, 900) })
    const ch = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) { return own(this, 600) })
    const st = vi.spyOn(Element.prototype, 'scrollTop', 'get').mockImplementation(() => scrolled)
    try {
      render(view({ attempt: 1 }))
      await waitFor(() => expect(rows().length).toBeGreaterThan(0))
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

  it('shows grey rows while it waits, and never waits forever', async () => {
    let fail!: (error: unknown) => void
    feed.load.mockImplementation(() => new Promise((_, reject) => { fail = reject }))
    const { rerender } = render(view({ attempt: 0 }))
    expect(rail().querySelector('.hv5-tm-wait')!.getAttribute('aria-busy')).toBe('true')
    expect(within(rail()).getByRole('status').textContent).toBe('Loading top moments')
    expect(peek().hasAttribute('data-wait')).toBe(true)
    rerender(view({ attempt: 1 }))
    await waitFor(() => expect(feed.load).toHaveBeenCalledTimes(1))
    // no first answer (the read's 8 seconds ran out): the hub's rows
    rerender(view({ attempt: 1, hub: capture }))
    await act(async () => fail(normalizeApiError(0, {})))
    await waitFor(() => expect(ids()).toEqual(hubRows))
    expect(within(rail()).queryByRole('status')).toBeNull()
  })

  it('stays on the hub’s rows for the visit after a 404, with the hub’s words', async () => {
    feed.load.mockImplementation(() => Promise.reject(normalizeApiError(404, {})))
    const { rerender } = render(view({ attempt: 1, hub: capture }))
    await waitFor(() => expect(ids()).toEqual(hubRows))
    expect(rail().querySelector('.hv5-tm-q')!.textContent).toBe('That’s all on streams live now. Every moment today →')
    expect(rail().querySelector('.hv5-tm-ft')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Show one game' })).toBeNull()
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
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const before = ids()
    feed.load.mockImplementation(() => Promise.reject(normalizeApiError(503, {})))
    rerender(view({ attempt: 2, hub: capture }))
    await waitFor(() => expect(rows()[0]!.classList.contains('hv5-tm-old')).toBe(true))
    expect(ids()).toEqual(before)
    expect(rail().className).toContain('hv5-f2-stale')
    rerender(view({ attempt: 2, hub: capture, nowMs: NOW + 15 * MIN }))
    expect(ids()).toEqual(before)
    rerender(view({ attempt: 2, hub: capture, nowMs: NOW + 15 * MIN + 1 }))
    expect(ids()).toEqual(hubRows)
    feed.load.mockImplementation((q: MomentsWindowQuery) => Promise.resolve(answer(items, q)))
    rerender(view({ attempt: 3, hub: capture, nowMs: NOW + 16 * MIN }))
    await waitFor(() => expect(ids()).toEqual(before))
    expect(rows()[0]!.classList.contains('hv5-tm-old')).toBe(false)
  })

  it('lets a change of source in at once while the pointer is in the list, with no pill', async () => {
    const { rerender } = render(view({ attempt: 1, hub: capture }))
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.pointerEnter(rail().querySelector('.hv5-tm-wrap')!, { pointerType: 'mouse' })
    feed.load.mockImplementation(() => Promise.reject(normalizeApiError(503, {})))
    rerender(view({ attempt: 2, hub: capture }))
    await act(async () => {})
    // the kept list runs out: the hub's rows, whose ids are not the list's, so nothing counts as new
    rerender(view({ attempt: 2, hub: capture, nowMs: NOW + 15 * MIN + 1 }))
    expect(ids()).toEqual(hubRows)
    expect(rail().querySelector<HTMLElement>('.hv5-f2-pill')!.hidden).toBe(true)
  })

  it('holds a change of source while a row is open, with no pill, until it closes', async () => {
    const { rerender } = render(view({ attempt: 1, hub: capture }))
    await waitFor(() => expect(rows().length).toBeGreaterThan(1))
    const before = ids()
    fireEvent.click(rows()[1]!.querySelector('button')!)
    feed.load.mockImplementation(() => Promise.reject(normalizeApiError(503, {})))
    rerender(view({ attempt: 2, hub: capture }))
    await act(async () => {})
    rerender(view({ attempt: 2, hub: capture, nowMs: NOW + 15 * MIN + 1 }))
    expect(ids()).toEqual(before)
    expect(rail().querySelector<HTMLElement>('.hv5-f2-pill')!.hidden).toBe(true)
    fireEvent.click(rows()[1]!.querySelector('button')!)
    await waitFor(() => expect(ids()).toEqual(hubRows))
  })

  it('keeps the chips and All when a picked game’s first read fails, with the hub’s rows from that game only', async () => {
    render(view({ attempt: 1, hub: capture }))
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
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
    await waitFor(() => expect(rows()).toHaveLength(0))
    expect(rail().querySelector('.hv5-tm-q')!.textContent).toBe('No standout moments on streams live now yet. Every moment today →')
    fireEvent.click(within(chips).getByRole('button', { name: 'All' }))
    await waitFor(() => expect(ids()).toEqual(all))
  })

  it('goes back to All’s last list, greyed, when All’s read fails after a pick', async () => {
    const { rerender } = render(view({ attempt: 1, hub: capture }))
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const all = ids()
    fireEvent.click(await screen.findByRole('button', { name: /^Overwatch, / }))
    await waitFor(() => expect(reads()).toHaveLength(2))
    await waitFor(() => expect(ids()).not.toEqual(all))
    feed.load.mockImplementation(() => Promise.reject(normalizeApiError(503, {})))
    rerender(view({ attempt: 2, hub: capture }))
    await waitFor(() => expect(rows()[0]!.classList.contains('hv5-tm-old')).toBe(true))
    fireEvent.click(within(screen.getByRole('group', { name: 'Show one game' })).getByRole('button', { name: 'All' }))
    await waitFor(() => expect(ids()).toEqual(all))
    expect(rows()[0]!.classList.contains('hv5-tm-old')).toBe(true)
    expect(screen.getByRole('group', { name: 'Show one game' })).toBeTruthy()
  })

  it('says unavailable with no Try again of its own when there is nothing at all (the page banner has the one, Q5b)', async () => {
    feed.load.mockImplementation(() => Promise.reject(normalizeApiError(404, {})))
    const { rerender } = render(view({ attempt: 1, reading: false }))
    await waitFor(() => expect(rail().querySelector('.hv5-tm-q')?.textContent).toBe('Unavailable right now.'))
    expect(within(peek()).getByText('Unavailable right now.')).toBeTruthy()
    expect(within(rail()).queryByRole('button', { name: 'Try again' })).toBeNull()
    // a read runs again: grey rows
    rerender(view({ attempt: 1, reading: true }))
    expect(rail().querySelector('.hv5-tm-wait')).toBeTruthy()
    expect(rail().querySelector('.hv5-tm-q')).toBeNull()
  })

  it('says live now in an opened row only while the hub’s answer is under 15 minutes old', () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
    const at = Date.parse(capture.generatedAt)
    const { rerender } = render(view({ attempt: 1, hub: capture, nowMs: at + 15 * MIN }))
    fireEvent.click(rows()[0]!.querySelector('button')!)
    expect(rail().querySelector('.hv5-tm-lv')?.textContent).toBe('● live now')
    // the server still sends that answer later: its streams may have ended since
    rerender(view({ attempt: 1, hub: capture, nowMs: at + 15 * MIN + 1 }))
    expect(rail().querySelector('.hv5-tm-det')).toBeTruthy()
    expect(rail().querySelector('.hv5-tm-lv')).toBeNull()
  })

  it('says none yet when the hub has no standout moments, and keeps the link', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
    render(view({ attempt: 1, hub: { ...capture, livePulseMoments: [] } }))
    expect(rail().querySelector('.hv5-tm-q')!.textContent).toBe('No standout moments on streams live now yet. Every moment today →')
    expect(within(peek()).getByText('No standout moments on streams live now yet.')).toBeTruthy()
    expect(feed.load).not.toHaveBeenCalled()
  })
})

function screener(): HubChannelScreenerV1 {
  const at = Date.parse(capture.generatedAt)
  return {
    version: 1, measuredAt: at, baselineKind: 'current_stream_measured_average', state: 'ready',
    currentWindow: { start: at - 5 * MIN, end: at, expectedMinutes: 5, measuredMinutes: 5, coveragePct: 100 },
    baselineWindow: null, baselineMeasuredMinutes: 40, evidence: null, emotes: null,
    chat: {
      state: 'ready', currentPerMin: 120, baselinePerMin: 60, absoluteDeltaPerMin: 60, changePct: 100, multiplier: 2,
      currentMeasuredMinutes: 5, currentExpectedMinutes: 5, baselineMeasuredMinutes: 40, baselineExpectedMinutes: 40, baselineCoveragePct: 100,
    },
  } as unknown as HubChannelScreenerV1
}
