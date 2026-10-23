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
import { toggleSavedMoment } from '../src/lib/savedDiscoveryMoments'
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
    expect(feed.load).toHaveBeenCalledTimes(1)
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

  it('lists the latest moments that hold up, one row per stream, a picture each, with no tiers, filters or orders', async () => {
    renderMoments()
    expect(await screen.findByRole('heading', { level: 1, name: 'Moments' })).toBeTruthy()
    expect(screen.getByText('Big reactions in live chat. Each one beat its own stream’s last 15 minutes.')).toBeTruthy()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const shown = fixture.items.filter(item => item.verdict !== 'bad')
    expect(rows().length).toBe(new Set(shown.map(item => item.streamId)).size)
    expect(document.querySelectorAll('.mk-list > li.mk-g[data-vd="bad"]')).toHaveLength(0)
    expect(seg('Latest').getAttribute('aria-pressed')).toBe('true')
    expect(within(screen.getByRole('group', { name: 'Which moments' })).getAllByRole('button').map(b => b.textContent)).toEqual(['Latest', 'Top', 'Games', 'Saved (0)', 'Viewed (0)'])
    // a stream's earlier moments stay closed until its "N earlier" is pressed (E1, 10-22)
    expect(document.querySelector('.mk-sub')).toBeNull()
    expect(document.querySelector('.mk-fresh')?.textContent).toBe('updated just now')
    // B2 drops the verdict counts, Checked/All, the game and order selects, how we check, and the line under the list
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'How we check a moment' })).toBeNull()
    expect(document.querySelector('.mk-foot')).toBeNull()
    expect(screen.getByRole('button', { name: 'Replay the last hour' })).toBeTruthy()
    // every lead row has its picture; the earlier moments under a stream don't
    expect(document.querySelectorAll('.mk-list > li.mk-g > .mk-r > .mk-r-th')).toHaveLength(rows().length)
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

  it('opens a stream’s earlier moments only from its "N earlier", and closing them keeps the stream open (E1, 10-22)', async () => {
    const many = fixture.items.filter(item => item.verdict !== 'bad' && item.streamId === '318959837542')
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const lead = () => rows().find(r => many.some(item => item.id === r.dataset.key) && !r.closest('.mk-sub'))!
    // opening the stream's moment leaves its earlier ones closed
    fireEvent.click(lead())
    await opened()
    expect(document.querySelector('.mk-sub')).toBeNull()
    const more = within(lead()).getByRole('button', { name: `Show ${many.length - 1} earlier moments from ${many[0].displayName || many[0].login}` })
    expect(more.textContent).toBe(`${many.length - 1} earlier`)
    expect(more.getAttribute('aria-expanded')).toBe('false')
    const leadKey = lead().dataset.key
    fireEvent.click(more)
    // its own button: the open moment stays the same
    expect(new URL(window.location.href).searchParams.get('m')).toBe(leadKey)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    const sub = document.getElementById(more.getAttribute('aria-controls')!)!
    expect(sub.querySelectorAll('.mk-r')).toHaveLength(many.length - 1)
    // an earlier moment opened, then the list closed: the stream's newest is the open one
    fireEvent.click(sub.querySelector<HTMLElement>('.mk-r')!)
    expect(new URL(window.location.href).searchParams.get('m')).not.toBe(leadKey)
    fireEvent.click(within(lead()).getByRole('button', { name: /^Hide \d+ earlier moments from / }))
    expect(document.querySelector('.mk-sub')).toBeNull()
    await waitFor(() => expect(new URL(window.location.href).searchParams.get('m')).toBe(leadKey))
  })

  it('opens the list of a deep-linked earlier moment, which holds it', async () => {
    const many = fixture.items.filter(item => item.verdict !== 'bad' && item.streamId === '318959837542').sort((a, b) => b.minuteStart - a.minuteStart)
    window.history.replaceState(null, '', `/analytics/moments?m=${many[2].id}`)
    renderMoments()
    await waitFor(() => expect(document.querySelector('.mk-d')?.getAttribute('data-key')).toBe(many[2].id))
    expect(document.querySelectorAll('.mk-sub .mk-r')).toHaveLength(many.length - 1)
  })

  it('ranks the moments that hold up and rose under Top, strongest first, one row a burst, with no replay (T1, 10-22)', async () => {
    const rose = fixture.items.filter(item => item.verdict === 'ok' && item.checks.rise?.code === 'rose' && item[item.label.kind].x != null)
    const lead = rose.slice().sort((a, b) => b.score - a.score)[0]
    // a weaker minute 2 minutes into the strongest burst
    const near = { ...lead, id: `${lead.id}-near`, minuteStart: lead.minuteStart + 2 * 60_000, score: lead.score - 1 }
    feed.load.mockResolvedValue(snap([...fixture.items, near]))
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(seg('Top'))
    expect(seg('Top').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Top moments in the last 12 hours, strongest first')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Replay the last hour' })).toBeNull()
    const byKey = new Map([...fixture.items, near].map(item => [item.id, item]))
    const shown = rows().map(r => byKey.get(r.dataset.key!)!)
    expect(shown[0].id).toBe(lead.id)
    expect(shown.map(item => item.id)).not.toContain(near.id)
    expect(shown.every(item => rose.includes(item))).toBe(true)
    expect(shown.map(item => item.score)).toEqual(shown.map(item => item.score).sort((a, b) => b - a))
    // a stream can have several rows here, each its own; none hides others under "N earlier"
    expect(new Set(shown.map(item => item.streamId)).size).toBeLessThan(shown.length)
    expect(document.querySelector('.mk-r-more')).toBeNull()
    // Latest is in time order again
    fireEvent.click(seg('Latest'))
    expect(document.querySelector('.mk-cap')).toBeNull()
    expect(screen.getByRole('button', { name: 'Replay the last hour' })).toBeTruthy()
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

  it('says why a moment counts behind its verdict chip, and Esc closes that before the moment', async () => {
    const ok = fixture.items.find(item => item.verdict === 'ok' && item.checks.rise?.code === 'rose' && item[item.label.kind].x != null)!
    feed.load.mockResolvedValue(snap([ok]))
    renderMoments()
    await waitFor(() => expect(rows()).toHaveLength(1))
    fireEvent.click(rows()[0])
    const detail = await opened()
    const chip = within(detail).getByRole('button', { name: 'Holds up: why it counts' })
    expect(chip.textContent).toBe('Holds up')
    expect(chip.getAttribute('aria-expanded')).toBe('false')
    expect(within(detail).queryByRole('heading', { name: 'Why it counts' })).toBeNull()
    fireEvent.click(chip)
    expect(chip.getAttribute('aria-expanded')).toBe('true')
    const pop = document.getElementById(chip.getAttribute('aria-controls')!)!
    expect(within(pop).getByRole('heading', { name: 'Why it counts' })).toBeTruthy()
    expect(within(pop).getAllByRole('listitem').length).toBeGreaterThanOrEqual(2)
    // the open moment's × is its first line, saying what it counts (X1, 10-22); when, where in the stream and the game the second
    expect(detail.querySelector('.mk-d-meta > .mk-d-mx')?.textContent).toBe(`${ok.label.kind === 'chat' ? 'Chat was' : 'Emotes were'} ${fx(ok[ok.label.kind].x!)} the 15 minutes before`)
    expect(detail.querySelector('.mk-d-meta > .mk-d-m2')?.textContent).toMatch(/into the stream|in the VOD/)
    // and so does the row's: "Emotes 5.7× usual"
    expect(rows()[0].querySelector('.mk-r-x')?.textContent).toBe(`${ok.label.kind === 'chat' ? 'Chat' : 'Emotes'} ${fx(ok[ok.label.kind].x!)} usual`)
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
    expect(within(detail).getByRole('button', { name: 'Partly: why it counts' })).toBeTruthy()
  })

  it('opens a deep-linked moment that didn’t hold up in Latest, worded as such', async () => {
    const bad = fixture.items.find(item => item.verdict === 'bad')!
    window.history.replaceState(null, '', `/analytics/moments?m=${bad.id}`)
    renderMoments()
    await waitFor(() => expect(document.querySelector('.mk-d')).toBeTruthy())
    const detail = document.querySelector<HTMLElement>('.mk-d')!
    expect(detail.getAttribute('data-key')).toBe(bad.id)
    expect(seg('Latest').getAttribute('aria-pressed')).toBe('true')
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
    expect(screen.getByRole('button', { name: 'Saved' }).getAttribute('aria-pressed')).toBe('true')
    unmount()
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(seg('Saved'))
    expect(seg('Saved').textContent).toBe('Saved (1)')
    expect(rows()).toHaveLength(1)
  })

  it('looks up a save this page holds no copy of (the account’s, past the window) and draws it under Saved', async () => {
    const old = fixture.items.find(item => item.verdict === 'ok')!
    feed.load.mockResolvedValue(snap(fixture.items.filter(item => item.streamId !== old.streamId)))
    feed.item.mockImplementation(async (id: string) => (id === old.id ? old : null))
    toggleSavedMoment(fromHubMoment({ login: old.login, streamId: old.streamId, offsetSeconds: old.offsetSeconds, at: old.minuteStart, label: old.label.text })!)
    renderMoments()
    await waitFor(() => expect(seg('Saved').textContent).toBe('Saved (1)'))
    expect(feed.item).toHaveBeenCalledWith(old.id, expect.anything())
    fireEvent.click(seg('Saved'))
    expect(rows().map(r => r.dataset.key)).toEqual([old.id])
  })

  it('keeps a save the feed has lost as a plain row under Saved, counted there, with the stream’s page to open it on', async () => {
    const old = fixture.items.find(item => item.verdict === 'ok')!
    feed.load.mockResolvedValue(snap(fixture.items.filter(item => item.streamId !== old.streamId)))
    feed.item.mockResolvedValue(null)
    toggleSavedMoment(fromHubMoment({ login: old.login, streamId: old.streamId, offsetSeconds: old.offsetSeconds, at: old.minuteStart, label: 'spammed PJSalt' })!)
    renderMoments()
    await waitFor(() => expect(seg('Saved').textContent).toBe('Saved (1)'))
    fireEvent.click(seg('Saved'))
    const [row] = rows()
    expect(row.classList.contains('mk-r-gone')).toBe(true)
    expect(row.querySelector('.mk-r-em')?.textContent).toBe('PJSalt')
    expect(row.querySelector('.mk-r-sp svg')).toBeNull()
    expect(within(row).getByText('Gone from the feed')).toBeTruthy()
    expect(within(row).getByRole('link', { name: 'Open it on the stream’s page' }).getAttribute('href'))
      .toBe(`/analytics/${old.login}/${old.streamId}?returnTo=%2Fanalytics%2Fmoments#t=${old.offsetSeconds}`)
  })

  it('does not call a save gone when its lookup fails, and says signed out that saves stay in this browser', async () => {
    const old = fixture.items.find(item => item.verdict === 'ok')!
    feed.load.mockResolvedValue(snap(fixture.items.filter(item => item.streamId !== old.streamId)))
    feed.item.mockRejectedValue(new Error('offline'))
    toggleSavedMoment(fromHubMoment({ login: old.login, streamId: old.streamId, offsetSeconds: old.offsetSeconds, at: old.minuteStart, label: old.label.text })!)
    renderMoments()
    await waitFor(() => expect(feed.item).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(seg('Saved').textContent).toBe('Saved (0)')
    fireEvent.click(seg('Saved'))
    expect(screen.getByText('Nothing saved yet. Saves stay in this browser until you sign in.')).toBeTruthy()
  })

  it('keeps the moments you opened under Viewed, in this browser, until Clear', async () => {
    const { unmount } = renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(1))
    expect(seg('Viewed').textContent).toBe('Viewed (0)')
    const [first, second] = rows().map(r => r.dataset.key!)
    fireEvent.click(rows()[0])
    await opened()
    fireEvent.click(rows().find(r => r.dataset.key === second)!)
    expect(seg('Viewed').textContent).toBe('Viewed (2)')
    unmount()
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(seg('Viewed'))
    // newest opened first, one row each, the right column saying when you opened it
    expect(rows().map(r => r.dataset.key)).toEqual([second, first])
    expect(rows()[0].querySelector('.mk-r-v time')?.textContent).toBe('opened just now')
    expect(screen.getByText(/kept in this browser for 30 days/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(seg('Viewed').textContent).toBe('Viewed (0)')
    expect(rows()).toHaveLength(0)
    expect(window.localStorage.getItem('sp-moments-viewed')).toBeNull()
  })

  it('shows the games as big covers under Games; a cover shows that game’s moments under Latest (B2)', async () => {
    feed.load.mockResolvedValue(snap(fixture.items, { categories: [
      { id: '515025', name: 'Overwatch', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/515025-144x192.jpg', moments: 8, liveChannels: 41 },
    ] }))
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(seg('Games'))
    const grid = screen.getByRole('region', { name: 'Games' })
    const names = () => within(grid).queryAllByRole('button').map(c => c.querySelector('.mk-gc-nm')?.textContent)
    expect(names().slice(0, 3)).toEqual(['Overwatch', 'Minecraft', 'Grand Theft Auto V'])
    const [ow, mc] = within(grid).getAllByRole('button')
    expect(ow.getAttribute('aria-label')).toBe('Overwatch: 6 moments, 41 channels live now. Shows its moments.')
    expect(ow.querySelector('.mk-gc-live')?.textContent).toBe('41 live')
    expect(mc.querySelector('.mk-gc-live')).toBeNull()
    expect(ow.querySelector('img')?.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/515025-285x380.jpg')
    // no list and no replay here
    expect(document.querySelector('.mk-list')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Replay the last hour' })).toBeNull()
    // the bar's search finds a game
    const find = screen.getByRole('searchbox', { name: 'Find a game' })
    fireEvent.change(find, { target: { value: 'mine' } })
    expect(names()).toEqual(['Minecraft'])
    fireEvent.change(find, { target: { value: 'zzz' } })
    expect(within(grid).getByText('No game matches.')).toBeTruthy()
    fireEvent.change(find, { target: { value: 'over' } })
    fireEvent.click(within(grid).getByRole('button', { name: /^Overwatch:/ }))
    // back on Latest with Overwatch's moments only, the game's chip in the bar and in the link
    expect(seg('Latest').getAttribute('aria-pressed')).toBe('true')
    const owIds = new Set(fixture.items.filter(item => item.category?.id === '515025' && item.verdict !== 'bad').map(item => item.id))
    const owStreams = new Set(fixture.items.filter(item => owIds.has(item.id)).map(item => item.streamId))
    expect(rows()).toHaveLength(owStreams.size)
    expect(rows().every(r => owIds.has(r.dataset.key!))).toBe(true)
    expect(document.querySelector('.mk-gchip')?.textContent).toBe('Overwatch')
    expect(new URL(window.location.href).searchParams.get('game')).toBe('515025')
    expect(screen.getByRole('searchbox', { name: 'Search channels, games or emotes' })).toBeTruthy()
    // the chip's × shows every game again
    fireEvent.click(screen.getByRole('button', { name: 'Show every game, not just Overwatch' }))
    expect(document.querySelector('.mk-gchip')).toBeNull()
    expect(new URL(window.location.href).searchParams.get('game')).toBeNull()
    expect(rows()).toHaveLength(new Set(fixture.items.filter(item => item.verdict !== 'bad').map(item => item.streamId)).size)
  })

  it('opens on the game in the link, and says so when that game has nothing to show', async () => {
    window.history.replaceState(null, '', '/analytics/moments?game=515025')
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    expect(document.querySelector('.mk-gchip')?.textContent).toBe('Overwatch')
    cleanup()
    // Counter-Strike's only moment doesn't hold up
    window.history.replaceState(null, '', '/analytics/moments?game=32399')
    renderMoments()
    expect(await screen.findByText('No Counter-Strike moments in the last 12 hours.')).toBeTruthy()
    cleanup()
    // not a game id: every game
    window.history.replaceState(null, '', '/analytics/moments?game=overwatch')
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    expect(document.querySelector('.mk-gchip')).toBeNull()
  })
})
