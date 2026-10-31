import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsMomentsPage from '../src/routes/analytics/AnalyticsMomentsPage'
import * as availabilityTransport from '../src/lib/discoveryAvailability'
import { normalizeApiError } from '../src/lib/apiClient'
import { clearRankedFeatureCheckForTests } from '../src/hooks/useRankedFeatureAvailability'
import type { MomentsFeedItem, MomentsFeedSnapshot } from '../src/lib/momentsFeed'
import { SAVED_MOMENTS_FULL, toggleSavedMoment } from '../src/lib/savedDiscoveryMoments'
import { recordViewed, VIEWED_DAYS, VIEWED_KEY, VIEWED_MAX } from '../src/lib/viewedMoments'
import Privacy from '../src/routes/public/Privacy'
import { fromHubMoment } from '../src/lib/discoveryMoments'
import { fx } from '../src/lib/momentsChecked'

const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/moments_feed_v1.json'), 'utf8')) as { generatedAt: number; items: MomentsFeedItem[] }

const feed = vi.hoisted(() => ({ load: vi.fn(), rest: vi.fn(), poll: vi.fn(), item: vi.fn(), vod: vi.fn(), minutes: vi.fn() }))
vi.mock('../src/lib/momentsFeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/momentsFeed')>()),
  loadMomentsFeed: feed.load, loadMomentsFeedRest: feed.rest, pollMomentsFeed: feed.poll, loadMomentsFeedItem: feed.item,
}))
vi.mock('../src/lib/momentsFeedVod', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/momentsFeedVod')>()), loadMomentVod: feed.vod }))
vi.mock('../src/lib/momentMinuteSeries', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/momentMinuteSeries')>()), loadMomentMinuteSeries: feed.minutes }))
vi.mock('../src/hooks/useMomentProfiles', () => ({ useMomentProfiles: (rows: unknown) => rows }))
vi.mock('../src/ui/components/analytics/AnalyticsFigmaShell', () => ({ AnalyticsFigmaShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
const { hub } = vi.hoisted(() => ({ hub: {
  data: { generatedAt: new Date().toISOString(), livePulseMoments: [] },
  loading: false, refreshing: false, error: null, loadSource: 'network', hubEndpointOk: true, refresh: () => {},
} }))
vi.mock('../src/hooks/usePublicHubData', () => ({ usePublicHubData: () => hub }))

const renderMoments = () => render(<MemoryRouter initialEntries={['/analytics/moments']}><AnalyticsMomentsPage /></MemoryRouter>)
const rows = () => [...document.querySelectorAll<HTMLElement>('.mk-list .mk-r')]
const snap = (items: MomentsFeedItem[], more: Partial<MomentsFeedSnapshot> = {}): MomentsFeedSnapshot =>
  ({ items, generatedAt: fixture.generatedAt, stale: false, total: fixture.items.length, verdicts: null, categories: null, nextCursor: null, ...more })
const opened = () => waitFor(() => {
  const el = document.querySelector<HTMLElement>('.mk-slot .mk-d')
  expect(el).toBeTruthy()
  return el!
})
const seg = (name: string) => within(screen.getByRole('group', { name: 'Which moments' })).getByRole('button', { name: new RegExp(`^${name}`) })
// Saved's switch between what you saved and what you opened here (M1, 10-22)
const sv = (name: string) => within(screen.getByRole('group', { name: 'Saved or opened' })).getByRole('button', { name: new RegExp(`^${name}`) })
const covers = () => screen.getByRole('list', { name: 'Games, busiest first' })
// Top's 24h · 6h · 1h switch (W1, 10-30)
const rng = (name: string) => within(screen.getByRole('group', { name: 'How far back' })).getByRole('button', { name })
// the page's clock just after the fixture's snapshot, so Top's last hours hold its moments
const atFixtureTime = () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(fixture.generatedAt + 90_000) }
// from 900 px the open moment sits beside the list
const wideScreen = () => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 900px)', media: query, onchange: null,
  addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }))
// a save made on master's page: who, when and what, nothing more
const plainSave = (item: MomentsFeedItem, label = item.label.text) =>
  toggleSavedMoment(fromHubMoment({ login: item.login, streamId: item.streamId, offsetSeconds: item.offsetSeconds, at: item.minuteStart, label })!)
// the save list reads this browser's lists again on a storage event, as when another tab saves (its saves outlive a test)
const reread = () => act(() => { window.dispatchEvent(new StorageEvent('storage', { key: null })) })
// a moment opened here earlier, kept under Viewed as its card
const plainCard = (item: MomentsFeedItem) => fromHubMoment({ login: item.login, streamId: item.streamId, offsetSeconds: item.offsetSeconds, at: item.minuteStart,
  label: item.label.text, displayName: item.displayName, category: item.category?.name, categoryId: item.category?.id })!
// what the page's live region last said
const spoken = () => document.querySelector('main.mk > .mk-vh[aria-live]')?.textContent

beforeEach(() => {
  vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockReturnValue(new Promise(() => {}))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  Element.prototype.scrollIntoView = () => {}
  window.localStorage.clear()
  window.history.replaceState(null, '', '/analytics/moments')
  feed.load.mockResolvedValue(snap(fixture.items))
  feed.rest.mockResolvedValue(true)
  feed.poll.mockReturnValue(new Promise(() => {}))
  feed.item.mockResolvedValue(null)
  feed.vod.mockResolvedValue(null)
  feed.minutes.mockResolvedValue(null)
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
  Object.values(feed).forEach(fn => fn.mockReset())
  clearRankedFeatureCheckForTests()
})

describe('Moments page flag', () => {
  it.each(['', 'off', 'true'])('is master’s page, with no feed read, while the flag is %j', (value) => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', value)
    renderMoments()
    expect(screen.getByRole('tab', { name: 'Latest' })).toBeTruthy()
    expect(document.querySelector('.mk')).toBeNull()
    expect(feed.load).not.toHaveBeenCalled()
  })

  it('is the checked page with the flag at 1, as at on', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '1')
    renderMoments()
    expect(await screen.findByRole('heading', { level: 1, name: 'Moments' })).toBeTruthy()
    // the read starts in an effect, which can run just after the lazy page's heading shows
    await waitFor(() => expect(feed.load).toHaveBeenCalledTimes(1))
  })

  it('falls back to master’s page when the feed is not there (backend flag off)', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', 'on')
    feed.load.mockRejectedValue(normalizeApiError(404, { error: 'not_found' }))
    renderMoments()
    expect(await screen.findByRole('tab', { name: 'Latest' })).toBeTruthy()
    expect(document.querySelector('.mk')).toBeNull()
    expect(feed.load).toHaveBeenCalledTimes(1)
  })

  it('says the feed couldn’t load on an outage, keeps the deep link, and tries again', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', 'on')
    const target = fixture.items.find(item => item.verdict === 'ok')!
    window.history.replaceState(null, '', `/analytics/moments?m=${target.id}`)
    feed.load.mockRejectedValueOnce(normalizeApiError(500, { error: 'internal' }))
    renderMoments()
    expect((await screen.findByRole('alert')).textContent).toBe('Moments couldn’t load.')
    expect(screen.queryByRole('tab', { name: 'Latest' })).toBeNull()
    expect(new URL(window.location.href).searchParams.get('m')).toBe(target.id)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(document.querySelector('.mk-d')?.getAttribute('data-key')).toBe(target.id))
    expect(feed.load).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('checked Moments page', () => {
  beforeEach(() => vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', 'on'))

  it('lists the latest moments that hold up, one row per stream, a picture each, under the games, with no tiers, filters or orders', async () => {
    renderMoments()
    expect(await screen.findByRole('heading', { level: 1, name: 'Moments' })).toBeTruthy()
    expect(screen.getByText('When a stream’s chat suddenly goes wild. Pick a game to start.')).toBeTruthy()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const shown = fixture.items.filter(item => item.verdict !== 'bad')
    expect(rows().length).toBe(new Set(shown.map(item => item.streamId)).size)
    expect(document.querySelectorAll('.mk-list > li.mk-g[data-vd="bad"]')).toHaveLength(0)
    // Latest is Live now, the live feed it is (N1, 10-30)
    expect(seg('Live').getAttribute('aria-pressed')).toBe('true')
    expect(within(screen.getByRole('group', { name: 'Which moments' })).getAllByRole('button').map(b => b.textContent)).toEqual(['Live', 'Top', 'Saved'])
    expect(screen.queryByRole('group', { name: 'How far back' })).toBeNull()
    // the games on top, "All games" first and picked (M1, 10-22)
    expect(within(covers()).getAllByRole('button')[0].getAttribute('aria-label')).toBe(`All games: ${fixture.items.filter(item => item.verdict !== 'bad').length} moments. Shows every game’s moments.`)
    expect(within(covers()).getAllByRole('button')[0].getAttribute('aria-pressed')).toBe('true')
    // a stream's earlier moments are in its open moment, not under its row (M1, 10-22)
    expect(document.querySelector('.mk-r-more')).toBeNull()
    // no "Live" word beside the tab of that name: the dot and, shown, how old the list is (Q2c, 10-31)
    expect(document.querySelector('.mk-fresh')?.textContent).toBe('updated just now')
    expect(document.querySelector('.mk-fresh .mk-vh')).toBeNull()
    expect(document.querySelector('.mk-fresh .mk-dot')).toBeTruthy()
    expect(document.querySelector('.mk-fresh')?.hasAttribute('title')).toBe(false)
    // B2 drops the verdict counts, Checked/All, the game and order selects, how we check, and the line under the list
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'How we check a moment' })).toBeNull()
    expect(document.querySelector('.mk-foot')).toBeNull()
    expect(screen.getByRole('button', { name: 'Replay the last hour' })).toBeTruthy()
    // every row has its picture, and no sparkline (M1, 10-22)
    expect(document.querySelectorAll('.mk-list > li.mk-g > .mk-r > .mk-r-th')).toHaveLength(rows().length)
    expect(document.querySelector('.mk-list svg')).toBeNull()
    // no per-row reads: the opened moment is the only one that reads its stream and minutes
    expect(feed.vod).not.toHaveBeenCalled()
    expect(feed.minutes).not.toHaveBeenCalled()
  })

  it('draws a row’s live frame while the stream is live, and the game’s art under the avatar once it isn’t', async () => {
    const live = fixture.items.find(item => item.streamLive && item.liveFrameUrl && item.verdict !== 'bad')!
    const ended = { ...fixture.items.find(item => item.verdict !== 'bad' && item.streamId !== live.streamId)!, streamLive: false }
    feed.load.mockResolvedValue(snap([live, ended]))
    renderMoments()
    await waitFor(() => expect(rows()).toHaveLength(2))
    const thumb = (key: string) => rows().find(r => r.dataset.key === key)!.querySelector('.mk-r-th')!
    expect(thumb(live.id).querySelector('img.mk-r-th-f')?.getAttribute('src')).toBe(live.liveFrameUrl)
    expect(thumb(ended.id).querySelector('img.mk-r-th-f')).toBeNull()
    expect(thumb(ended.id).querySelector('.mk-r-th-av, .mk-ini')).toBeTruthy()
    // a frame that fails falls back the same way
    fireEvent.error(thumb(live.id).querySelector('img.mk-r-th-f')!)
    expect(thumb(live.id).querySelector('img.mk-r-th-f')).toBeNull()
  })

  it('draws from the first page, then adds the later pages behind it', async () => {
    // as the feed pages with sort=new: the newest first, the older behind
    const newest = fixture.items.slice().sort((a, b) => b.minuteStart - a.minuteStart)
    const head = newest.slice(0, 12), tail = newest.slice(12)
    const headStreams = new Set(head.filter(item => item.verdict !== 'bad').map(item => item.streamId)).size
    let page2!: (page: MomentsFeedSnapshot, fresh: boolean) => void
    let done!: (ok: boolean) => void
    feed.load.mockResolvedValue(snap(head, { nextCursor: 'c2', verdicts: { ok: 20, warn: 6, bad: 14 } }))
    feed.rest.mockImplementation((_now: number, _cursor: string, onPage: typeof page2) => { page2 = onPage; return new Promise<boolean>(r => { done = r }) })
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    expect(feed.rest).toHaveBeenCalledTimes(1)
    expect(feed.rest.mock.calls[0][1]).toBe('c2')
    expect(rows()).toHaveLength(headStreams)
    const before = rows().length, keys = rows().map(r => r.dataset.key)
    act(() => page2(snap(tail, { nextCursor: null }), false))
    await waitFor(() => expect(rows().length).toBeGreaterThan(before))
    expect(rows().slice(0, before).map(r => r.dataset.key)).toEqual(keys) // the rows already drawn stay put
    // a later page that fails keeps what has loaded: no fallback to the old page
    await act(async () => done(false))
    await new Promise(r => setTimeout(r, 0))
    expect(document.querySelector('.mk')).toBeTruthy()
    expect(rows().length).toBeGreaterThan(before)
  })

  it('opens a moment under its row on a narrow screen, with one stream read and one minutes read', async () => {
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const first = rows()[0]
    fireEvent.click(first)
    const detail = await opened()
    expect(within(detail).getByRole('heading', { name: 'The minutes around it' })).toBeTruthy()
    expect(within(detail).getByRole('link', { name: 'Watch on Twitch' }).getAttribute('href')).toMatch(/^https:\/\/www\.twitch\.tv\//)
    expect(within(detail).queryByRole('heading', { name: 'This stream' })).toBeNull()
    await waitFor(() => expect(feed.minutes).toHaveBeenCalledTimes(1))
    expect(feed.vod).toHaveBeenCalledTimes(1)
    expect(new URL(window.location.href).searchParams.get('m')).toBe(first.dataset.key)
    expect(first.getAttribute('aria-current')).toBe('true')
    // a second click closes it (narrow)
    fireEvent.click(first)
    await waitFor(() => expect(document.querySelector('.mk-slot')).toBeNull())
    // opened again: the stream's VOD is known for the page's lifetime, so only the minutes are read again
    fireEvent.click(first)
    await opened()
    await waitFor(() => expect(feed.minutes).toHaveBeenCalledTimes(2))
    expect(feed.vod).toHaveBeenCalledTimes(1)
  })

  it('keeps a stream’s earlier moments in its open moment, under "More from this stream" (M1, 10-22)', async () => {
    const many = fixture.items.filter(item => item.verdict !== 'bad' && item.streamId === '318959837542').sort((a, b) => b.minuteStart - a.minuteStart)
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    // one row for the stream, its newest moment; the others are counted for a screen reader only
    const mine = () => rows().filter(r => many.some(item => item.id === r.dataset.key))
    expect(mine().map(r => r.dataset.key)).toEqual([many[0].id])
    expect(mine()[0].querySelector('.mk-r-hit')?.getAttribute('aria-label')).toMatch(new RegExp(` ${many.length - 1} earlier moments\\.$`))
    fireEvent.click(mine()[0])
    const detail = await opened()
    const sec = within(detail).getByRole('heading', { name: 'More from this stream' }).closest('section')!
    const more = within(sec).getAllByRole('button')
    expect(more).toHaveLength(many.length - 1)
    expect(more[1].querySelector('.mk-r-x')?.textContent).toMatch(/^\d+(\.\d)?× more (chat|emotes)$/)
    // opening one keeps the stream's row the current one, with that moment open under it
    fireEvent.click(more[1])
    await waitFor(() => expect(document.querySelector('.mk-slot .mk-d')?.getAttribute('data-key')).toBe(many[2].id))
    expect(new URL(window.location.href).searchParams.get('m')).toBe(many[2].id)
    expect(mine()[0].getAttribute('aria-current')).toBe('true')
  })

  it('shows 5 of a stream’s other moments until "Show all", which stays from one of its moments to the next (10-22)', async () => {
    const base = fixture.items.filter(item => item.verdict !== 'bad' && item.streamId === '318959837542').sort((a, b) => b.minuteStart - a.minuteStart)
    const oldest = base[base.length - 1]
    // three more of the stream's minutes, just after its oldest: 7 others in all
    const extra = [1, 2, 3].map(i => ({ ...oldest, id: `${oldest.id}-x${i}`, minuteStart: oldest.minuteStart + i * 60_000 }))
    const others = base.length - 1 + extra.length
    feed.load.mockResolvedValue(snap([...fixture.items, ...extra]))
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(rows().find(r => r.dataset.key === base[0].id)!)
    const detail = await opened()
    const listed = () => document.querySelectorAll<HTMLElement>('.mk-d-more button')
    expect(listed()).toHaveLength(5)
    const all = within(detail).getByRole('button', { name: `Show all ${others}` })
    expect(all.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(all)
    expect(listed()).toHaveLength(others)
    // one of them opened: its list is whole too, and "Show fewer" folds it back
    fireEvent.click(listed()[others - 1])
    await waitFor(() => expect(document.querySelector('.mk-slot .mk-d')?.getAttribute('data-key')).not.toBe(base[0].id))
    expect(listed()).toHaveLength(others)
    const fewer = screen.getByRole('button', { name: 'Show fewer' })
    expect(fewer.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(fewer)
    expect(listed()).toHaveLength(5)
  })

  it('opens a deep-linked earlier moment under its stream’s row', async () => {
    const many = fixture.items.filter(item => item.verdict !== 'bad' && item.streamId === '318959837542').sort((a, b) => b.minuteStart - a.minuteStart)
    window.history.replaceState(null, '', `/analytics/moments?m=${many[2].id}`)
    renderMoments()
    await waitFor(() => expect(document.querySelector('.mk-d')?.getAttribute('data-key')).toBe(many[2].id))
    expect(rows().find(r => r.dataset.key === many[0].id)?.getAttribute('aria-current')).toBe('true')
    expect(document.querySelectorAll('.mk-d-more button')).toHaveLength(many.length - 1)
  })

  it('ranks the moments that hold up and rose under Top, strongest first, one row a burst, with no replay (T1, 10-22)', async () => {
    const rose = fixture.items.filter(item => item.verdict === 'ok' && item.checks.rise?.code === 'rose' && item[item.label.kind].x != null)
    const lead = rose.slice().sort((a, b) => b.score - a.score)[0]
    // a weaker minute 2 minutes into the strongest burst
    const near = { ...lead, id: `${lead.id}-near`, minuteStart: lead.minuteStart + 2 * 60_000, score: lead.score - 1 }
    feed.load.mockResolvedValue(snap([...fixture.items, near]))
    atFixtureTime()
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(seg('Top'))
    expect(seg('Top').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Top moments in the last 24 hours, strongest first')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Replay the last hour' })).toBeNull()
    const byKey = new Map([...fixture.items, near].map(item => [item.id, item]))
    const shown = rows().map(r => byKey.get(r.dataset.key!)!)
    expect(shown[0].id).toBe(lead.id)
    expect(shown.map(item => item.id)).not.toContain(near.id)
    expect(shown.every(item => rose.includes(item))).toBe(true)
    expect(shown.map(item => item.score)).toEqual(shown.map(item => item.score).sort((a, b) => b - a))
    // a stream can have several rows here, each its own
    expect(new Set(shown.map(item => item.streamId)).size).toBeLessThan(shown.length)
    expect(document.querySelector('.mk-r-more')).toBeNull()
    // Live is in time order again
    fireEvent.click(seg('Live'))
    expect(document.querySelector('.mk-cap')).toBeNull()
    expect(screen.getByRole('button', { name: 'Replay the last hour' })).toBeTruthy()
  })

  it('keeps Top to the last 24, 6 or 1 hours of what the page holds, with no read, the line over it following (W1, 10-30)', async () => {
    atFixtureTime()
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(seg('Top'))
    const ages = () => rows().map(r => (fixture.generatedAt + 90_000 - fixture.items.find(item => item.id === r.dataset.key)!.minuteStart) / 3_600_000)
    expect(rng('24h').getAttribute('aria-pressed')).toBe('true')
    expect(within(screen.getByRole('group', { name: 'How far back' })).getAllByRole('button').map(b => b.textContent)).toEqual(['24h', '6h', '1h'])
    const day = rows().length
    expect(Math.max(...ages())).toBeGreaterThan(6)
    fireEvent.click(rng('6h'))
    expect(screen.getByText('Top moments in the last 6 hours, strongest first')).toBeTruthy()
    expect(rows().length).toBeLessThan(day)
    expect(Math.max(...ages())).toBeLessThan(6)
    fireEvent.click(rng('1h'))
    expect(rng('1h').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Top moments in the last hour, strongest first')).toBeTruthy()
    expect(rows().length).toBeGreaterThan(0)
    expect(Math.max(...ages())).toBeLessThan(1)
    // the switch filters what the page already holds: the first read and nothing more
    expect(feed.load).toHaveBeenCalledTimes(1)
    expect(feed.rest).not.toHaveBeenCalled()
    expect(feed.item).not.toHaveBeenCalled()
    expect(feed.poll).not.toHaveBeenCalled()
    // only Top has it
    fireEvent.click(seg('Live'))
    expect(screen.queryByRole('group', { name: 'How far back' })).toBeNull()
  })

  it('says Top has nothing in the hours picked, with no game or search, not "No moments match." (W1, 10-30)', async () => {
    atFixtureTime()
    const now = fixture.generatedAt + 90_000
    feed.load.mockResolvedValue(snap(fixture.items.filter(item => now - item.minuteStart > 3_600_000)))
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(seg('Top'))
    expect(rows().length).toBeGreaterThan(0)
    fireEvent.click(rng('1h'))
    expect(rows()).toHaveLength(0)
    expect(document.querySelector('.mk-empty')?.textContent).toBe('No top moments in the last hour.')
  })

  it('keeps the open moment under Top as it ages past the hours picked (W1, 10-30)', async () => {
    // the page's clock ticks every 10 s
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    const t0 = fixture.generatedAt + 90_000
    vi.setSystemTime(t0)
    const rose = fixture.items.find(item => item.verdict === 'ok' && item.checks.rise?.code === 'rose' && item[item.label.kind].x != null)!
    const aging = { ...rose, minuteStart: t0 - 59 * 60_000 } // in the last hour for a minute more
    feed.load.mockResolvedValue(snap([aging]))
    renderMoments()
    await waitFor(() => expect(rows()).toHaveLength(1))
    fireEvent.click(seg('Top'))
    fireEvent.click(rng('1h'))
    fireEvent.click(rows()[0])
    await opened()
    expect(new URL(window.location.href).searchParams.get('m')).toBe(aging.id)
    // two minutes on, past the hour: it stays open
    act(() => { vi.setSystemTime(t0 + 2 * 60_000); vi.advanceTimersByTime(10_000) })
    expect(document.querySelector('.mk-slot .mk-d')?.getAttribute('data-key')).toBe(aging.id)
    expect(new URL(window.location.href).searchParams.get('m')).toBe(aging.id)
  })

  it('opens Live from an old ?view=latest link (N1, 10-30)', async () => {
    window.history.replaceState(null, '', '/analytics/moments?view=latest')
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    expect(seg('Live').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Replay the last hour' })).toBeTruthy()
    cleanup()
    window.history.replaceState(null, '', '/analytics/moments?view=top')
    renderMoments()
    await waitFor(() => expect(seg('Top').getAttribute('aria-pressed')).toBe('true'))
  })

  it('on a wide screen opens nothing by itself: the side panel says "Pick a moment." and reads nothing until a click (A1, 10-30)', async () => {
    wideScreen()
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const aside = screen.getByRole('complementary', { name: 'Selected moment' })
    expect(aside.textContent).toBe('Pick a moment.')
    expect(document.querySelector('.mk-d')).toBeNull()
    expect(rows().some(r => r.getAttribute('aria-current') === 'true')).toBe(false)
    expect(new URL(window.location.href).searchParams.get('m')).toBeNull()
    await new Promise(r => setTimeout(r, 300))
    expect(feed.vod).not.toHaveBeenCalled()
    expect(feed.minutes).not.toHaveBeenCalled()
    const second = rows()[1]
    fireEvent.click(second)
    await waitFor(() => expect(aside.querySelector('.mk-d')?.getAttribute('data-key')).toBe(second.dataset.key))
    expect(aside.textContent).not.toContain('Pick a moment.')
    expect(document.querySelector('.mk-slot')).toBeNull()
    await waitFor(() => expect(feed.minutes).toHaveBeenCalledTimes(1))
    // opened by a click: it counts under Viewed
    fireEvent.click(seg('Saved'))
    expect(sv('Viewed').textContent).toBe('Viewed (1)')
  })

  it('closes the open moment with Esc on a wide screen too: back to "Pick a moment.", out of the link, focus on its row (Q4b, 10-31)', async () => {
    wideScreen()
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(1))
    const aside = screen.getByRole('complementary', { name: 'Selected moment' })
    const key = rows()[1].dataset.key!
    const row = () => rows().find(r => r.dataset.key === key)!
    fireEvent.click(row())
    await waitFor(() => expect(aside.querySelector('.mk-d')?.getAttribute('data-key')).toBe(key))
    expect(new URL(window.location.href).searchParams.get('m')).toBe(key)
    // Esc while typing a search leaves it open
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(aside.querySelector('.mk-d')).toBeTruthy()
    fireEvent.keyDown(aside.querySelector('.mk-d')!, { key: 'Escape' })
    await waitFor(() => expect(aside.textContent).toBe('Pick a moment.'))
    expect(new URL(window.location.href).searchParams.get('m')).toBeNull()
    expect(row().getAttribute('aria-current')).toBe('false')
    expect(document.activeElement).toBe(row().querySelector('.mk-r-hit'))
  })

  it('on Esc, puts focus on the stream’s row when the closed moment was listed only while open (Q4b, 10-31)', async () => {
    wideScreen()
    const bad = fixture.items.find(item => item.verdict === 'bad' && fixture.items.some(o => o.streamId === item.streamId && o.verdict !== 'bad'))!
    window.history.replaceState(null, '', `/analytics/moments?m=${bad.id}`)
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const aside = screen.getByRole('complementary', { name: 'Selected moment' })
    await waitFor(() => expect(aside.querySelector('.mk-d')?.getAttribute('data-key')).toBe(bad.id))
    const sid = rows().find(r => r.dataset.key === bad.id)!.closest<HTMLElement>('li.mk-g')!.dataset.sid
    const save = within(aside).getByRole('button', { name: 'Save' })
    save.focus()
    fireEvent.keyDown(save, { key: 'Escape' })
    await waitFor(() => expect(aside.textContent).toBe('Pick a moment.'))
    // its row left with it (a moment that didn't hold up shows only while open): the stream's row has focus, not <body>
    expect(rows().some(r => r.dataset.key === bad.id)).toBe(false)
    const li = [...document.querySelectorAll<HTMLElement>('li.mk-g')].find(el => el.dataset.sid === sid)!
    expect(li.contains(document.activeElement)).toBe(true)
    expect(document.activeElement?.classList.contains('mk-r-hit')).toBe(true)
  })

  it('on Esc under Top, puts focus on the stream’s other row; with none, leaves it on the control it was on, else gives it to the page (Q4b, 10-31)', async () => {
    wideScreen()
    const t0 = fixture.generatedAt + 90_000
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(t0)
    const rose = fixture.items.filter(item => item.verdict === 'ok' && item.checks.rise?.code === 'rose' && item[item.label.kind].x != null)
    const other = rose.find(item => item.streamId !== rose[0].streamId)!
    // one stream with a moment 3 hours old and one 20 minutes old; another stream with one 2 hours old
    const old = { ...rose[0], id: `${rose[0].id}-old`, minuteStart: t0 - 3 * 3_600_000 }
    const fresh = { ...rose[0], id: `${rose[0].id}-new`, minuteStart: t0 - 20 * 60_000 }
    const lone = { ...other, id: `${other.id}-lone`, minuteStart: t0 - 2 * 3_600_000 }
    feed.load.mockResolvedValue(snap([old, fresh, lone]))
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(seg('Top'))
    await waitFor(() => expect(rows().map(r => r.dataset.key).sort()).toEqual([old.id, fresh.id, lone.id].sort()))
    const aside = screen.getByRole('complementary', { name: 'Selected moment' })
    const row = (id: string) => rows().find(r => r.dataset.key === id)
    // the 3-hour-old one stays listed under 1h while it is open
    fireEvent.click(row(old.id)!)
    await waitFor(() => expect(aside.querySelector('.mk-d')?.getAttribute('data-key')).toBe(old.id))
    fireEvent.click(rng('1h'))
    expect(row(old.id)).toBeTruthy()
    const save = within(aside).getByRole('button', { name: 'Save' })
    save.focus()
    fireEvent.keyDown(save, { key: 'Escape' })
    await waitFor(() => expect(aside.textContent).toBe('Pick a moment.'))
    expect(row(old.id)).toBeUndefined()
    expect(document.activeElement).toBe(row(fresh.id)!.querySelector('.mk-r-hit'))
    // its stream has no other row in the last hour: focus stays on the 1h button, not the page
    fireEvent.click(rng('24h'))
    fireEvent.click(row(lone.id)!)
    await waitFor(() => expect(aside.querySelector('.mk-d')?.getAttribute('data-key')).toBe(lone.id))
    fireEvent.click(rng('1h'))
    rng('1h').focus()
    fireEvent.keyDown(rng('1h'), { key: 'Escape' })
    await waitFor(() => expect(aside.textContent).toBe('Pick a moment.'))
    expect(row(lone.id)).toBeUndefined()
    expect(document.activeElement).toBe(rng('1h'))
    // the same, with focus in the moment that closed: the page takes it, not <body>
    fireEvent.click(rng('24h'))
    fireEvent.click(row(lone.id)!)
    await waitFor(() => expect(aside.querySelector('.mk-d')?.getAttribute('data-key')).toBe(lone.id))
    fireEvent.click(rng('1h'))
    const inside = within(aside).getByRole('button', { name: 'Save' })
    inside.focus()
    fireEvent.keyDown(inside, { key: 'Escape' })
    await waitFor(() => expect(aside.textContent).toBe('Pick a moment.'))
    expect(document.activeElement).toBe(document.querySelector('main#analytics-main'))
  })

  it('opens a deep-linked moment beside the list on a wide screen', async () => {
    wideScreen()
    const target = fixture.items.filter(item => item.verdict === 'ok')[3]
    window.history.replaceState(null, '', `/analytics/moments?m=${target.id}`)
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const aside = screen.getByRole('complementary', { name: 'Selected moment' })
    await waitFor(() => expect(aside.querySelector('.mk-d')?.getAttribute('data-key')).toBe(target.id))
    expect(aside.textContent).not.toContain('Pick a moment.')
  })

  it('reads nothing for a moment passed over quickly', async () => {
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(1))
    const [a, b] = rows()
    fireEvent.click(a)
    fireEvent.click(b)
    await opened()
    await waitFor(() => expect(feed.minutes).toHaveBeenCalledTimes(1))
    await new Promise(r => setTimeout(r, 300))
    expect(feed.vod).toHaveBeenCalledTimes(1)
    expect(feed.minutes).toHaveBeenCalledTimes(1)
    expect(feed.vod.mock.calls[0][0].id).toBe(b.dataset.key)
  })

  it('says why a moment counts behind its ×’s (i), and Esc closes that before the moment', async () => {
    const ok = fixture.items.find(item => item.verdict === 'ok' && item.checks.rise?.code === 'rose' && item[item.label.kind].x != null)!
    feed.load.mockResolvedValue(snap([ok]))
    renderMoments()
    await waitFor(() => expect(rows()).toHaveLength(1))
    fireEvent.click(rows()[0])
    const detail = await opened()
    const chip = within(detail).getByRole('button', { name: 'Holds up: why it counts' })
    // a moment that holds up has no verdict chip: the × line’s (i) says why (C1, 10-22)
    expect(chip.closest('.mk-d-mx')).toBeTruthy()
    expect(detail.querySelector('.mk-hold')).toBeNull()
    expect(chip.getAttribute('aria-expanded')).toBe('false')
    expect(within(detail).queryByRole('heading', { name: 'Why it counts' })).toBeNull()
    fireEvent.click(chip)
    expect(chip.getAttribute('aria-expanded')).toBe('true')
    const pop = document.getElementById(chip.getAttribute('aria-controls')!)!
    expect(within(pop).getByRole('heading', { name: 'Why it counts' })).toBeTruthy()
    expect(within(pop).getAllByRole('listitem').length).toBeGreaterThanOrEqual(2)
    // the open moment's × is its first line, in the rows' words (C1, 10-22); when, how far in and the game the second
    expect(detail.querySelector('.mk-d-meta > .mk-d-mx')?.textContent).toBe(`${fx(ok[ok.label.kind].x!)} more ${ok.label.kind === 'chat' ? 'chat' : 'emotes'} than the 15 minutes before`)
    expect(detail.querySelector('.mk-d-meta > .mk-d-m2')?.textContent).toMatch(/\d in( · |$)/)
    expect(detail.textContent).not.toMatch(/into the stream|in the VOD|What chat sent at/)
    // and so does the row's: "8.7× more emotes" (M1, 10-22)
    expect(rows()[0].querySelector('.mk-r-x')?.textContent).toBe(`${fx(ok[ok.label.kind].x!)} more ${ok.label.kind === 'chat' ? 'chat' : 'emotes'}`)
    // Watch on Twitch, Save and Copy link sit under the verdict, above the minutes (A1, 10-22)
    const acts = detail.querySelector('.mk-d-acts')!
    expect(acts.previousElementSibling?.classList.contains('mk-d-head')).toBe(true)
    expect(acts.nextElementSibling?.classList.contains('mk-ch')).toBe(true)
    expect(within(acts as HTMLElement).getAllByRole('link').concat(within(acts as HTMLElement).getAllByRole('button')).map(b => b.textContent)).toEqual(['Watch on Twitch', 'Save', 'Copy link'])
    fireEvent.keyDown(chip, { key: 'Escape' })
    expect(chip.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('.mk-slot .mk-d')).toBeTruthy() // the moment stays open
    // a second click closes it too, and so does a press outside it
    fireEvent.click(chip)
    fireEvent.click(chip)
    expect(chip.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(chip)
    fireEvent.pointerDown(document.body)
    expect(chip.getAttribute('aria-expanded')).toBe('false')
  })

  it('words the chip with the moment’s own verdict when it only partly holds up', async () => {
    const warn = fixture.items.find(item => item.verdict === 'warn')!
    feed.load.mockResolvedValue(snap([warn]))
    renderMoments()
    await waitFor(() => expect(rows()).toHaveLength(1))
    fireEvent.click(rows()[0])
    const detail = await opened()
    expect(within(detail).getByRole('button', { name: 'Partly: why it counts' }).classList.contains('mk-hold')).toBe(true)
    expect(detail.querySelector('.mk-d-why')).toBeNull()
  })

  it('opens the stream’s page from the name and that game’s moments from the game (C1, 10-22)', async () => {
    const ok = fixture.items.find(item => item.verdict === 'ok' && item.category && /^\d+$/.test(item.streamId))!
    feed.load.mockResolvedValue(snap(fixture.items))
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(rows().find(r => r.dataset.key === ok.id) ?? rows()[0])
    const detail = await opened()
    const open = fixture.items.find(item => item.id === detail.getAttribute('data-key'))!
    const href = detail.querySelector('a.mk-d-nm')!.getAttribute('href')!
    expect(href.startsWith(`/analytics/${open.login.toLowerCase()}/${open.streamId}?returnTo=`)).toBe(true)
    expect(new URLSearchParams(href.split('?')[1].split('#')[0]).get('returnTo')).toBe(`/analytics/moments?m=${open.id}`)
    expect(href.endsWith(`#t=${Math.floor(open.offsetSeconds)}`)).toBe(true)
    // nothing under the chart until a minute is pointed at or held: it only said the head's line again
    expect(detail.querySelector('.mk-d-read')).toBeNull()
    const cat = open.category!
    fireEvent.click(within(detail).getByRole('button', { name: `Show ${cat.name} moments` }))
    expect(new URL(window.location.href).searchParams.get('game')).toBe(cat.id)
    await waitFor(() => expect(within(covers()).getAllByRole('button').find(b => b.getAttribute('aria-pressed') === 'true')?.textContent).toContain(cat.name))
    // the moment stays open, and its game is no longer a button: it's the one picked
    const still = document.querySelector<HTMLElement>('.mk-slot .mk-d')!
    expect(still.getAttribute('data-key')).toBe(open.id)
    expect(within(still).queryByRole('button', { name: `Show ${cat.name} moments` })).toBeNull()
    expect(still.querySelector('.mk-d-m2 .mk-d-gm')?.textContent).toBe(cat.name)
  })

  it('opens a deep-linked moment that didn’t hold up in Live, worded as such', async () => {
    const bad = fixture.items.find(item => item.verdict === 'bad')!
    window.history.replaceState(null, '', `/analytics/moments?m=${bad.id}`)
    renderMoments()
    await waitFor(() => expect(document.querySelector('.mk-d')).toBeTruthy())
    const detail = document.querySelector<HTMLElement>('.mk-d')!
    expect(detail.getAttribute('data-key')).toBe(bad.id)
    expect(seg('Live').getAttribute('aria-pressed')).toBe('true')
    expect(rows().some(r => r.dataset.key === bad.id)).toBe(true)
    fireEvent.click(within(detail).getByRole('button', { name: 'Doesn’t hold up: why it doesn’t count' }))
    expect(within(detail).getByRole('heading', { name: 'Why it doesn’t count' })).toBeTruthy()
  })

  it('says so in one line, with the stream’s page, when a deep-linked moment is gone', async () => {
    window.history.replaceState(null, '', '/analytics/moments?m=pulse-somestreamer-123456-930')
    renderMoments()
    const line = await screen.findByRole('status')
    expect(line.textContent).toBe('That moment is no longer here. Open it on the stream’s page')
    expect(within(line).getByRole('link').getAttribute('href')).toBe('/analytics/somestreamer/123456?returnTo=%2Fanalytics%2Fmoments#t=930')
    expect(feed.item).toHaveBeenCalledWith('pulse-somestreamer-123456-930', expect.anything())
    expect(document.querySelector('.mk-d')).toBeNull()
    expect(feed.vod).not.toHaveBeenCalled()
    expect(feed.minutes).not.toHaveBeenCalled()
  })

  it('keeps a saved moment in Saved after a reload', async () => {
    const { unmount } = renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(rows()[0])
    const save = await screen.findByRole('button', { name: 'Save' })
    fireEvent.click(save)
    expect(within(document.querySelector<HTMLElement>('.mk-d')!).getByRole('button', { name: 'Saved' }).getAttribute('aria-pressed')).toBe('true')
    unmount()
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(seg('Saved'))
    expect(sv('Saved').textContent).toBe('Saved (1)')
    expect(rows()).toHaveLength(1)
  })

  it('keeps a save in the site’s one list, with the card its row draws from, and no second list (V1, 10-30)', async () => {
    const rose = fixture.items.find(item => item.verdict === 'ok' && item.checks.rise?.code === 'rose' && item[item.label.kind].x != null && item.category)!
    feed.load.mockResolvedValue(snap([rose]))
    const { unmount } = renderMoments()
    await waitFor(() => expect(rows()).toHaveLength(1))
    reread()
    fireEvent.click(rows()[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    const [card] = JSON.parse(window.localStorage.getItem('streampulse.saved-moments.v2')!).items
    expect(card).toMatchObject({ login: rose.login, streamId: rose.streamId, offsetSeconds: rose.offsetSeconds, at: rose.minuteStart,
      displayName: rose.displayName, category: rose.category!.name, categoryId: rose.category!.id, multiplier: rose[rose.label.kind].x,
      reactionSignal: rose.label.kind })
    // just what its row draws, as Viewed keeps: no rates or top emotes
    for (const field of ['chatPerMin', 'emotesPerMin', 'measurementScope', 'topEmotes']) expect(card).not.toHaveProperty(field)
    expect(JSON.stringify(card)).not.toMatch(/imageUrl|liveFrameUrl|profileImageUrl|spark/)
    expect(window.localStorage.getItem('sp-moments-checked-saved')).toBeNull()
    unmount()
    // the moment has left the feed: its row is drawn from the card, with no read
    feed.load.mockResolvedValue(snap(fixture.items.filter(item => item.streamId !== rose.streamId)))
    window.history.replaceState(null, '', '/analytics/moments')
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(seg('Saved'))
    expect(sv('Saved').textContent).toBe('Saved (1)')
    const [row] = rows()
    expect(row.classList.contains('mk-r-gone')).toBe(true)
    expect(row.querySelector('.mk-r-x')?.textContent).toBe(`${fx(rose[rose.label.kind].x!)} more ${rose.label.kind === 'chat' ? 'chat' : 'emotes'}`)
    expect(row.querySelector('.mk-r-g')?.textContent).toBe(rose.category!.name)
    // the game last, its dot left out on phones with it, as a full row's is (s-g)
    const l2 = row.querySelector('.mk-r-l2')!
    expect(l2.lastElementChild?.classList.contains('mk-r-g')).toBe(true)
    expect(l2.lastElementChild?.previousElementSibling?.className).toBe('mk-sep s-g')
    expect([...l2.querySelectorAll('.mk-sep')].filter(s => s.classList.contains('s-g'))).toHaveLength(1)
    // its list item is keyed for the slide-in like every row's
    expect(row.closest('li')?.dataset.sid).toBe(row.dataset.key)
    // and it stays in its game's list
    cleanup()
    window.history.replaceState(null, '', `/analytics/moments?view=saved&game=${rose.category!.id}`)
    renderMoments()
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(rows()[0].classList.contains('mk-r-gone')).toBe(true)
    expect(feed.item).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('sp-moments-checked-saved')).toBeNull()
  })

  it('draws a save from master’s page, or an older one, from what it kept, with no lookup: a full row while the page holds it', async () => {
    const held = fixture.items.find(item => item.verdict === 'ok')!
    const old = fixture.items.find(item => item.verdict === 'ok' && item.streamId !== held.streamId)!
    feed.load.mockResolvedValue(snap(fixture.items.filter(item => item.streamId !== old.streamId)))
    plainSave(held)
    plainSave(old, 'spammed PJSalt')
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(seg('Saved'))
    expect(sv('Saved').textContent).toBe('Saved (2)')
    const [full, gone] = rows()
    expect(full.dataset.key).toBe(held.id)
    expect(full.classList.contains('mk-r-gone')).toBe(false)
    expect(gone.classList.contains('mk-r-gone')).toBe(true)
    expect(gone.querySelector('.mk-r-em')?.textContent).toBe('PJSalt')
    expect(gone.querySelector('.mk-r-x')).toBeNull()
    expect(within(gone).getByText('Gone from the feed')).toBeTruthy()
    expect(within(gone).getByRole('link', { name: 'Open it on the stream’s page' }).getAttribute('href'))
      .toBe(`/analytics/${old.login}/${old.streamId}?returnTo=%2Fanalytics%2Fmoments#t=${old.offsetSeconds}`)
    expect(feed.item).not.toHaveBeenCalled()
  })

  it('reads a save list kept before the cards (v1), and says saves stay in this browser', async () => {
    const held = fixture.items.find(item => item.verdict === 'ok')!
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(seg('Saved'))
    reread()
    expect(sv('Saved').textContent).toBe('Saved (0)')
    expect(screen.getByText('Nothing saved yet. Save a moment and it stays here, in this browser.')).toBeTruthy()
    window.localStorage.setItem('streampulse.saved-moments.v1', JSON.stringify({ version: 1, items: [{ login: held.login, streamId: held.streamId,
      offsetSeconds: held.offsetSeconds, at: held.minuteStart, label: held.label.text, savedAt: fixture.generatedAt }] }))
    reread()
    expect(sv('Saved').textContent).toBe('Saved (1)')
    expect(rows().map(r => r.dataset.key)).toEqual([held.id])
    expect(feed.item).not.toHaveBeenCalled()
  })

  it('says why when the save list is full (200), and leaves the moment unsaved', async () => {
    const full = Array.from({ length: 200 }, (_, i) => ({ login: 'fullstreamer', streamId: '900000001', offsetSeconds: i * 60, label: 'PJSalt', savedAt: fixture.generatedAt }))
    window.localStorage.setItem('streampulse.saved-moments.v2', JSON.stringify({ version: 2, legacyMerged: true, items: full }))
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    reread()
    fireEvent.click(rows()[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    await waitFor(() => expect(spoken()).toBe('200 saved moments reached. Remove a saved moment before adding another.'))
    expect(within(document.querySelector<HTMLElement>('.mk-d')!).getByRole('button', { name: 'Save' }).getAttribute('aria-pressed')).toBe('false')
    expect(JSON.parse(window.localStorage.getItem('streampulse.saved-moments.v2')!).items).toHaveLength(200)
  })

  it('removes a save the page doesn’t hold from its row, and focus moves to the next Remove, then to Saved (Q3b, 10-31)', async () => {
    const ok = fixture.items.filter(item => item.verdict === 'ok')
    const held = ok[0]
    const a = ok.find(item => item.streamId !== held.streamId)!
    const b = ok.find(item => item.streamId !== held.streamId && item.streamId !== a.streamId)!
    feed.load.mockResolvedValue(snap(fixture.items.filter(item => item.streamId !== a.streamId && item.streamId !== b.streamId)))
    plainSave(held)
    plainSave(a)
    plainSave(b)
    recordViewed(a.id, plainCard(a))
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(seg('Saved'))
    expect(sv('Saved').textContent).toBe('Saved (3)')
    // a save the page holds is unsaved from its open moment; only the rows drawn from a card have Remove
    expect(rows()[0].dataset.key).toBe(held.id)
    expect(rows()[0].querySelector('.mk-r-rm')).toBeNull()
    const gone = rows().filter(r => r.classList.contains('mk-r-gone'))
    expect(gone).toHaveLength(2)
    const next = gone[1].dataset.key
    fireEvent.click(within(gone[0]).getByRole('button', { name: /^Remove .+, from Saved$/ }))
    expect(sv('Saved').textContent).toBe('Saved (2)')
    await waitFor(() => expect(spoken()).toBe('Removed from Saved'))
    expect(document.activeElement).toBe(rows().find(r => r.dataset.key === next)!.querySelector('.mk-r-rm'))
    fireEvent.click(document.activeElement as HTMLElement)
    expect(sv('Saved').textContent).toBe('Saved (1)')
    expect(document.activeElement).toBe(sv('Saved'))
    expect(JSON.parse(window.localStorage.getItem('streampulse.saved-moments.v2')!).items).toHaveLength(1)
    // Viewed's rows drawn from a card have no Remove: Clear empties Viewed
    fireEvent.click(sv('Viewed'))
    expect(rows().filter(r => r.classList.contains('mk-r-gone'))).toHaveLength(1)
    expect(document.querySelector('.mk-r-rm')).toBeNull()
  })

  it('says the save list is full: under the Save it refused, and under Saved while full, one line at a time, until one is removed (Q3b, 10-31)', async () => {
    const full = Array.from({ length: 200 }, (_, i) => ({ login: 'fullstreamer', streamId: '900000001', offsetSeconds: i * 60, label: 'PJSalt', savedAt: fixture.generatedAt }))
    window.localStorage.setItem('streampulse.saved-moments.v2', JSON.stringify({ version: 2, legacyMerged: true, items: full }))
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    reread()
    const notes = () => [...document.querySelectorAll('.mk-note')].map(n => n.textContent)
    // Live: nothing refused yet
    expect(notes()).toEqual([])
    fireEvent.click(rows()[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    // under that Save, where the eye is, also scrolled far down the list
    expect(notes()).toEqual([SAVED_MOMENTS_FULL])
    expect(document.querySelector('.mk-d .mk-d-acts + .mk-note')?.textContent).toBe(SAVED_MOMENTS_FULL)
    await waitFor(() => expect(spoken()).toBe(SAVED_MOMENTS_FULL))
    // another moment's Save wasn't refused
    fireEvent.click(rows()[1])
    await waitFor(() => expect(document.querySelector('.mk-d')?.getAttribute('data-key')).toBe(rows()[1].dataset.key))
    expect(notes()).toEqual([])
    // Saved, while full: the one line above its rows
    fireEvent.click(seg('Saved'))
    expect(notes()).toEqual([SAVED_MOMENTS_FULL])
    expect(document.querySelector('.mk-d .mk-note')).toBeNull()
    fireEvent.click(within(rows().find(r => r.classList.contains('mk-r-gone'))!).getByRole('button', { name: /^Remove / }))
    expect(sv('Saved').textContent).toBe('Saved (199)')
    expect(notes()).toEqual([])
  })

  it('keeps a storage warning on the line when the full limit joins it, so a Remove that won’t last is never a surprise (Q3b, 10-31)', async () => {
    const full = Array.from({ length: 200 }, (_, i) => ({ login: 'fullstreamer', streamId: '900000001', offsetSeconds: i * 60, label: 'PJSalt', savedAt: fixture.generatedAt }))
    // no legacyMerged mark, and an older list that can't be read: changes are for this session only
    window.localStorage.setItem('streampulse.saved-moments.v2', JSON.stringify({ version: 2, items: full }))
    window.localStorage.setItem('streampulse.saved-moments.v1', 'broken')
    // a fresh save list and page, so its session-only state stays out of the other tests
    vi.resetModules()
    const { default: FreshPage } = await import('../src/ui/components/moments/checked/MomentsCheckedPage')
    render(<MemoryRouter initialEntries={['/analytics/moments']}><FreshPage fallback={null} /></MemoryRouter>)
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(seg('Saved'))
    const lines = [...document.querySelectorAll('.mk-note')].map(n => n.textContent)
    expect(lines).toEqual(['An older saved list could not be read. Current saves remain visible; changes are available for this session only; stored data was not overwritten. '
      + SAVED_MOMENTS_FULL])
  })

  it('drops Viewed entries past 30 days from this browser when the page opens, as Privacy says (Q6b, 10-31)', async () => {
    const item = fixture.items.find(entry => entry.verdict === 'ok')!
    recordViewed(item.id, plainCard(item))
    const kept = JSON.parse(window.localStorage.getItem(VIEWED_KEY)!)
    window.localStorage.setItem(VIEWED_KEY, JSON.stringify([...kept, { ...kept[0], id: 'old', at: Date.now() - (VIEWED_DAYS + 1) * 86_400_000 }]))
    renderMoments()
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(VIEWED_KEY)!).map((e: { id: string }) => e.id)).toEqual([item.id]))
    cleanup()
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    const text = screen.getByTestId('privacy-policy').textContent!.replace(/\s+/g, ' ')
    expect(text).toContain(`Viewed list (${VIEWED_KEY}: the moments you opened there, at most ${VIEWED_MAX},`)
    expect(text).toContain(`kept ${VIEWED_DAYS} days; Clear under Viewed removes it)`)
  })

  it('draws saves and Viewed from their cards while the first read is out and in an outage, without calling them gone (V1, 10-30)', async () => {
    const ok = fixture.items.filter(item => item.verdict === 'ok' && item.category)
    const saved = ok[0], seen = ok.find(item => item.streamId !== saved.streamId)!
    plainSave(saved)
    recordViewed(seen.id, plainCard(seen))
    let fail!: (error: unknown) => void
    feed.load.mockReturnValue(new Promise((_, reject) => { fail = reject }))
    window.history.replaceState(null, '', '/analytics/moments?view=saved')
    renderMoments()
    const check = () => {
      expect(sv('Saved').textContent).toBe('Saved (1)')
      expect(rows()).toHaveLength(1)
      expect(rows()[0].querySelector('.mk-r-nm')?.textContent).toBe(saved.login.toLowerCase()) // a save from master's page keeps no display name
      expect(rows()[0].textContent).not.toContain('Gone from the feed')
      fireEvent.click(sv('Viewed'))
      expect(rows()).toHaveLength(1)
      expect(rows()[0].querySelector('.mk-r-nm')?.textContent).toBe(seen.displayName)
      expect(rows()[0].textContent).not.toContain('Gone from the feed')
      fireEvent.click(sv('Saved'))
    }
    // the first read is still out
    await waitFor(() => expect(sv('Saved')).toBeTruthy())
    check()
    // an outage
    await act(async () => fail(normalizeApiError(500, { error: 'internal' })))
    expect((await screen.findByRole('alert')).textContent).toBe('Moments couldn’t load.')
    check()
  })

  it('stays on the tab picked while the first read is out once it lands (V1, 10-30)', async () => {
    const held = fixture.items.find(item => item.verdict === 'ok')!
    plainSave(held)
    let land!: (page: MomentsFeedSnapshot) => void
    feed.load.mockReturnValue(new Promise(resolve => { land = resolve }))
    renderMoments()
    await screen.findByRole('heading', { level: 1, name: 'Moments' })
    // just the dot until the list has loaded (Q2c, 10-31)
    expect(document.querySelector('.mk-fresh')?.textContent).toBe('')
    fireEvent.click(seg('Saved'))
    expect(rows()).toHaveLength(1)
    await act(async () => land(snap(fixture.items)))
    await waitFor(() => expect(rows()[0]?.classList.contains('mk-r-gone')).toBe(false))
    expect(document.querySelector('.mk-fresh')?.textContent).toBe('updated just now')
    expect(seg('Saved').getAttribute('aria-pressed')).toBe('true')
    expect(sv('Saved').getAttribute('aria-pressed')).toBe('true')
    expect(rows().map(r => r.dataset.key)).toEqual([held.id])
  })

  it('keeps the tab, Top’s hours and the search through an outage and Try again, out of the link (V1, 10-30)', async () => {
    const held = fixture.items.find(item => item.verdict === 'ok')!
    plainSave(held)
    feed.load.mockRejectedValueOnce(normalizeApiError(500, { error: 'internal' }))
    renderMoments()
    await screen.findByRole('alert')
    const search = () => screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search channels, games or emotes' })
    fireEvent.click(seg('Top'))
    fireEvent.click(rng('6h'))
    fireEvent.change(search(), { target: { value: held.login } })
    fireEvent.click(seg('Saved'))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(rows()[0]?.classList.contains('mk-r-gone')).toBe(false))
    expect(feed.load).toHaveBeenCalledTimes(2)
    expect(seg('Saved').getAttribute('aria-pressed')).toBe('true')
    expect(rows().map(r => r.dataset.key)).toEqual([held.id])
    expect(search().value).toBe(held.login)
    fireEvent.click(seg('Top'))
    expect(rng('6h').getAttribute('aria-pressed')).toBe('true')
    expect(new URL(window.location.href).search).toBe('')
  })

  it('calls a save gone from the feed only once it is older than the window read: a later page that fails leaves the rest plain (V1, 10-30)', async () => {
    atFixtureTime()
    const newest = fixture.items.slice().sort((a, b) => b.minuteStart - a.minuteStart)
    const head = newest.slice(0, 12)
    // on a later page, well inside the 24 hours
    const late = newest.slice(12).find(item => item.verdict === 'ok' && fixture.generatedAt + 90_000 - item.minuteStart < 20 * 3_600_000)!
    feed.load.mockResolvedValue(snap(head, { nextCursor: 'c2' }))
    feed.rest.mockResolvedValue(false) // that page fails: the page keeps the first one
    plainSave(late)
    toggleSavedMoment(fromHubMoment({ login: 'somestreamer', streamId: '123456', offsetSeconds: 930, at: fixture.generatedAt - 30 * 3_600_000, label: 'PJSalt' })!)
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    await waitFor(() => expect(feed.rest).toHaveBeenCalledTimes(1))
    fireEvent.click(seg('Saved'))
    expect(sv('Saved').textContent).toBe('Saved (2)')
    const row = (login: string, streamId: string, offset: number) => rows().find(r => r.dataset.key === JSON.stringify([login, streamId, offset]))!
    const inWindow = row(late.login.toLowerCase(), late.streamId, late.offsetSeconds), old = row('somestreamer', '123456', 930)
    expect(inWindow.classList.contains('mk-r-gone')).toBe(true)
    expect(inWindow.textContent).not.toContain('Gone from the feed')
    expect(within(inWindow).getByRole('link', { name: 'Open it on the stream’s page' })).toBeTruthy()
    expect(within(old).getByText('Gone from the feed')).toBeTruthy()
  })

  it('calls a Viewed moment gone from the feed once a poll drops it from the window (V1, 10-30)', async () => {
    // the page's polls come every 45 s
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    const t0 = fixture.generatedAt + 90_000
    vi.setSystemTime(t0)
    const ok = fixture.items.filter(item => item.verdict === 'ok')
    const fresh = ok[0]
    const edge = { ...ok.find(item => item.streamId !== fresh.streamId)!, minuteStart: t0 - (23 * 60 + 55) * 60_000 } // about to leave the 24 hours
    feed.load.mockResolvedValue(snap([fresh, edge]))
    feed.poll.mockResolvedValue(snap([fresh]))
    renderMoments()
    await waitFor(() => expect(rows()).toHaveLength(2))
    fireEvent.click(rows().find(r => r.dataset.key === edge.id)!)
    await opened()
    // another one opened, so the poll doesn't keep that one open
    fireEvent.click(rows().find(r => r.dataset.key === fresh.id)!)
    await waitFor(() => expect(document.querySelector('.mk-slot .mk-d')?.getAttribute('data-key')).toBe(fresh.id))
    // half an hour on, a poll that no longer brings it
    vi.setSystemTime(t0 + 30 * 60_000)
    await act(async () => { vi.advanceTimersByTime(45_000) })
    expect(feed.poll).toHaveBeenCalledTimes(1)
    expect(rows().map(r => r.dataset.key)).toEqual([fresh.id])
    fireEvent.click(seg('Saved'))
    fireEvent.click(sv('Viewed'))
    expect(sv('Viewed').textContent).toBe('Viewed (2)')
    const gone = rows().find(r => r.classList.contains('mk-r-gone'))!
    expect(gone.querySelector('.mk-r-nm')?.textContent).toBe(edge.displayName)
    expect(within(gone).getByText('Gone from the feed')).toBeTruthy()
  })

  it('keeps a save from before the cards kept the game’s id in its game’s list, by the game’s name (V1, 10-30)', async () => {
    // saved on master's page with its game's name, and older than the window
    toggleSavedMoment(fromHubMoment({ login: 'somestreamer', streamId: '123456', offsetSeconds: 930, at: fixture.generatedAt - 30 * 3_600_000, label: 'PJSalt', category: 'Overwatch' })!)
    window.history.replaceState(null, '', '/analytics/moments?view=saved&game=515025')
    renderMoments()
    await waitFor(() => expect(within(covers()).getByRole('button', { name: /^Overwatch:/ }).getAttribute('aria-pressed')).toBe('true'))
    expect(rows()).toHaveLength(1)
    expect(rows()[0].querySelector('.mk-r-nm')?.textContent).toBe('somestreamer')
    expect(rows()[0].querySelector('.mk-r-g')?.textContent).toBe('Overwatch')
    expect(screen.queryByText('No saved Overwatch moments.')).toBeNull()
  })

  it('says "No moments match." for a game it can’t name, and under Saved or Viewed when a search finds none of them', async () => {
    const ok = fixture.items.filter(item => item.verdict === 'ok')
    const saved = ok[0], seen = ok.find(item => item.streamId !== saved.streamId)!
    // a game in neither the moments nor the feed's games
    window.history.replaceState(null, '', '/analytics/moments?game=999999999')
    renderMoments()
    expect(await screen.findByText('No moments match.')).toBeTruthy()
    fireEvent.click(seg('Top'))
    expect(document.querySelector('.mk-empty')?.textContent).toBe('No moments match.')
    cleanup()
    plainSave(saved)
    recordViewed(seen.id, plainCard(seen))
    window.history.replaceState(null, '', '/analytics/moments?view=saved')
    renderMoments()
    await waitFor(() => expect(rows().map(r => r.dataset.key)).toEqual([saved.id]))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search channels, games or emotes' }), { target: { value: 'zzz' } })
    expect(rows()).toHaveLength(0)
    expect(document.querySelector('.mk-empty')?.textContent).toBe('No moments match.')
    fireEvent.click(sv('Viewed'))
    expect(rows()).toHaveLength(0)
    expect(document.querySelector('.mk-empty')?.textContent).toBe('No moments match.')
  })

  it('removes the page’s old whole-copy save list from this browser (V1, 10-30)', async () => {
    window.localStorage.setItem('sp-moments-checked-saved', '[]')
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    expect(window.localStorage.getItem('sp-moments-checked-saved')).toBeNull()
  })

  it('keeps the moments you opened under Saved’s Viewed, in this browser, until Clear', async () => {
    const { unmount } = renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(1))
    const [first, second] = rows().map(r => r.dataset.key!)
    fireEvent.click(rows()[0])
    await opened()
    fireEvent.click(rows().find(r => r.dataset.key === second)!)
    fireEvent.click(seg('Saved'))
    expect(sv('Viewed').textContent).toBe('Viewed (2)')
    unmount()
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(seg('Saved'))
    fireEvent.click(sv('Viewed'))
    // Viewed sits inside Saved (M1, 10-22)
    expect(seg('Saved').getAttribute('aria-pressed')).toBe('true')
    expect(sv('Viewed').getAttribute('aria-pressed')).toBe('true')
    // newest opened first, one row each, the right column saying when you opened it
    expect(rows().map(r => r.dataset.key)).toEqual([second, first])
    expect(rows()[0].querySelector('.mk-r-v time')?.textContent).toBe('opened just now')
    expect(screen.getByText(/kept in this browser for 30 days/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(sv('Viewed').textContent).toBe('Viewed (0)')
    expect(rows()).toHaveLength(0)
    expect(window.localStorage.getItem('sp-moments-viewed')).toBeNull()
  })

  it('keeps Viewed as id, when and the small card, and draws one that left the feed from its card, in the order opened (V1, 10-30)', async () => {
    const ok = fixture.items.filter(item => item.verdict === 'ok' && item.category)
    const a = ok[0], b = ok.find(item => item.streamId !== a.streamId)!
    feed.load.mockResolvedValue(snap([a, b]))
    const { unmount } = renderMoments()
    await waitFor(() => expect(rows()).toHaveLength(2))
    fireEvent.click(rows().find(r => r.dataset.key === b.id)!)
    await opened()
    fireEvent.click(rows().find(r => r.dataset.key === a.id)!)
    unmount()
    const kept = JSON.parse(window.localStorage.getItem('sp-moments-viewed')!)
    expect(kept.map((e: { id: string }) => e.id)).toEqual([a.id, b.id])
    expect(kept[0]).toMatchObject({ id: a.id, card: { login: a.login, streamId: a.streamId, offsetSeconds: a.offsetSeconds, category: a.category!.name, categoryId: a.category!.id } })
    expect(kept[0]).not.toHaveProperty('item')
    // just what its row draws: no rates or top emotes
    for (const field of ['chatPerMin', 'emotesPerMin', 'measurementScope', 'topEmotes']) expect(kept[0].card).not.toHaveProperty(field)
    // an entry kept whole, before the cards, is left out
    window.localStorage.setItem('sp-moments-viewed', JSON.stringify([...kept, { at: kept[1].at, item: ok[2] }]))
    // a has left the feed
    feed.load.mockResolvedValue(snap([b]))
    window.history.replaceState(null, '', '/analytics/moments')
    renderMoments()
    await waitFor(() => expect(rows()).toHaveLength(1))
    fireEvent.click(seg('Saved'))
    fireEvent.click(sv('Viewed'))
    expect(sv('Viewed').textContent).toBe('Viewed (2)')
    const [gone, still] = rows()
    expect(gone.classList.contains('mk-r-gone')).toBe(true)
    expect(gone.querySelector('.mk-r-nm')?.textContent).toBe(a.displayName)
    expect(gone.querySelector('.mk-r-g')?.textContent).toBe(a.category!.name)
    expect(gone.querySelector('.mk-r-v time')?.textContent).toBe('opened just now')
    expect(still.dataset.key).toBe(b.id)
    expect(feed.item).not.toHaveBeenCalled()
  })

  it('moves J/K past a Viewed row drawn from its card, keeping ?m= a feed id (V1, 10-30)', async () => {
    const ok = fixture.items.filter(item => item.verdict === 'ok')
    const a = ok[0], g = ok.find(item => item.streamId !== a.streamId)!, b = ok.find(item => item.streamId !== a.streamId && item.streamId !== g.streamId)!
    // opened b, then g, then a: a first; g has since left the feed
    const t = Date.now()
    recordViewed(b.id, plainCard(b), t - 3000)
    recordViewed(g.id, plainCard(g), t - 2000)
    recordViewed(a.id, plainCard(a), t - 1000)
    feed.load.mockResolvedValue(snap([a, b]))
    renderMoments()
    await waitFor(() => expect(rows()).toHaveLength(2))
    fireEvent.click(seg('Saved'))
    fireEvent.click(sv('Viewed'))
    expect(rows().map(r => r.classList.contains('mk-r-gone'))).toEqual([false, true, false])
    const open = () => document.querySelector('.mk-slot .mk-d')?.getAttribute('data-key')
    fireEvent.click(rows()[0])
    await waitFor(() => expect(open()).toBe(a.id))
    fireEvent.keyDown(document.body, { key: 'j' })
    await waitFor(() => expect(open()).toBe(b.id))
    expect(new URL(window.location.href).searchParams.get('m')).toBe(b.id)
    fireEvent.keyDown(document.body, { key: 'ArrowUp' })
    await waitFor(() => expect(open()).toBe(a.id))
    expect(new URL(window.location.href).searchParams.get('m')).toBe(a.id)
  })

  it('puts the games on top as covers, busiest first; a cover shows its moments in the list you are on (M1, 10-22)', async () => {
    feed.load.mockResolvedValue(snap(fixture.items, { categories: [
      { id: '515025', name: 'Overwatch', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/515025-144x192.jpg', moments: 8, liveChannels: 41 },
    ] }))
    atFixtureTime()
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const cards = () => within(covers()).getAllByRole('button')
    expect(cards().slice(0, 4).map(c => c.querySelector('.mk-gc-nm')?.textContent)).toEqual(['Everything', 'Overwatch', 'Minecraft', 'Grand Theft Auto V'])
    const [all, ow, mc] = cards()
    expect(ow.getAttribute('aria-label')).toBe('Overwatch: 6 moments, 41 channels live now. Shows its moments.')
    expect(ow.querySelector('.mk-gc-ct')?.textContent).toBe('6 moments')
    expect(ow.querySelector('.mk-gc-live')?.textContent).toBe('41 live')
    expect(mc.querySelector('.mk-gc-live')).toBeNull()
    expect(ow.querySelector('img')?.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/515025-285x380.jpg')
    // no Games tab: the covers are always there
    expect(within(screen.getByRole('group', { name: 'Which moments' })).queryByRole('button', { name: 'Games' })).toBeNull()
    fireEvent.click(ow)
    // Overwatch's moments only, still under Live, and in the link
    expect(seg('Live').getAttribute('aria-pressed')).toBe('true')
    expect(ow.getAttribute('aria-pressed')).toBe('true')
    expect(all.getAttribute('aria-pressed')).toBe('false')
    const owIds = new Set(fixture.items.filter(item => item.category?.id === '515025' && item.verdict !== 'bad').map(item => item.id))
    const owStreams = new Set(fixture.items.filter(item => owIds.has(item.id)).map(item => item.streamId))
    expect(rows()).toHaveLength(owStreams.size)
    expect(rows().every(r => owIds.has(r.dataset.key!))).toBe(true)
    expect(new URL(window.location.href).searchParams.get('game')).toBe('515025')
    // Top keeps the game
    fireEvent.click(seg('Top'))
    expect(rows().length).toBeGreaterThan(0)
    expect(rows().every(r => owIds.has(r.dataset.key!))).toBe(true)
    fireEvent.click(seg('Live'))
    // the picked cover pressed again shows every game, as does "All games"
    expect(ow.getAttribute('aria-label')).toBe('Overwatch: 6 moments, 41 channels live now. Shows every game again.')
    fireEvent.click(ow)
    expect(new URL(window.location.href).searchParams.get('game')).toBeNull()
    expect(rows()).toHaveLength(new Set(fixture.items.filter(item => item.verdict !== 'bad').map(item => item.streamId)).size)
    fireEvent.click(mc)
    expect(new URL(window.location.href).searchParams.get('game')).not.toBeNull()
    fireEvent.click(all)
    expect(new URL(window.location.href).searchParams.get('game')).toBeNull()
    expect(all.getAttribute('aria-pressed')).toBe('true')
  })

  it('opens on the game in the link, and says so when that game has nothing to show', async () => {
    window.history.replaceState(null, '', '/analytics/moments?game=515025')
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    expect(within(covers()).getByRole('button', { name: /^Overwatch:/ }).getAttribute('aria-pressed')).toBe('true')
    cleanup()
    // Counter-Strike's only moment doesn't hold up: its cover stays, picked, at 0
    window.history.replaceState(null, '', '/analytics/moments?game=32399')
    renderMoments()
    expect(await screen.findByText('No Counter-Strike moments in the last 24 hours.')).toBeTruthy()
    expect(within(covers()).getByRole('button', { name: /^Counter-Strike: 0 moments\./ }).getAttribute('aria-pressed')).toBe('true')
    cleanup()
    // not a game id: every game
    window.history.replaceState(null, '', '/analytics/moments?game=overwatch')
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    expect(within(covers()).getByRole('button', { name: /^All games:/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('says a save is kept for this session only when this browser can’t store it', async () => {
    // a fresh save list and page, so its session-only state stays out of the other tests
    vi.resetModules()
    const { default: FreshPage } = await import('../src/ui/components/moments/checked/MomentsCheckedPage')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Denied', 'QuotaExceededError') })
    render(<MemoryRouter initialEntries={['/analytics/moments']}><FreshPage fallback={null} /></MemoryRouter>)
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(rows()[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    await waitFor(() => expect(spoken()).toBe('Saved for this session only.'))
    // and the status line says why (Q3b, 10-31)
    expect(document.querySelector('.mk-note')?.textContent).toBe('Storage unavailable. Saves are available for this session only.')
  })
})
