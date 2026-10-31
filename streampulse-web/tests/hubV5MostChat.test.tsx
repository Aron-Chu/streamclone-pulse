/**
 * Featured stream (picks I1 and I1b, 10-30): the hub's featured stream under
 * Busiest now, from the 2026-10-30 07:19Z answers. It shows on every hub
 * answer that has a ready featured stream (not a saved copy or totals only);
 * its chat/min shows only while Busiest now ranks by the same recent
 * average (a 30m or 24h answer with the 5-minute chat check down) and lists the
 * stream (reviews 10-30), so the 24h answer with every screener down names 373
 * and a working check shows the stream without a number. The hub hook is
 * mocked and fetch never answers: no live API.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizePublicHub, type HubFeaturedSession, type HubLiveChannel, type PublicHub } from '../src/lib/publicHub'
import AnalyticsHubV5Page from '../src/routes/analytics/AnalyticsHubV5Page'
import { HubV5MostChat, mostChatModel, mostChatOffset } from '../src/ui/components/hub/v5/HubV5MostChat'
import { hubChatBasis, screenerDown } from '../src/ui/components/hub/v5/hubV5Model'

const raw = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/hub_featured_session_20261030.json'), 'utf8'))
/** The window fields of that 24h answer (evidence/hub-24h-down.json); the fixture trims its activity. */
const ACTIVITY_24H = { windowMinutes: 1440, requestedWindowMinutes: 1440, servedWindowMinutes: 30, availableWindowMinutes: 30, source: 'live_pool_fallback', state: 'degraded', points: [] }
/** The 24h answer with every screener set to history_query_unavailable (evidence/hub-24h-down.json). */
const down = normalizePublicHub({ ...raw.down24h, activity: ACTIVITY_24H })
/** The 30m answer's featured stream, read two seconds later (evidence/hub-30m.json). */
const featured30m = normalizePublicHub({ featuredSession: raw.featured30m }).featuredSession
const NOW = Date.parse(down.generatedAt)

/** The same answer for another window: only its activity's window fields differ. */
const forWindow = (requestedWindowMinutes: number, windowMinutes = requestedWindowMinutes): PublicHub =>
  ({ ...down, activity: { ...down.activity, windowMinutes, requestedWindowMinutes } })

/** One row with a full, ready 5-minute window: the check is up for it (as hubV5ChatAverage.test.tsx). */
function withFullWindow(c: HubLiveChannel, perMin: number): HubLiveChannel {
  const end = NOW - 60_000
  return {
    ...c,
    screenerV1: {
      ...c.screenerV1!,
      state: 'ready',
      reason: undefined,
      currentWindow: { start: end - 300_000, end, expectedMinutes: 5, measuredMinutes: 5, coveragePct: 100 },
      chat: { ...c.screenerV1!.chat!, state: 'ready', reason: undefined, currentPerMin: perMin },
    },
  } as HubLiveChannel
}

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

const card = (featured: HubFeaturedSession | null, avatars?: ReadonlyMap<string, string>, showRate = true) =>
  render(<MemoryRouter><HubV5MostChat featured={featured} showRate={showRate} avatars={avatars} /></MemoryRouter>)
const section = () => document.querySelector<HTMLElement>('.hv5-most')
const moments = () => [...document.querySelectorAll('.hv5-mst-mo')].map((el) => el.textContent)
const rate = () => section()?.querySelector('.hv5-mst-x')?.textContent ?? null
const MOMENTS_0719 = ['0:13:54 YappingDuck 930', '1:35:54 NotLikeThis 1,286', '0:41:54 YappingDuck 319']
const page = (search = '') => <MemoryRouter initialEntries={[`/analytics${search}`]}><AnalyticsHubV5Page /></MemoryRouter>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW + 20_000)
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

describe('Featured stream (picks I1 and I1b, 10-30)', () => {
  it('shows the featured stream: name, category, watching, chat/min and 3 top moments in the reply’s order', () => {
    card(down.featuredSession)
    const el = section()!
    expect(within(el).getByRole('heading', { name: 'Featured stream' })).toBeTruthy()
    expect(el.querySelector('.hv5-mst-l1')!.textContent).toBe('ゆゆうた押忍 · Just Chatting · 10,682 watching')
    // 372.5 rounds as every hub rate does
    expect(el.querySelector('.hv5-mst-l2')!.textContent).toBe('373 chat/min · recent average')
    expect(moments()).toEqual(['0:13:54 YappingDuck 930', '1:35:54 NotLikeThis 1,286', '0:41:54 YappingDuck 319'])
    expect(el.querySelector('.hv5-mst-note')!.textContent).toBe('Top moments: 0:13:54 YappingDuck 930 · 1:35:54 NotLikeThis 1,286 · 0:41:54 YappingDuck 319')
  })

  it('names no chat/min unless the page asks for it, and keeps the rest (I1b)', () => {
    card(down.featuredSession, undefined, false)
    const el = section()!
    expect(within(el).getByRole('heading', { name: 'Featured stream' })).toBeTruthy()
    expect(el.querySelector('.hv5-mst-l1')!.textContent).toBe('ゆゆうた押忍 · Just Chatting · 10,682 watching')
    expect(el.querySelector('.hv5-mst-l2')).toBeNull()
    expect(el.textContent).not.toMatch(/chat\/min|373/)
    expect(moments()).toEqual(MOMENTS_0719)
    expect(screen.getByRole('link', { name: 'Open stream: ゆゆうた押忍' })).toBeTruthy()
  })

  it('reads the 30m answer’s own rate', () => {
    card(featured30m)
    expect(section()!.querySelector('.hv5-mst-x')!.textContent).toBe('374')
    expect(moments()).toHaveLength(3)
  })

  it('links to the stream’s page, as the other hub cards do', () => {
    card(down.featuredSession)
    const link = screen.getByRole('link', { name: 'Open stream: ゆゆうた押忍' })
    expect(link.textContent).toBe('Open stream →')
    expect(link.getAttribute('href')).toBe('/analytics/yuyuta0702/316655688306')
  })

  it('takes the picture from the answer’s live rows, else the monogram', () => {
    const avatars = new Map(down.liveChannels.filter((c) => c.profileImageUrl).map((c) => [c.login, c.profileImageUrl!]))
    const { unmount } = card(down.featuredSession, avatars)
    expect(section()!.querySelector('img')!.getAttribute('src')).toContain('c9923860-b55f-435f-be2d-560107cc2205')
    unmount()
    card(down.featuredSession)
    expect(section()!.querySelector('img')).toBeNull()
    expect(section()!.querySelector('.hv5-mono')!.textContent).toBe('ゆゆ')
  })

  it('is hidden when the featured stream is empty, not ready or has no login', () => {
    const ready = down.featuredSession
    expect(mostChatModel(normalizePublicHub(null).featuredSession)).toBeNull()
    expect(mostChatModel({ state: 'empty', reason: 'insufficient_peaks' })).toBeNull()
    expect(mostChatModel({ ...ready, state: 'empty' })).toBeNull()
    expect(mostChatModel({ ...ready, login: '' })).toBeNull()
    expect(mostChatModel({ ...ready, login: '  ' })).toBeNull()
    expect(mostChatModel({ ...ready, login: undefined })).toBeNull()
    expect(mostChatModel(null)).toBeNull()
    const { container } = card({ state: 'empty', reason: 'no_qualifying_session' })
    expect(container.innerHTML).toBe('')
  })

  it('leaves out what the reply does not have, and wrong-typed text', () => {
    const ready = down.featuredSession
    const bare = mostChatModel({ ...ready, category: undefined, viewers: 0, chatPerMin: undefined, topMoments: [] })!
    expect(bare.meta).toBe('')
    expect(bare.chat).toBeNull()
    expect(bare.moments).toEqual([])
    card({ ...ready, category: undefined, viewers: undefined, chatPerMin: undefined, topMoments: [] })
    expect(section()!.querySelector('.hv5-mst-l1')!.textContent).toBe('ゆゆうた押忍')
    expect(section()!.querySelector('.hv5-mst-l2')).toBeNull()
    expect(section()!.querySelector('.hv5-mst-note')).toBeNull()

    const odd = mostChatModel({
      ...ready,
      displayName: { x: 1 } as unknown as string,
      category: 7 as unknown as string,
      streamId: undefined,
      topMoments: [
        { offsetSeconds: 59, score: 1, label: 'Chat spike' },
        { offsetSeconds: 36_000, score: 1, label: 'Emote spike', topEmoteCode: 'KEKW' },
      ],
    })!
    expect(odd.name).toBe('yuyuta0702')
    expect(odd.meta).toBe('10,682 watching')
    expect(odd.href).toBe('/analytics/yuyuta0702')
    expect(odd.moments.map((m) => [m.at, m.emote, m.count])).toEqual([['0:00:59', null, null], ['10:00:00', 'KEKW', null]])
    expect(mostChatModel({ ...ready, login: { x: 1 } as unknown as string })).toBeNull()
  })

  it('takes the name and game from the live row, exactly as Busiest now shows them, whatever the stream ids (reviews and pick 15B, 10-30)', () => {
    const ready = down.featuredSession
    expect(ready.state === 'ready' && ready.streamId).toBe('316655688306')
    // a guest streaming together: the live row carries the host's game, the stored stream record the guest's own
    const guest = mostChatModel(ready, { displayName: 'ゆゆうた', category: 'Minecraft' })!
    expect(guest.name).toBe('ゆゆうた')
    expect(guest.meta).toBe('Minecraft · 10,682 watching')
    // no game on the row: Busiest now says "No category", so the card names none; no name: the login, as Busiest now
    const bare = mostChatModel(ready, { displayName: '', category: undefined })!
    expect(bare.meta).toBe('10,682 watching')
    expect(bare.name).toBe('yuyuta0702')
    // a row with another stream id names what Busiest now names; the moments and link stay the stored record's
    const live = down.liveChannels.find((c) => c.login === 'yuyuta0702')!
    const otherRow = { ...live, displayName: 'ゆゆうた', category: 'Minecraft', streamId: '316999999999' }
    const other = mostChatModel(ready, otherRow)!
    expect(other.name).toBe('ゆゆうた')
    expect(other.meta).toBe('Minecraft · 10,682 watching')
    expect(other.href).toBe('/analytics/yuyuta0702/316655688306')
    expect(other.moments).toHaveLength(3)
    // no row at all: the stored record
    expect(mostChatModel(ready, null)!.name).toBe('ゆゆうた押忍')
    expect(mostChatModel(ready, null)!.meta).toBe('Just Chatting · 10,682 watching')
  })

  it('holds the card’s place with one hidden grey block while Busiest now waits, and only then (pick K1, 10-30)', () => {
    const wait = (featured: HubFeaturedSession | null, waiting: boolean) =>
      render(<MemoryRouter><HubV5MostChat featured={featured} showRate={false} waiting={waiting} /></MemoryRouter>)
    const { unmount } = wait(null, true)
    const el = section()!
    expect(el.classList.contains('hv5-mst-wait')).toBe(true)
    expect(el.getAttribute('aria-hidden')).toBe('true')
    // the card's own rows, for its height: no link, no name, nothing for a screen reader
    expect(el.querySelector('.hv5-mst-rw')).toBeTruthy()
    expect(el.querySelector('.hv5-mst-note')).toBeTruthy()
    expect(el.querySelector('a')).toBeNull()
    expect(el.querySelector('.hv5-mst-l2')).toBeNull()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(el.querySelector('h1, h2, h3')).toBeNull()
    unmount()
    // a card to show wins; no card and no wait is nothing
    const ready = wait(down.featuredSession, true)
    expect(section()!.classList.contains('hv5-mst-wait')).toBe(false)
    expect(section()!.querySelector('.hv5-mst-nm')!.textContent).toBe('ゆゆうた押忍')
    ready.unmount()
    expect(wait({ state: 'empty', reason: 'no_qualifying_session' }, false).container.innerHTML).toBe('')
  })

  it('writes every offset as h:mm:ss', () => {
    expect(mostChatOffset(834)).toBe('0:13:54')
    expect(mostChatOffset(5754)).toBe('1:35:54')
    expect(mostChatOffset(2514.9)).toBe('0:41:54')
    expect(mostChatOffset(0)).toBe('0:00:00')
    expect(mostChatOffset(-5)).toBe('0:00:00')
  })
})

describe('Featured stream on the hub page (picks I1 and I1b, 10-30)', () => {
  it('shows under Busiest now while the chat check is down and Busiest now ranks by recent averages', () => {
    expect(screenerDown(down.liveChannels)).toBe(true)
    expect(hubChatBasis(down.liveChannels, '24h')).toBe('avg_35')
    setHub({ data: down, loadSource: 'full', lastUpdated: NOW })
    const { container } = render(page())
    const el = section()!
    expect(el).toBeTruthy()
    // its own grid row, right under Busiest now
    expect(container.querySelector('#busiest')!.nextElementSibling).toBe(el)
    expect(el.querySelector('.hv5-mst-nm')!.textContent).toBe('ゆゆうた押忍')
    expect(moments()).toEqual(['0:13:54 YappingDuck 930', '1:35:54 NotLikeThis 1,286', '0:41:54 YappingDuck 319'])
    // Busiest now ranks the same stream first at the same rate
    expect(container.querySelector('#busiest')!.textContent).toMatch(/recent average/)
    const first = container.querySelector('#busiest li[data-rank="1"]')!
    expect(first.getAttribute('data-login')).toBe('yuyuta0702')
    expect(first.querySelector('.hv5-bzt-fig b')!.textContent).toBe('373')
    expect(el.querySelector('.hv5-mst-x')!.textContent).toBe('373')
  })

  it('shows on 30m the same way', () => {
    setHub({ data: forWindow(30), loadSource: 'full', lastUpdated: NOW })
    render(page('?window=30m'))
    expect(rate()).toBe('373')
  })

  it('shows without its chat/min while the chat check works, as Busiest now then ranks by 5-minute counts (I1b)', () => {
    const up = { ...down, liveChannels: down.liveChannels.map((c, i) => (i === 1 ? withFullWindow(c, 410) : c)) }
    expect(hubChatBasis(up.liveChannels, '24h')).toBe('five_min')
    setHub({ data: up, loadSource: 'full', lastUpdated: NOW })
    const { container } = render(page())
    const el = section()!
    expect(container.querySelector('#busiest')!.nextElementSibling).toBe(el)
    expect(container.querySelector('#busiest')!.textContent).not.toMatch(/recent average/)
    expect(within(el).getByRole('heading', { name: 'Featured stream' })).toBeTruthy()
    expect(el.querySelector('.hv5-mst-nm')!.textContent).toBe('ゆゆうた押忍')
    expect(el.querySelector('.hv5-mst-l2')).toBeNull()
    expect(el.textContent).not.toMatch(/chat\/min/)
    expect(moments()).toEqual(MOMENTS_0719)
  })

  it('names no second rate when Busiest now lists the same stream on 5-minute counts, the normal state (I1b; review 10-30)', () => {
    // 07:19Z: the check worked and ゆゆうた押忍 was Busiest now's #1 at 486 on 5-minute counts; the card's average is 373.
    // Its live row names another game here (a guest streaming together), and the card follows the row. Other streams'
    // rows come first (07:19Z: xqc was row 0), so the card has to find its own.
    const rows = down.liveChannels.map((c) => (c.login === 'yuyuta0702' ? { ...withFullWindow(c, 486), category: 'Minecraft' } : c))
    const up = { ...down, liveChannels: [...rows.filter((c) => c.login !== 'yuyuta0702'), ...rows.filter((c) => c.login === 'yuyuta0702')] }
    expect(up.liveChannels[0].login).not.toBe('yuyuta0702')
    expect(hubChatBasis(up.liveChannels, '24h')).toBe('five_min')
    setHub({ data: up, loadSource: 'full', lastUpdated: NOW })
    const { rerender } = render(page())
    const first = document.querySelector('#busiest li[data-rank="1"]')!
    expect(first.getAttribute('data-login')).toBe('yuyuta0702')
    expect(first.querySelector('.hv5-bzt-fig b')!.textContent).toBe('486')
    expect(first.querySelector('.hv5-bzt-cat')!.textContent).toBe('Minecraft')
    expect(section()!.querySelector('.hv5-mst-l1')!.textContent).toBe('ゆゆうた押忍 · Minecraft · 10,682 watching')
    expect(section()!.querySelector('.hv5-mst-l2')).toBeNull()
    expect(section()!.textContent).not.toMatch(/chat\/min|373/)
    // the check goes down: Busiest now ranks by the average, and the card names the same 373
    setHub({ data: down, loadSource: 'full', lastUpdated: NOW })
    rerender(page())
    expect(document.querySelector('#busiest li[data-rank="1"] .hv5-bzt-fig b')!.textContent).toBe('373')
    expect(rate()).toBe('373')
    // and back: the number goes with it
    setHub({ data: up, loadSource: 'full', lastUpdated: NOW })
    rerender(page())
    expect(document.querySelector('#busiest li[data-rank="1"] .hv5-bzt-fig b')!.textContent).toBe('486')
    expect(rate()).toBeNull()
    expect(section()!.textContent).not.toMatch(/chat\/min|373/)
  })

  it('stays while a 30m and 24h switch loads, as Busiest now keeps the same recent averages (review 10-30)', () => {
    // the 24h answer still on screen while 30m loads, and the other way round
    setHub({ data: down, loadSource: 'full', lastUpdated: NOW })
    render(page('?window=30m'))
    expect(rate()).toBe('373')
    expect(document.querySelector('#busiest')!.textContent).toMatch(/recent average/)
    cleanup()
    setHub({ data: forWindow(30), loadSource: 'full', lastUpdated: NOW })
    render(page())
    expect(rate()).toBe('373')
  })

  it('shows without its chat/min when Busiest now leaves its stream out (a chat-only row has no average there; review 10-30)', () => {
    const chatOnly = { ...down, liveChannels: down.liveChannels.map((c) => (c.login === 'yuyuta0702' ? { ...c, coverageState: 'chat_only' } : c)) }
    expect(hubChatBasis(chatOnly.liveChannels, '24h')).toBe('avg_35')
    setHub({ data: chatOnly, loadSource: 'full', lastUpdated: NOW })
    render(page())
    expect(document.querySelector('#busiest li[data-login="yuyuta0702"]')).toBeNull()
    expect(document.querySelector('#busiest li[data-rank="1"]')).toBeTruthy()
    expect(section()!.querySelector('.hv5-mst-nm')!.textContent).toBe('ゆゆうた押忍')
    expect(rate()).toBeNull()
  })

  it('names no chat/min while a long-window answer is still up (review 10-30)', () => {
    // the 1-year answer still on screen while 24h loads: its averages are not recent, for Busiest now either
    setHub({ data: forWindow(365 * 24 * 60), loadSource: 'full', lastUpdated: NOW })
    const { rerender } = render(page())
    expect(section()).toBeTruthy()
    expect(rate()).toBeNull()
    expect(document.querySelector('#busiest')!.textContent).not.toMatch(/recent average/)
    // and names it once the 24h answer lands
    setHub({ data: down, loadSource: 'full', lastUpdated: NOW })
    rerender(page())
    expect(rate()).toBe('373')
  })

  it('stays through a failed later read, as Busiest now keeps its rows (review 10-30)', () => {
    // a failed or late poll keeps the old answer and loadSource 'full'; hiding only the card would move the page each poll
    for (const failed of [{ error: 'hub offline', hubEndpointOk: false }, { error: 'hub offline' }, { hubEndpointOk: false }]) {
      setHub({ data: down, loadSource: 'full', lastUpdated: NOW, ...failed })
      render(page())
      expect(document.querySelector('#busiest li[data-rank="1"]')!.getAttribute('data-login')).toBe('yuyuta0702')
      expect(rate()).toBe('373')
      cleanup()
    }
  })

  it('is hidden on a saved copy and on totals only, and shows on 7d without its chat/min', () => {
    setHub({ data: down, loadSource: 'cache', cachedAt: NOW - 60_000 })
    const { rerender } = render(page())
    expect(section()).toBeNull()

    // totals only, even if its data still carried an earlier answer's featured stream (review 10-30: an empty one
    // would hide the card whatever the page does)
    setHub({ data: { ...normalizePublicHub(null), generatedAt: down.generatedAt, featuredSession: down.featuredSession } as PublicHub, loadSource: 'stats-fallback' })
    rerender(page())
    expect(section()).toBeNull()

    cleanup()
    // a 7d answer for 7d: the backend's average there is not recent, and Busiest now keeps the 5-minute counts
    setHub({ data: forWindow(7 * 24 * 60), loadSource: 'full', lastUpdated: NOW })
    render(page('?window=7d'))
    expect(section()!.querySelector('.hv5-mst-nm')!.textContent).toBe('ゆゆうた押忍')
    expect(rate()).toBeNull()
    expect(document.querySelector('#busiest')!.textContent).not.toMatch(/recent average/)
  })

  it('holds its place exactly while Busiest now holds its own: first load, a saved copy or totals only being refreshed (pick K1, 10-30)', () => {
    const waits = () => [Boolean(document.querySelector('#busiest .hv5-bzs-wait')), Boolean(document.querySelector('.hv5-most.hv5-mst-wait'))]
    const states: [string, Record<string, unknown>, [boolean, boolean]][] = [
      ['first load', { data: null, loading: true }, [true, true]],
      ['saved copy, read under way', { data: down, loadSource: 'cache', cachedAt: NOW - 60_000, refreshing: true }, [true, true]],
      ['saved copy, read gave up', { data: down, loadSource: 'cache', cachedAt: NOW - 60_000 }, [false, false]],
      ['totals only, read pending', { data: normalizePublicHub(null), loadSource: 'stats-fallback', hubReadPending: true }, [true, true]],
      ['totals only, read gave up', { data: normalizePublicHub(null), loadSource: 'stats-fallback' }, [false, false]],
      ['nothing, read gave up', { data: null, error: 'hub offline' }, [false, false]],
    ]
    for (const [label, over, want] of states) {
      setHub(over)
      render(page())
      expect([label, ...waits()]).toEqual([label, ...want])
      cleanup()
    }
    // an answer: the card, or nothing when it has no featured stream
    setHub({ data: down, loadSource: 'full', lastUpdated: NOW })
    render(page())
    expect(waits()).toEqual([false, false])
    expect(section()!.querySelector('.hv5-mst-nm')!.textContent).toBe('ゆゆうた押忍')
    cleanup()
    setHub({ data: { ...down, featuredSession: { state: 'empty', reason: 'no_qualifying_session' } }, loadSource: 'full', lastUpdated: NOW })
    render(page())
    expect(section()).toBeNull()
  })
})
