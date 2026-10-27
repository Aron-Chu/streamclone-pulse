import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeApiError } from '../src/lib/apiClient'
import type { MomentsFeedCategoryFacet, MomentsFeedItem, MomentsFeedSnapshot, MomentsWindowQuery } from '../src/lib/momentsFeed'

const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/moments_feed_v1.json'), 'utf8')) as { generatedAt: number; items: MomentsFeedItem[] }
const NOW = fixture.generatedAt

const feed = vi.hoisted(() => ({ load: vi.fn(), vod: vi.fn() }))
vi.mock('../src/lib/momentsFeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/momentsFeed')>()),
  loadMomentsWindow: feed.load,
}))
vi.mock('../src/lib/momentsFeedVod', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/momentsFeedVod')>()), loadMomentVod: feed.vod }))

import { HubV5TopMoments } from '../src/ui/components/hub/v5/HubV5TopMoments'

/** The backend as the hub reads it: the window and game filter the moments and the total; the games facet lists every game. */
function answer(items: MomentsFeedItem[], q: MomentsWindowQuery): MomentsFeedSnapshot {
  const inWindow = items.filter((i) => i.minuteStart >= q.from)
  const mine = inWindow.filter((i) => !q.category || i.category?.id === q.category)
  const sorted = [...mine].sort(q.sort === 'top' ? (a, b) => b.score - a.score : (a, b) => b.minuteStart - a.minuteStart)
  const games = new Map<string, MomentsFeedCategoryFacet>()
  for (const i of inWindow) if (i.category) {
    const g = games.get(i.category.id) ?? { ...i.category, moments: 0, liveChannels: 0 }
    g.moments++
    games.set(i.category.id, g)
  }
  const n = (v: string) => mine.filter((i) => i.verdict === v).length
  return {
    items: sorted.slice(0, q.limit), generatedAt: NOW, stale: false, total: mine.length,
    verdicts: { ok: n('ok'), warn: n('warn'), bad: n('bad') },
    categories: [...games.values()].sort((a, b) => b.moments - a.moments), nextCursor: null,
  }
}
let items = fixture.items
const listReads = () => feed.load.mock.calls.map((c) => c[0] as MomentsWindowQuery).filter((q) => q.limit > 1)
const rows = () => [...document.querySelectorAll<HTMLElement>('.hv5-tm-list > .hv5-tm-it')]
const onGone = vi.fn()
const view = (at: string, up: () => React.ReactNode = () => null) => (
  <MemoryRouter><div className="hub-v5"><HubV5TopMoments at={at} nowMs={NOW} onGone={onGone} up={up} /></div></MemoryRouter>
)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  items = fixture.items
  feed.load.mockReset().mockImplementation((q: MomentsWindowQuery) => Promise.resolve(answer(items, q)))
  feed.vod.mockReset().mockResolvedValue(null)
  onGone.mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('hub Top moments', () => {
  it('opens on the top 20 of the last 24 hours, ranked, with every window counted', async () => {
    render(view('a'))
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    expect(screen.getByRole('heading', { name: 'Top moments' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /^the last 24 hours/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Top' }).getAttribute('aria-checked')).toBe('true')
    expect(listReads()[0]).toMatchObject({ sort: 'top', limit: 50, from: Math.floor((NOW - 24 * 3600_000) / 60_000) * 60_000 })
    expect(rows().length).toBeLessThanOrEqual(20)
    expect(rows()[0]!.querySelector('.hv5-tm-rk')?.textContent).toBe('1')
    const day = fixture.items.filter((i) => i.minuteStart >= NOW - 24 * 3600_000 && i.verdict !== 'bad').length
    await waitFor(() => expect(screen.getByRole('radio', { name: `the last 24 hours, ${day} moments` })).toBeTruthy())
    expect(document.querySelector('.hv5-tm-ft')?.textContent).toMatch(new RegExp(`^Top ${rows().length} of ${day} moments`))
  })

  it('opens a row under itself with Watch and Open in Moments, one row at a time', async () => {
    render(view('a'))
    await waitFor(() => expect(rows().length).toBeGreaterThan(1))
    const [first, second] = rows().map((li) => li.querySelector('button')!)
    fireEvent.click(first!)
    expect(first!.getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(screen.getByRole('link', { name: /Watch on Twitch/ })).toBeTruthy())
    const key = rows()[0]!.dataset.id!
    expect(screen.getByRole('link', { name: 'Open in Moments' }).getAttribute('href')).toBe(`/analytics/moments?m=${encodeURIComponent(key)}`)
    expect(document.getElementById(first!.getAttribute('aria-controls')!)).toBeTruthy()
    fireEvent.click(second!)
    expect(first!.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelectorAll('.hv5-tm-det')).toHaveLength(1)
    fireEvent.keyDown(second!, { key: 'Escape' })
    expect(document.querySelectorAll('.hv5-tm-det')).toHaveLength(0)
  })

  it('switches window, order and game with one read each', async () => {
    render(view('a'))
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('radio', { name: 'Latest' }))
    await waitFor(() => expect(listReads().at(-1)).toMatchObject({ sort: 'new' }))
    await waitFor(() => expect(rows()[0]!.querySelector('.hv5-tm-rk')).toBeNull())
    fireEvent.click(screen.getByRole('radio', { name: /^the last hour/ }))
    await waitFor(() => expect(listReads().at(-1)).toMatchObject({ sort: 'new', from: Math.floor((NOW - 3600_000) / 60_000) * 60_000 }))
    const chip = await screen.findByRole('button', { name: /^Overwatch, / })
    fireEvent.click(chip)
    await waitFor(() => expect(listReads().at(-1)?.category).toBe(fixture.items.find((i) => i.category?.name === 'Overwatch')!.category!.id))
    expect(screen.getByRole('link', { name: /Overwatch.*moments →/ }).getAttribute('href')).toMatch(/game=/)
  })

  it('offers the next window up when this one is quiet', async () => {
    render(view('a'))
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('radio', { name: /^the last hour/ }))
    const next = await screen.findByRole('button', { name: /^See 6 h/ })
    expect(document.querySelector('.hv5-tm-q')?.textContent).toMatch(/in the last hour\./)
    fireEvent.click(next)
    expect(screen.getByRole('radio', { name: /^the last 6 hours/ }).getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(listReads().at(-1)?.from).toBe(Math.floor((NOW - 6 * 3600_000) / 60_000) * 60_000))
    await act(async () => {})
  })

  it('keeps what a poll brings behind the pill while the pointer is in the list', async () => {
    const { rerender } = render(view('a'))
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const before = rows().map((li) => li.dataset.id)
    const wrap = document.querySelector('.hv5-tm-wrap')!
    fireEvent.pointerEnter(wrap, { pointerType: 'mouse' })
    const top = fixture.items.find((i) => i.id === before[0])!
    const fresh = { ...top, id: `${top.id}-new`, login: 'newcomer', streamId: 'new-stream', minuteStart: NOW - 60_000, score: top.score + 1 }
    items = [...fixture.items, fresh]
    rerender(view('b'))
    const pill = await screen.findByRole('button', { name: 'Show 1 new moment' })
    expect(rows().map((li) => li.dataset.id)).toEqual(before)
    fireEvent.click(pill)
    await waitFor(() => expect(rows()[0]!.dataset.id).toBe(fresh.id))
    expect(rows()[0]!.classList.contains('hv5-fd-new')).toBe(true)
  })

  it('shows Picking up on top and hands back to the Live feed on a 404', async () => {
    const up = vi.fn(() => <li data-kind="now">picking up</li>)
    const { unmount } = render(view('a', up))
    expect(screen.getByText('picking up')).toBeTruthy()
    expect(up).toHaveBeenCalledWith(null)
    unmount()
    feed.load.mockImplementation(() => Promise.reject(normalizeApiError(404, {})))
    render(view('c'))
    await waitFor(() => expect(onGone).toHaveBeenCalled())
  })

  it('keeps the last list when a read fails some other way', async () => {
    const { rerender } = render(view('a'))
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const before = rows().map((li) => li.dataset.id)
    feed.load.mockImplementation(() => Promise.reject(normalizeApiError(503, {})))
    await act(async () => { rerender(view('b')) })
    expect(rows().map((li) => li.dataset.id)).toEqual(before)
    expect(onGone).not.toHaveBeenCalled()
  })
})
