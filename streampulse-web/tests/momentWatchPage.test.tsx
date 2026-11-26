import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MomentWatchPage from '../src/routes/analytics/MomentWatchPage'
import { resetAccountSessionForTests } from '../src/lib/accountSession'
import { setMomentNowForTests } from '../src/lib/momentCommentSpan'
import { loadMomentStream, resetMomentReads } from '../src/lib/momentReads'
import { resetMomentMoreReads } from '../src/lib/momentMoreReads'
import { clearPublicHubCacheForTests } from '../src/lib/publicHubCache'
import { resetCategoryArtwork } from '../src/lib/momentCategoryArtwork'
import { resetChannelLookups } from '../src/lib/channelLookup'
import { resetMomentClipCache } from '@streampulse/analytics-console/moment-previews'
import { resetVodFrameCache } from '@streampulse/analytics-console/utils/vodFrames'

vi.mock('../src/ui/components/analytics/AnalyticsFigmaShell', () => ({ AnalyticsFigmaShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

const STREAM = '9000001'
const MINUTE = '20261114T1040Z'
const CSRF = 'a'.repeat(64)
let cookie = ''

const feedback = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1, streamId: STREAM, momentAt: '2026-11-14T10:40:00Z',
  stream: { login: 'fakechan01', displayName: 'fakechan01', profileImageUrl: '', category: 'fake-pog', startedAt: '2026-11-14T09:59:30Z', endedAt: '2026-11-14T12:00:00Z' },
  window: { from: '2026-11-14T10:35:00Z', to: '2026-11-14T10:45:00Z' },
  clips: [], ratings: { yes: 3, total: null, share: null },
  you: { signedIn: false, canWrite: false, verdict: null }, comments: { total: 0 }, hidden: false, ...over,
})
const source = () => ({
  channel: 'fakechan01', vodId: '123456789', vodAlignSeconds: 0, vodDurationSeconds: 7200, vodTiming: { state: 'verified' },
  stream: { streamId: STREAM, channel: 'fakechan01', startedAt: '2026-11-14T09:59:30Z', vodId: '123456789' },
})
/** The stream route's answer for a stream that has ended (the read-only page's facts). */
const endedSource = (over: Record<string, unknown> = {}) => ({ ...source(), stream: { ...source().stream, endedAt: '2026-11-14T12:00:00Z', ...over } })
/** The stream's /games answer: Just Chatting for its first 30 minutes, then a game whose Twitch cover is an _IGDB one. */
const GAMES_PATH = `/v1/portal/analytics/streams/${STREAM}/games`
const segment = (over: Record<string, unknown>) => ({ streamId: STREAM, source: 'snapshot', createdAt: '2026-11-14T12:00:00Z', ...over })
const games = (body: unknown[] = [
  segment({ gameName: 'Just Chatting', categoryId: '509658', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658-210x280.jpg', offsetSeconds: 0, durationSeconds: 1800 }),
  segment({ gameName: 'Fake Game', categoryId: '1867279146', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/1867279146_IGDB-210x280.jpg', offsetSeconds: 1800, durationSeconds: 9000 }),
]): Record<string, Answer> => ({ [GAMES_PATH]: { body } })
const storyboard = { sheetUrl: 'https://d2vi6trrdongqn.cloudfront.net/fake/storyboards/1-high-0.jpg', sheetWidth: 1100, sheetHeight: 620, cropX: 0, cropY: 0, cropW: 220, cropH: 124 }
const clip = () => ({
  id: 'FakeClipSlug-1', url: 'https://www.twitch.tv/fakechan01/clip/FakeClipSlug-1', thumbnailUrl: 'https://clips-media-assets2.twitch.tv/fake.jpg',
  title: 'fake-pog play', durationSeconds: 24, from: '2026-11-14T10:39:30Z', to: '2026-11-14T10:40:30Z',
})

type Answer = { status?: number; body?: unknown }
let calls: string[]
let feedIds: string[]
function serve(feedbackAnswer: Answer | ((path: string) => Answer), extra: {
  source?: unknown
  /** The stream route's status and body; else 200 with `source`. */
  stream?: Answer
  recap?: Answer
  item?: Answer | ((id: string) => Answer)
  /** Any other path's answer (frames, clips). */
  more?: Record<string, Answer>
} = {}) {
  calls = []
  feedIds = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    calls.push(url.pathname)
    const send = (a: Answer) => Response.json(a.body ?? {}, { status: a.status ?? 200 })
    if (url.pathname.endsWith('/feedback')) return send(typeof feedbackAnswer === 'function' ? feedbackAnswer(url.pathname) : feedbackAnswer)
    if (url.pathname === `/v1/portal/analytics/streams/${STREAM}`) return send(extra.stream ?? { body: extra.source ?? source() })
    if (url.pathname.endsWith('/recap')) return send(extra.more?.[url.pathname] ?? extra.recap ?? { body: { login: 'fakechan01', streamId: STREAM, topMoments: [{ offsetSeconds: 2430 }] } })
    if (url.pathname === '/v1/public/moments') {
      const id = url.searchParams.get('id') ?? ''
      if (id) feedIds.push(id)
      return send(typeof extra.item === 'function' ? extra.item(id) : extra.item ?? { status: 404 })
    }
    if (extra.more?.[url.pathname]) return send(extra.more[url.pathname])
    return Response.json({}, { status: 404 })
  }))
}

const spark = () => Array.from({ length: 25 }, () => 1)
const feedItem = (offsetSeconds: number) => ({
  id: `pulse-fakechan01-${STREAM}-${offsetSeconds}`, login: 'fakechan01', displayName: 'fakechan01', streamId: STREAM, offsetSeconds,
  minuteStart: Date.parse('2026-11-14T10:40:00Z'), streamLive: true, tier: 'strong', verdict: 'ok', score: 80,
  label: { kind: 'chat', text: 'chat burst' }, reaction: { key: 'other', label: 'Other' }, category: null, topEmotes: [], hero: 'chat',
  chat: { perMin: 1, baselinePerMin: 1, x: 1, state: 'ok' }, emotes: { perMin: 1, baselinePerMin: 1, x: 1, state: 'ok' }, spanMinutes: 1,
  spark: { chat: spark(), emotes: spark(), momentIndex: 16, sparkStartIndex: 0 }, checks: { history: { level: 'ok', code: 'ok' } },
})
const liveFeedback = (startedAt = '2026-11-14T09:59:30Z') => feedback({ stream: { ...feedback().stream, startedAt, endedAt: null } })

function Where() { return <span data-testid="where">{useLocation().pathname}</span> }
const PATH = `/analytics/moments/${STREAM}/${MINUTE}`
/** The hub's link: it calls the minute one of the stream's top Moments (without handing one over). */
const FROM_HUB = { from: 'hub' }
const renderPage = (path = PATH, state?: unknown) => render(
  <MemoryRouter initialEntries={[state === undefined ? path : { pathname: path, state }]}>
    <Where />
    <Routes>
      <Route path="/analytics/moments/:streamId/:momentAt" element={<MomentWatchPage />} />
    </Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  cookie = `__Host-pulse_csrf=${CSRF}`
  vi.spyOn(document, 'cookie', 'get').mockImplementation(() => cookie)
  resetAccountSessionForTests()
  // The stream and recap are read once per stream and kept, and so are frames and clips; each test starts with none read.
  resetMomentReads()
  resetMomentMoreReads()
  clearPublicHubCacheForTests()
  resetVodFrameCache()
  resetMomentClipCache()
  resetCategoryArtwork()
  resetChannelLookups()
  // Ratings and comments are their own switch; these tests are about the page with them on.
  vi.stubEnv('VITE_PUBLIC_MOMENT_FEEDBACK', 'on')
})
afterEach(() => { cleanup(); setMomentNowForTests(null); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('Moment watch page with ratings and comments switched off', () => {
  it.each(['', 'off', '0', 'true'])('asks nothing of /v1/account/... with VITE_PUBLIC_MOMENT_FEEDBACK=%j, and shows no rating row, comments or strip pick', async value => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_FEEDBACK', value)
    serve({ body: feedback() })
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull())
    // Let any read the page starts settle before counting.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(calls.filter(path => path.startsWith('/v1/account/'))).toEqual([])
    expect(screen.queryByRole('group', { name: 'Real moment?' })).toBeNull()
    expect(container.querySelector('[data-slot="rating-row"]')).toBeNull()
    expect(container.querySelector('[data-slot="comments"]')).toBeNull()
    expect(screen.queryByRole('slider', { name: 'Second in the stream' })).toBeNull()
  })

  it('reads the feedback route once the switch is on', async () => {
    serve({ body: feedback() })
    renderPage()
    await screen.findByRole('group', { name: 'Real moment?' })
    expect(calls).toContain(`/v1/account/streams/${STREAM}/moments/${MINUTE}/feedback`)
  })
})

describe('Moment watch page states', () => {
  it('shows an aria-busy skeleton while loading', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { container } = renderPage()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.getByText('Loading the Moment…')).toBeTruthy()
  })

  it('keeps the page’s whole shape while a bare address loads: the head, the strip’s box and Up next', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { container } = renderPage()
    const busy = container.querySelector('[aria-busy="true"]')!
    expect(busy.querySelector('.mw-picture .nc-skel-player')).not.toBeNull()
    // The title's and the channel's lines, and the Watch pill's room, unseen and unread.
    expect(busy.querySelector('.nc-watch-title .mw-skel-text')?.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(busy.querySelector('.nc-watch-channel .mw-pill-hold')).not.toBeNull()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(busy.querySelector('.mw-strip .mw-chart .moment-minutes[data-state="loading"]')).not.toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'More Moments from this stream' })).toBeTruthy()
  })

  it('asks for the recap beside the facts, not after them', async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => { asked.push(new URL(String(input), 'http://localhost').pathname); return new Promise(() => {}) }))
    renderPage()
    await waitFor(() => expect(asked).toContain(`/v1/portal/analytics/streams/${STREAM}/recap`))
    expect(asked).toContain(`/v1/portal/analytics/streams/${STREAM}`)
  })

  it.each([
    ['answers 404 (its routes are off)', { status: 404, body: { error: 'not_found' } }],
    ['fails', { status: 503, body: { error: 'down' } }],
  ])('shows the Moment read-only when the feedback route %s: no rating row, comments or strip pick', async (_name, answer) => {
    serve(answer, { source: endedSource() })
    const { container } = renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Moment at 0:40:30' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'fakechan01' }).getAttribute('href')).toBe('/analytics/fakechan01')
    expect((await screen.findByRole('link', { name: /Watch on Twitch from 0:40:30/ })).getAttribute('href')).toBe('https://www.twitch.tv/videos/123456789?t=2430s')
    expect(container.querySelector('[data-slot="strip"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="rating-row"]')).toBeNull()
    expect(container.querySelector('[data-slot="comments"]')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Real moment?' })).toBeNull()
    expect(screen.queryByRole('slider', { name: 'Second in the stream' })).toBeNull()
    // The stream route lists no clips: the box claims nothing about them.
    expect(screen.queryByText('No clip of this one yet.')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Moment pages aren’t switched on yet')).toBeNull()
  })

  it('shows an alert with Try again when the load fails, and reads again on the press', async () => {
    serve({ status: 503, body: { error: 'down' } }, { stream: { status: 503, body: { error: 'down' } } })
    renderPage()
    expect((await screen.findByRole('alert')).textContent).toContain('didn’t load')
    serve({ body: feedback() })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Moment at 0:40:30' })).toBeTruthy()
  })

  it('takes the failed read of its link’s warm as its first answer, and reads again on Try again', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_FEEDBACK', '')
    serve({ status: 404 }, { stream: { status: 503, body: { error: 'down' } } })
    const streamReads = () => calls.filter(path => path === `/v1/portal/analytics/streams/${STREAM}`).length
    // The link's press warmed the stream read, and it failed just now.
    await loadMomentStream(STREAM).catch(() => undefined)
    renderPage()
    expect((await screen.findByRole('alert')).textContent).toContain('didn’t load')
    expect(streamReads()).toBe(1)
    serve({ status: 404 }, { source: endedSource() })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Moment at 0:40:30' })).toBeTruthy()
    expect(streamReads()).toBe(1)
  })

  it.each([
    ['the stream route has no such stream', { status: 404, body: { error: 'stream_not_found' } }, { stream: { status: 404, body: { error: 'not_found' } } }],
    ['the minute is before the stream', { status: 400, body: { error: 'invalid_moment' } }, { source: endedSource({ startedAt: '2026-11-14T11:00:00Z' }) }],
  ])('shows the missing state when %s', async (_name, answer, extra) => {
    serve(answer, extra)
    renderPage()
    expect(await screen.findByText('This Moment isn’t here')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    ['the missing state', { status: 404, body: { error: 'not_found' } }, 'This Moment isn’t here'],
    ['Try again', { status: 503, body: { error: 'down' } }, 'The Moment didn’t load.'],
  ])('shows %s from the stream route alone with ratings and comments switched off', async (_name, stream, text) => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_FEEDBACK', '')
    serve({ body: feedback() }, { stream })
    renderPage()
    expect(await screen.findByText(text)).toBeTruthy()
    expect(calls.filter(path => path.startsWith('/v1/account/'))).toEqual([])
  })

  it.each([
    [`/analytics/moments/${STREAM}/20261314T1040Z`],
    [`/analytics/moments/${STREAM}/nonsense`],
    [`/analytics/moments/abc/${MINUTE}`],
  ])('shows the missing state for %s without fetching', async path => {
    serve({ body: feedback() })
    renderPage(path)
    expect(await screen.findByText('This Moment isn’t here')).toBeTruthy()
    expect(calls).toEqual([])
  })
})

describe('Moment watch page ready', () => {
  it('shows the title, the channel link, the Twitch pill at the minute second and the page title', async () => {
    serve({ body: feedback() })
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Moment at 0:40:30' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'fakechan01' }).getAttribute('href')).toBe('/analytics/fakechan01')
    const pill = await screen.findByRole('link', { name: /Watch on Twitch from 0:40:30/ })
    expect(pill.getAttribute('href')).toBe('https://www.twitch.tv/videos/123456789?t=2430s')
    expect(pill.getAttribute('target')).toBe('_blank')
    expect(pill.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByText('No clip of this one yet.')).toBeTruthy()
    expect(document.title).toBe('Moment at 0:40:30 — fakechan01 — StreamPulse')
  })

  it('uses the clip title and a thumbnail link to Twitch when the window has a clip', async () => {
    serve({ body: feedback({ clips: [clip()] }) })
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'fake-pog play' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /fake-pog play/ }).getAttribute('href')).toContain('/clip/FakeClipSlug-1')
    expect(screen.getByText('0:24')).toBeTruthy()
    expect(screen.queryByText('No clip of this one yet.')).toBeNull()
    expect(document.title).toBe('fake-pog play — fakechan01 — StreamPulse')
  })

  it('notes a minute the recap no longer lists, as a note above the grid', async () => {
    serve({ body: feedback() }, { recap: { body: { login: 'fakechan01', streamId: STREAM, topMoments: [] } } })
    renderPage(PATH, FROM_HUB)
    const note = await screen.findByRole('note')
    expect(note.textContent).toBe('This minute is no longer among fakechan01’s top Moments. Its ratings and comments stay here.')
  })

  it('shows the page only once the recap check settles, so the note is there from its first paint', async () => {
    serve({ body: feedback() }, { recap: { body: { login: 'fakechan01', streamId: STREAM, topMoments: [] } } })
    const answer = globalThis.fetch
    let release!: () => void
    const recapHeld = new Promise<void>(resolve => { release = resolve })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/recap')) await recapHeld
      return answer(input, init)
    }))
    const { container } = renderPage(PATH, FROM_HUB)
    await waitFor(() => expect(calls).toContain(`/v1/account/streams/${STREAM}/moments/${MINUTE}/feedback`))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    release()
    await screen.findByRole('heading', { level: 1, name: 'Moment at 0:40:30' })
    expect(screen.getByRole('note')).toBeTruthy()
  })

  it.each([
    ['a bare address', undefined],
    ['the stream page', { from: 'stream' }],
    ['the list with no Moment handed over', { from: 'moments' }],
  ])('says nothing about a minute the recap does not list when opened from %s (it never claimed one)', async (_name, state) => {
    serve({ body: feedback() }, { recap: { body: { login: 'fakechan01', streamId: STREAM, topMoments: [] } } })
    renderPage(PATH, state)
    // The page shows once the recap check has settled.
    await screen.findByRole('heading', { level: 1, name: 'Moment at 0:40:30' })
    expect(calls.some(p => p.endsWith('/recap'))).toBe(true)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it.each(['moments', 'moment'])('notes the dropped minute for a Moment the %s link handed over', async from => {
    serve({ body: feedback() }, { recap: { body: { login: 'fakechan01', streamId: STREAM, topMoments: [] } } })
    renderPage(PATH, { from, moment: { streamId: STREAM, momentAt: MINUTE, offsetSeconds: 2430, login: 'fakechan01', displayName: 'fakechan01' } })
    expect(await screen.findByRole('note')).toBeTruthy()
  })

  it('notes a dropped minute without the ratings line when read-only', async () => {
    serve({ status: 404, body: { error: 'not_found' } }, { source: endedSource(), recap: { body: { login: 'fakechan01', streamId: STREAM, topMoments: [] } } })
    renderPage(PATH, FROM_HUB)
    const note = await screen.findByRole('note')
    expect(note.textContent).toBe('This minute is no longer among fakechan01’s top Moments.')
  })

  it('has no note while the recap still lists the minute', async () => {
    serve({ body: feedback() })
    renderPage()
    await screen.findByRole('link', { name: /Watch on Twitch from/ })
    await waitFor(() => expect(calls.some(p => p.endsWith('/recap'))).toBe(true))
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('asks the live feed, not the recap, while the stream is live', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', 'on')
    serve({ body: feedback({ stream: { ...feedback().stream, endedAt: null } }) })
    renderPage(PATH, FROM_HUB)
    // The recap (asked beside the facts, before the page knows the stream is live) still lists the minute:
    // the feed's miss alone makes the note.
    expect(await screen.findByRole('note')).toBeTruthy()
    expect(calls).toContain('/v1/public/moments')
    expect(feedIds).toHaveLength(2)
  })

  it('renders neither ratings nor comments, nor places for them, when hidden', async () => {
    serve({ body: feedback({ hidden: true }) })
    const { container } = renderPage()
    await screen.findByRole('heading', { level: 1 })
    expect(container.querySelector('[data-slot="rating-row"]')).toBeNull()
    expect(container.querySelector('[data-slot="comments"]')).toBeNull()
    expect(container.querySelector('[data-slot="strip"]')).toBeNull()
  })

  it('leaves the slots for the later pieces when not hidden', async () => {
    serve({ body: feedback() })
    const { container } = renderPage()
    await screen.findByRole('heading', { level: 1 })
    for (const slot of ['strip', 'rating-row', 'comments']) expect(container.querySelector(`[data-slot="${slot}"]`)).not.toBeNull()
  })

  it('names the aside "More Moments from this stream" and links the stream’s other Moments', async () => {
    serve({ body: feedback() }, { recap: { body: { login: 'fakechan01', streamId: STREAM, topMoments: [{ offsetSeconds: 2430 }, { offsetSeconds: 600 }] } } })
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull())
    const aside = screen.getByRole('heading', { level: 2, name: 'More Moments from this stream' }).closest('aside')!
    expect(aside.getAttribute('aria-labelledby')).toBe('mw-upnext-title')
    const link = await within(aside).findByRole('link', { name: /Moment at 0:10:00/ })
    expect(link.getAttribute('href')).toBe(`/analytics/moments/${STREAM}/20261114T1010Z`)
    expect(within(aside).getAllByRole('link')).toHaveLength(1)
  })

  it('switches an alias to the canonical stream path without a second visible failure', async () => {
    const canonical = '9000002'
    serve(path => path.includes(`/streams/${STREAM}/`) ? { body: feedback({ streamId: canonical }) } : { status: 503, body: { error: 'down' } })
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Moment at 0:40:30' })).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/analytics/moments/${canonical}/${MINUTE}`))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
    expect(calls.filter(p => p.endsWith('/feedback'))).toHaveLength(1)
  })

  it('offers All Moments when opened from a link', async () => {
    serve({ body: feedback() })
    renderPage()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByRole('link', { name: 'All Moments' }).getAttribute('href')).toBe('/analytics/moments')
  })

  it('opens a side-list Moment with Back, which goes back one step', async () => {
    serve({ body: feedback() }, { recap: { body: { login: 'fakechan01', streamId: STREAM, topMoments: [{ offsetSeconds: 2430 }, { offsetSeconds: 3000 }] } } })
    renderPage()
    const row = await screen.findByRole('link', { name: 'Moment at 0:50:00' })
    fireEvent.click(row)
    expect(await screen.findByRole('button', { name: 'Back' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'All Moments' })).toBeNull()
  })

  it('does not drop a Moment the feed lists one second earlier (a sub-second server start)', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', 'on')
    serve({ body: liveFeedback() }, { item: id => id.endsWith('-2429') ? { body: { schemaVersion: 1, item: feedItem(2429) } } : { status: 404 } })
    renderPage()
    expect(await screen.findByRole('link', { name: /Watch on Twitch from 0:40:29/ })).toBeTruthy()
    expect(feedIds).toEqual([`pulse-fakechan01-${STREAM}-2430`, `pulse-fakechan01-${STREAM}-2429`])
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Moment at 0:40:29' })).toBeTruthy()
  })

  it('drops the Moment when both lookups miss', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', 'on')
    serve({ body: liveFeedback() })
    renderPage(PATH, FROM_HUB)
    expect(await screen.findByRole('note')).toBeTruthy()
    expect(feedIds).toHaveLength(2)
  })

  it('counts a feed hit only when its minute is the page minute', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', 'on')
    serve({ body: liveFeedback() }, { item: id => ({ body: { schemaVersion: 1, item: { ...feedItem(Number(id.split('-').pop())), minuteStart: Date.parse('2026-11-14T10:41:00Z') } } }) })
    renderPage(PATH, FROM_HUB)
    expect(await screen.findByRole('note')).toBeTruthy()
  })

  it('looks up once when the Moment is at the stream start', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', 'on')
    serve({ body: liveFeedback('2026-11-14T10:40:00Z') })
    renderPage(PATH, FROM_HUB)
    expect(await screen.findByRole('note')).toBeTruthy()
    expect(feedIds).toEqual([`pulse-fakechan01-${STREAM}-0`])
  })

  it('offers no Twitch link or "from" line for a live stream with no VOD (never the bare channel)', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', 'on')
    const live = { channel: 'fakechan01', stream: { streamId: STREAM, channel: 'fakechan01', startedAt: '2026-11-14T09:59:30Z', lifecycleState: 'confirmed_live', lifecycleObservedAt: new Date().toISOString() } }
    serve({ body: liveFeedback() }, { source: live })
    const { container } = renderPage(PATH, FROM_HUB)
    expect(await screen.findByRole('note')).toBeTruthy()
    await waitFor(() => expect(calls).toContain(`/v1/portal/analytics/streams/${STREAM}`))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.queryByText(/Watch on Twitch from/)).toBeNull()
    expect(container.querySelector('a[href="https://www.twitch.tv/fakechan01"]')).toBeNull()
    expect(screen.getByText('No clip of this one yet.')).toBeTruthy()
  })
})

describe('Moment watch page strip', () => {
  it('moves the pill and its "from" text with the second picked on the strip', async () => {
    serve({ body: feedback() })
    renderPage()
    const range = await screen.findByRole('slider', { name: 'Second in the stream' })
    await screen.findByRole('link', { name: /Watch on Twitch from 0:40:30/ })
    fireEvent.keyDown(range, { key: 'ArrowRight' })
    fireEvent.keyDown(range, { key: 'ArrowRight' })
    const pill = await screen.findByRole('link', { name: /Watch on Twitch from 0:40:32/ })
    expect(pill.getAttribute('href')).toBe('https://www.twitch.tv/videos/123456789?t=2432s')
    expect(screen.getByRole('heading', { level: 1, name: 'Moment at 0:40:30' })).toBeTruthy()
    expect(document.title).toBe('Moment at 0:40:30 — fakechan01 — StreamPulse')
  })

  it('shows the new minute’s start, not the old pick, after the canonical Moment changes', async () => {
    serve(path => ({ body: feedback(path.includes('/20261114T1041Z/') ? { momentAt: '2026-11-14T10:41:00Z' } : {}) }))
    function Go() { const navigate = useNavigate(); return <button type="button" onClick={() => navigate(`/analytics/moments/${STREAM}/20261114T1041Z`)}>go next</button> }
    render(
      <MemoryRouter initialEntries={[`/analytics/moments/${STREAM}/${MINUTE}`]}>
        <Go />
        <Routes><Route path="/analytics/moments/:streamId/:momentAt" element={<MomentWatchPage />} /></Routes>
      </MemoryRouter>,
    )
    const range = await screen.findByRole('slider', { name: 'Second in the stream' })
    expect(range.getAttribute('aria-valuetext')).toBe('0:40:30')
    fireEvent.keyDown(range, { key: 'ArrowRight' })
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('0:40:31')
    fireEvent.click(screen.getByRole('button', { name: 'go next' }))
    await screen.findByRole('heading', { level: 1, name: 'Moment at 0:41:30' })
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('0:41:30')
  })
})

describe('Moment watch page ratings', () => {
  const RATING = `/v1/account/streams/${STREAM}/moments/${MINUTE}/rating`
  const signedIn = (verdict: string | null = null, canWrite = true) => ({ signedIn: true, canWrite, verdict })
  type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  let writes: Array<{ method: string; body: string | undefined }>
  /** Serves the page, and answers the rating route with `rate`. */
  function serveRating(base: Record<string, unknown>, rate: (method: string) => Answer | Promise<Response>) {
    serve({ body: base })
    const page = globalThis.fetch as unknown as Fetch
    writes = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input), 'http://localhost').pathname === RATING) {
        const method = init?.method ?? 'GET'
        writes.push({ method, body: init?.body as string | undefined })
        const a = rate(method)
        if (a instanceof Promise) return a
        return Response.json(a.body ?? {}, { status: a.status ?? 200 })
      }
      return page(input, init)
    }))
  }
  const live = () => document.querySelector('p.sr-only[role="status"]')?.textContent

  it('asks "Real moment?" with Yes and No as a pressed-state group, and the tally', async () => {
    serve({ body: feedback({ ratings: { yes: 6, total: null, share: null }, you: signedIn('real') }) })
    renderPage()
    const group = await screen.findByRole('group', { name: 'Real moment?' })
    expect(document.getElementById('real-q')?.textContent).toBe('Real moment?')
    expect(group.getAttribute('aria-labelledby')).toBe('real-q')
    expect(screen.getByRole('button', { name: 'Yes' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'No' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('6 said yes')).toBeTruthy()
  })

  it('shows the share and count from 10 ratings', async () => {
    serve({ body: feedback({ ratings: { yes: 14, total: 18, share: 0.78 } }) })
    renderPage()
    expect(await screen.findByText('78% said yes · 18 ratings')).toBeTruthy()
  })

  it('sends PUT {"verdict":"real"} on Yes, shows the answer’s tally, and DELETE on a second press', async () => {
    serveRating(feedback({ you: signedIn() }), method => method === 'PUT'
      ? { body: feedback({ ratings: { yes: 7, total: null, share: null }, you: signedIn('real') }) }
      : { body: feedback({ ratings: { yes: 6, total: null, share: null }, you: signedIn() }) })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Yes' }))
    expect(await screen.findByText('7 said yes')).toBeTruthy()
    expect(writes).toEqual([{ method: 'PUT', body: '{"verdict":"real"}' }])
    expect(screen.getByRole('button', { name: 'Yes' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(await screen.findByText('6 said yes')).toBeTruthy()
    expect(writes[1]).toEqual({ method: 'DELETE', body: undefined })
    expect(screen.getByRole('button', { name: 'Yes' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('disables both rating buttons while a save is in flight, then enables them', async () => {
    let release: (r: Response) => void = () => {}
    serveRating(feedback({ you: signedIn() }), () => new Promise<Response>(resolve => { release = resolve }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Yes' }))
    expect((screen.getByRole('button', { name: 'Yes' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'No' }) as HTMLButtonElement).disabled).toBe(true)
    release(Response.json(feedback({ you: signedIn('real') })))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Yes' }) as HTMLButtonElement).disabled).toBe(false))
    expect((screen.getByRole('button', { name: 'No' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the pressed state at once, before the answer', async () => {
    let release: (r: Response) => void = () => {}
    serveRating(feedback({ you: signedIn() }), () => new Promise<Response>(resolve => { release = resolve }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'No' }))
    expect(screen.getByRole('button', { name: 'No' }).getAttribute('aria-pressed')).toBe('true')
    release(Response.json(feedback({ you: signedIn('not_real') })))
    await waitFor(() => expect(live()).toBe('You said no.'))
  })

  it('restores the previous press on an error and says so in the live region', async () => {
    serveRating(feedback({ you: signedIn('not_real') }), () => ({ status: 503, body: { error: 'down' } }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(live()).toBe('Your rating didn’t save. Try again.'))
    expect(screen.getByRole('button', { name: 'No' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Yes' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('ignores a press while one is in flight', async () => {
    let release: (r: Response) => void = () => {}
    serveRating(feedback({ you: signedIn() }), () => new Promise<Response>(resolve => { release = resolve }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Yes' }))
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(writes).toHaveLength(1)
    release(Response.json(feedback({ you: signedIn('real') })))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Yes' }).getAttribute('aria-pressed')).toBe('true'))
    expect(writes).toHaveLength(1)
  })

  it('shows the sign-in prompt only after a signed-out press, with the Moment page as the return path, and sends nothing', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
    serveRating(feedback(), () => ({ body: feedback() }))
    renderPage()
    await screen.findByRole('group', { name: 'Real moment?' })
    expect(screen.queryByText('Sign in with Twitch to rate or comment.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    const text = await screen.findByText('Sign in with Twitch to rate or comment.')
    expect(text.closest('[role="status"]')).not.toBeNull()
    // The thread shows its own panel too; both return to this page.
    const links = screen.getAllByRole('link', { name: 'Sign in with Twitch' })
    expect(links).toHaveLength(2)
    for (const link of links) expect(decodeURIComponent(link.getAttribute('href') ?? '')).toContain(`/analytics/moments/${STREAM}/${MINUTE}`)
    expect(writes).toEqual([])
    expect(screen.getByRole('button', { name: 'No' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('shows the Twitch prompt after a 403 twitch_required', async () => {
    serveRating(feedback({ you: signedIn() }), () => ({ status: 403, body: { error: 'twitch_required' } }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Yes' }))
    expect(await screen.findByText('Link your Twitch account to rate or comment.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Link Twitch' }).getAttribute('href')).toBe('/account/settings')
    expect(screen.getByRole('button', { name: 'Yes' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('shows the Twitch prompt for a press while signed in without write access, and sends nothing', async () => {
    serveRating(feedback({ you: signedIn(null, false) }), () => ({ body: feedback() }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Yes' }))
    // The rating's ask and the thread's own panel both say it.
    await waitFor(() => expect(screen.getAllByText('Link your Twitch account to rate or comment.')).toHaveLength(2))
    expect(writes).toEqual([])
  })

  it('keeps the answer’s rating until the canonical Moment changes', async () => {
    serveRating(feedback({ you: signedIn() }), () => ({ body: feedback({ ratings: { yes: 9, total: null, share: null }, you: signedIn('real') }) }))
    function Go() { const navigate = useNavigate(); return <button type="button" onClick={() => navigate(`/analytics/moments/${STREAM}/20261114T1041Z`)}>go next</button> }
    const base = globalThis.fetch as unknown as Fetch
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname
      if (path.includes('/20261114T1041Z/') && path.endsWith('/feedback')) return Promise.resolve(Response.json(feedback({ momentAt: '2026-11-14T10:41:00Z', you: signedIn() })))
      return base(input, init)
    }))
    render(
      <MemoryRouter initialEntries={[`/analytics/moments/${STREAM}/${MINUTE}`]}>
        <Go />
        <Routes><Route path="/analytics/moments/:streamId/:momentAt" element={<MomentWatchPage />} /></Routes>
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Yes' }))
    expect(await screen.findByText('9 said yes')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'go next' }))
    await screen.findByRole('heading', { level: 1, name: 'Moment at 0:41:30' })
    expect(screen.getByText('3 said yes')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Yes' }).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('Moment watch page fresh reads', () => {
  it('shows the fresh read, no prompt and the minute start after A, B, A', async () => {
    const B = '20261114T1041Z'
    const ratingPath = `/v1/account/streams/${STREAM}/moments/${MINUTE}/rating`
    const mine = (verdict: string | null) => ({ signedIn: true, canWrite: false, verdict })
    serve(path => path.includes(`/${B}/`) ? { body: feedback({ momentAt: '2026-11-14T10:41:00Z', you: mine(null) }) } : { body: feedback({ you: { signedIn: true, canWrite: true, verdict: null } }) })
    const page = globalThis.fetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input), 'http://localhost').pathname === ratingPath) {
        return Response.json(feedback({ ratings: { yes: 9, total: null, share: null }, you: { signedIn: true, canWrite: true, verdict: 'real' } }))
      }
      return page(input, init)
    }))
    function Go() { const navigate = useNavigate(); return (<><button type="button" onClick={() => navigate(`/analytics/moments/${STREAM}/${B}`)}>go B</button><button type="button" onClick={() => navigate(`/analytics/moments/${STREAM}/${MINUTE}`)}>go A</button></>) }
    render(
      <MemoryRouter initialEntries={[`/analytics/moments/${STREAM}/${MINUTE}`]}>
        <Go />
        <Routes><Route path="/analytics/moments/:streamId/:momentAt" element={<MomentWatchPage />} /></Routes>
      </MemoryRouter>,
    )
    const range = await screen.findByRole('slider', { name: 'Second in the stream' })
    fireEvent.keyDown(range, { key: 'ArrowRight' })
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('0:40:31')
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(await screen.findByText('9 said yes')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'go B' }))
    await screen.findByRole('heading', { level: 1, name: 'Moment at 0:41:30' })
    // B: signed in without write access, so a press asks for the Twitch link (the thread says it too).
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(screen.getAllByText('Link your Twitch account to rate or comment.')).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: 'go A' }))
    await screen.findByRole('heading', { level: 1, name: 'Moment at 0:40:30' })
    expect(screen.getByText('3 said yes')).toBeTruthy()
    expect(screen.queryByText('9 said yes')).toBeNull()
    expect(screen.queryByText('Link your Twitch account to rate or comment.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Yes' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('0:40:30')
  })
})

describe('Moment watch page clip rows', () => {
  it('shows a Twitch clip row with the length and the window, and no rating buttons', async () => {
    const c = { ...clip(), durationSeconds: 28, from: '2026-11-14T10:39:52Z', to: '2026-11-14T10:40:20Z' }
    serve({ body: feedback({ clips: [c] }) })
    renderPage()
    expect(await screen.findByText('Twitch clip')).toBeTruthy()
    expect(screen.getByText('0:28 · 0:40:22 to 0:40:50')).toBeTruthy()
    const row = screen.getByText('Twitch clip').closest('.mw-clip-row') as HTMLElement
    expect(row.querySelectorAll('button')).toHaveLength(0)
  })

  it('renders one row per clip, in order, and none when there is no clip', async () => {
    const a = { ...clip(), id: 'FakeClipSlug-1', durationSeconds: 24, from: '2026-11-14T10:39:30Z', to: '2026-11-14T10:40:30Z' }
    const b = { ...clip(), id: 'FakeClipSlug-2', url: 'https://www.twitch.tv/fakechan01/clip/FakeClipSlug-2', durationSeconds: 10, from: '2026-11-14T10:41:00Z', to: '2026-11-14T10:41:10Z' }
    serve({ body: feedback({ clips: [a, b] }) })
    const { container } = renderPage()
    await screen.findAllByText('Twitch clip')
    const rows = [...container.querySelectorAll('.mw-clip-row')].map(r => r.textContent)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('0:24 · 0:40:00 to 0:41:00')
    expect(rows[1]).toContain('0:10 · 0:41:30 to 0:41:40')
  })

  it('renders no clip row without clips', async () => {
    serve({ body: feedback() })
    const { container } = renderPage()
    await screen.findByRole('group', { name: 'Real moment?' })
    expect(container.querySelector('.mw-clip-row')).toBeNull()
  })
})

describe('Moment watch page comments', () => {
  const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const author = { login: 'fakeviewer1', displayName: 'FakeViewer1', profileImageUrl: '' }
  const cm = (n: number, over: Record<string, unknown> = {}) => ({
    id: U(n), at: '2026-11-14T10:40:01Z', body: `fake comment ${n}`, createdAt: '2026-11-14T10:41:00Z',
    author, mine: false, reportedByYou: false, ...over,
  })
  const page = (items: unknown[], total = items.length, nextCursor?: string) => ({ schemaVersion: 1, items, total, ...(nextCursor ? { nextCursor } : {}) })
  const writer = { signedIn: true, canWrite: true, verdict: null }
  type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  let sent: Array<{ method: string; path: string; search: string; body: string | undefined }>
  /** Serves the page, and answers the comment routes with `answer`. */
  function serveComments(base: Record<string, unknown>, answer: (req: { method: string; path: string; cursor: string | null }) => Answer | Promise<Response>) {
    serve({ body: base })
    const rest = globalThis.fetch as unknown as Fetch
    sent = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname.includes('/comments') || url.pathname.includes('/stream-comments/')) {
        const method = init?.method ?? 'GET'
        sent.push({ method, path: url.pathname, search: url.search, body: init?.body as string | undefined })
        const a = answer({ method, path: url.pathname, cursor: url.searchParams.get('cursor') })
        if (a instanceof Promise) return a
        return a.status === 204 ? new Response(null, { status: 204 }) : Response.json(a.body ?? {}, { status: a.status ?? 200 })
      }
      return rest(input, init)
    }))
  }
  const live = () => document.querySelector('p.sr-only[role="status"]')?.textContent
  const press = (key: string, times: number) => { for (let i = 0; i < times; i++) fireEvent.keyDown(screen.getByRole('slider'), { key }) }

  it('shows the count from the list answer, the subline, and "1 comment" for one', async () => {
    serveComments(feedback({ comments: { total: 5 } }), () => ({ body: page([cm(1)], 12) }))
    renderPage()
    expect(await screen.findByRole('heading', { level: 2, name: '12 comments' })).toBeTruthy()
    expect(screen.getByText('Pinned between 0:35:30 and 0:45:30 · newest first')).toBeTruthy()
    cleanup()
    serveComments(feedback({ comments: { total: 1 } }), () => ({ body: page([cm(1)], 1) }))
    renderPage()
    expect(await screen.findByRole('heading', { level: 2, name: '1 comment' })).toBeTruthy()
  })

  it('lists over the page window and falls back to the feedback count before the first page', async () => {
    let release: (r: Response) => void = () => {}
    serveComments(feedback({ comments: { total: 7 } }), () => new Promise<Response>(resolve => { release = resolve }))
    renderPage()
    expect(await screen.findByRole('heading', { level: 2, name: '7 comments' })).toBeTruthy()
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].path).toContain(`/streams/${STREAM}/comments`)
    expect(decodeURIComponent(sent[0].search)).toBe('?from=2026-11-14T10:35:00Z&to=2026-11-14T10:45:00Z')
    release(Response.json(page([], 0)))
    expect(await screen.findByText('No comments here yet.')).toBeTruthy()
  })

  it('shows the writing box for an account that can write, and a post goes first with the picked second', async () => {
    serveComments(feedback({ you: writer, comments: { total: 1 } }), ({ method }) => method === 'POST'
      ? { body: cm(2, { at: '2026-11-14T10:40:12Z', body: 'fake new take', mine: true }) } : { body: page([cm(1)], 1) })
    renderPage()
    const box = await screen.findByRole('textbox', { name: 'Your comment' })
    expect(box.getAttribute('placeholder')).toBe('Add a comment at 0:40:30')
    press('ArrowRight', 12)
    expect(box.getAttribute('placeholder')).toBe('Add a comment at 0:40:42')
    expect(screen.getByText('at 0:40:42')).toBeTruthy()
    expect(screen.getByText('0/280')).toBeTruthy()
    const send = screen.getByRole('button', { name: 'Comment' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Pick another second on the strip' }))
    expect(document.activeElement).toBe(screen.getByRole('slider'))
    fireEvent.change(box, { target: { value: '  fake new take  ' } })
    expect(screen.getByText('13/280')).toBeTruthy()
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: '2 comments' })).toBeTruthy())
    const post = sent.find(r => r.method === 'POST')!
    expect(post.body).toBe('{"at":"2026-11-14T10:40:12Z","body":"fake new take"}')
    const items = screen.getAllByRole('listitem').filter(li => li.textContent?.includes('fake'))
    expect(items[0].textContent).toContain('fake new take')
    expect(items[1].textContent).toContain('fake comment 1')
    expect((box as HTMLTextAreaElement).value).toBe('')
    expect(live()).toBe('Comment posted.')
  })

  it('stops input at 280 characters and 3 lines, with no blank line', async () => {
    serveComments(feedback({ you: writer }), () => ({ body: page([]) }))
    renderPage()
    const box = await screen.findByRole('textbox', { name: 'Your comment' }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'a'.repeat(300) } })
    expect([...box.value]).toHaveLength(280)
    expect(screen.getByText('280/280')).toBeTruthy()
    fireEvent.change(box, { target: { value: '😀'.repeat(300) } })
    expect([...box.value]).toHaveLength(280)
    fireEvent.change(box, { target: { value: 'a\r\nb\n  \n\nc\nd\ne' } })
    expect(box.value).toBe('a\nb\nc')
  })

  it('shows the shared sign-in panel signed out, and the link variant without write access', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
    serveComments(feedback({ comments: { total: 1 } }), () => ({ body: page([cm(1)]) }))
    renderPage()
    expect(await screen.findByText('Sign in with Twitch to rate Moments and comment.')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    const link = screen.getByRole('link', { name: 'Sign in with Twitch' })
    expect(decodeURIComponent(link.getAttribute('href') ?? '')).toContain(`/analytics/moments/${STREAM}/${MINUTE}`)
    await screen.findByText('fake comment 1')
    expect(screen.queryByRole('button', { name: 'Report' })).toBeNull()
    cleanup()
    serveComments(feedback({ you: { signedIn: true, canWrite: false, verdict: null }, comments: { total: 1 } }), () => ({ body: page([cm(1)]) }))
    renderPage()
    expect(await screen.findByText('Link your Twitch account to rate or comment.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Link Twitch' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Report' })).toBeTruthy()
  })

  it('sets the strip’s second and focuses the comment from its time button, and pins the strip', async () => {
    serveComments(feedback(), () => ({ body: page([cm(1, { at: '2026-11-14T10:40:01Z' }), cm(2, { at: '2026-11-14T10:40:01Z' }), cm(3, { at: '2026-11-14T10:39:00Z' })]) }))
    renderPage()
    const buttons = await screen.findAllByRole('button', { name: 'at 0:40:31, show on the strip' })
    expect(buttons).toHaveLength(2)
    expect(buttons[0].textContent).toBe('at 0:40:31')
    fireEvent.click(buttons[0])
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('0:40:31')
    expect(document.activeElement).toBe(buttons[0].closest('li'))
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1')
    // Two comments in one second make one pin; the other makes a second.
    expect(screen.getAllByRole('button', { name: /^Comment at / }).map(b => b.getAttribute('aria-label'))).toEqual(['Comment at 0:39:30', 'Comment at 0:40:31'])
  })

  it('shows (you) and Delete on your own comment, asks first, and removes it', async () => {
    serveComments(feedback({ you: { signedIn: true, canWrite: false, verdict: null }, comments: { total: 2 } }), ({ method }) => method === 'DELETE'
      ? { status: 204 } : { body: page([cm(1, { mine: true }), cm(2)], 2) })
    renderPage()
    expect(await screen.findByText('(you)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Delete your comment?')).toBeTruthy()
    expect(sent.some(r => r.method === 'DELETE')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Delete your comment?')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Delete your comment?')).toBeTruthy()
    // The first Delete is the asking button's replacement: the confirming one.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('fake comment 1')).toBeNull())
    expect(sent.find(r => r.method === 'DELETE')!.path).toContain(U(1))
    expect(screen.getByRole('heading', { level: 2, name: '1 comment' })).toBeTruthy()
    expect(live()).toBe('Comment deleted.')
  })

  it('reports with a reason, then shows "Reported. Thanks."; a reported comment shows it at once', async () => {
    serveComments(feedback({ you: writer }), ({ method }) => method === 'POST' ? { status: 204 } : { body: page([cm(1), cm(2, { reportedByYou: true })], 2) })
    renderPage()
    const onComments = () => screen.queryAllByText('Reported. Thanks.').filter(el => el.closest('li'))
    const report = await screen.findByRole('button', { name: 'Report' })
    expect(onComments()).toHaveLength(1)
    fireEvent.click(report)
    expect(screen.getByRole('button', { name: 'Spam' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Something else' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Abuse or harassment' }))
    await waitFor(() => expect(onComments()).toHaveLength(2))
    expect(live()).toBe('Reported. Thanks.')
    expect(sent.find(r => r.method === 'POST')!.body).toBe('{"reason":"abuse"}')
    expect(screen.queryByRole('button', { name: 'Report' })).toBeNull()
  })

  it('says to try again later on a 429, and sets a status on any other failed post', async () => {
    serveComments(feedback({ you: writer }), ({ method }) => method === 'POST' ? { status: 429, body: { error: 'try_later', retryAfterSeconds: 42 } } : { body: page([]) })
    renderPage()
    const box = await screen.findByRole('textbox', { name: 'Your comment' })
    fireEvent.change(box, { target: { value: 'fake take' } })
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    expect(await screen.findByText('Too many comments for now. Try again in 42 s.')).toBeTruthy()
    expect((box as HTMLTextAreaElement).value).toBe('fake take')
    cleanup()
    serveComments(feedback({ you: writer }), ({ method }) => method === 'POST' ? { status: 503, body: { error: 'down' } } : { body: page([]) })
    renderPage()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your comment' }), { target: { value: 'fake take' } })
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    expect(await screen.findByText('Your comment didn’t post. Try again.')).toBeTruthy()
    // The hint is the one place it is said: the page's own status region stays quiet.
    expect(live()).toBe('')
  })

  it('asks for the Twitch link after a 403 twitch_required on a post', async () => {
    serveComments(feedback({ you: writer }), ({ method }) => method === 'POST' ? { status: 403, body: { error: 'twitch_required' } } : { body: page([]) })
    renderPage()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your comment' }), { target: { value: 'fake take' } })
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    expect(await screen.findByText('Link your Twitch account to rate or comment.')).toBeTruthy()
  })

  it('loads the next page from the cursor with Show more comments', async () => {
    serveComments(feedback(), ({ cursor }) => cursor ? { body: page([cm(3)], 3) } : { body: page([cm(1), cm(2)], 3, 'cursor_2') })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Show more comments' }))
    expect(await screen.findByText('fake comment 3')).toBeTruthy()
    expect(sent[1].search).toContain('cursor=cursor_2')
    expect(screen.queryByRole('button', { name: 'Show more comments' })).toBeNull()
  })

  it('shows the empty line, and Comments didn’t load with Try again', async () => {
    serveComments(feedback(), () => ({ body: page([]) }))
    renderPage()
    expect(await screen.findByText('No comments here yet.')).toBeTruthy()
    cleanup()
    let fail = true
    serveComments(feedback(), () => fail ? { status: 503, body: { error: 'down' } } : { body: page([cm(1)]) })
    renderPage()
    const text = await screen.findByText(/Comments didn’t load\./)
    expect(text.closest('[role="status"]')).not.toBeNull()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('fake comment 1')).toBeTruthy()
  })

  it('never lets a late answer for the old Moment land in the new one', async () => {
    const B = '20261114T1041Z'
    let releaseA: (r: Response) => void = () => {}
    serveComments(feedback(), () => new Promise<Response>(resolve => { releaseA = resolve }))
    const base = globalThis.fetch as unknown as Fetch
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname.includes(`/${B}/`) && url.pathname.endsWith('/feedback')) return Promise.resolve(Response.json(feedback({ momentAt: '2026-11-14T10:41:00Z', window: { from: '2026-11-14T10:36:00Z', to: '2026-11-14T10:46:00Z' } })))
      if (url.pathname.endsWith('/comments') && url.searchParams.get('from') === '2026-11-14T10:36:00Z') return Promise.resolve(Response.json(page([cm(9, { body: 'fake new moment comment' })])))
      return base(input, init)
    }))
    function Go() { const navigate = useNavigate(); return <button type="button" onClick={() => navigate(`/analytics/moments/${STREAM}/${B}`)}>go next</button> }
    render(
      <MemoryRouter initialEntries={[`/analytics/moments/${STREAM}/${MINUTE}`]}>
        <Go />
        <Routes><Route path="/analytics/moments/:streamId/:momentAt" element={<MomentWatchPage />} /></Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { level: 2, name: /comments?$/ })
    fireEvent.click(screen.getByRole('button', { name: 'go next' }))
    expect(await screen.findByText('fake new moment comment')).toBeTruthy()
    releaseA(Response.json(page([cm(1, { body: 'fake old moment comment' })])))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.queryByText('fake old moment comment')).toBeNull()
    expect(screen.getByText('fake new moment comment')).toBeTruthy()
  })

  // ---- Fix round 1 ----
  const sleep = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms))
  const deferred = () => { let release: (r: Response) => void = () => {}; const promise = new Promise<Response>(resolve => { release = resolve }); return { promise, release: (r: Response) => release(r) } }
  const ok204 = () => new Response(null, { status: 204 })

  describe('across Moments', () => {
    const B = '20261114T1041Z'
    /** Page A with a held write; B is a different Moment with its own count, rating and no comments. */
    async function startOnA(kind: 'post' | 'delete' | 'report' | 'post403') {
      const held = deferred()
      serveComments(feedback({ you: writer, comments: { total: 3 } }), ({ method }) => method === 'GET' ? { body: page([cm(1, { mine: kind === 'delete' })], 3) } : held.promise)
      const base = globalThis.fetch as unknown as Fetch
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), 'http://localhost')
        if (url.pathname.includes(`/${B}/`) && url.pathname.endsWith('/feedback')) {
          return Promise.resolve(Response.json(feedback({ momentAt: '2026-11-14T10:41:00Z', window: { from: '2026-11-14T10:36:00Z', to: '2026-11-14T10:46:00Z' }, you: writer, comments: { total: 8 } })))
        }
        if (url.pathname.endsWith('/comments') && url.searchParams.get('from') === '2026-11-14T10:36:00Z') return Promise.resolve(Response.json(page([], 8)))
        return base(input, init)
      }))
      function Go() { const navigate = useNavigate(); return <button type="button" onClick={() => navigate(`/analytics/moments/${STREAM}/${B}`)}>go next</button> }
      render(
        <MemoryRouter initialEntries={[`/analytics/moments/${STREAM}/${MINUTE}`]}>
          <Go />
          <Routes><Route path="/analytics/moments/:streamId/:momentAt" element={<MomentWatchPage />} /></Routes>
        </MemoryRouter>,
      )
      await screen.findByText('fake comment 1')
      if (kind === 'post' || kind === 'post403') {
        fireEvent.change(screen.getByRole('textbox', { name: 'Your comment' }), { target: { value: 'fake take' } })
        fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
      } else if (kind === 'delete') {
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Report' }))
        fireEvent.click(screen.getByRole('button', { name: 'Spam' }))
      }
      await waitFor(() => expect(sent.some(r => r.method !== 'GET')).toBe(true))
      fireEvent.click(screen.getByRole('button', { name: 'go next' }))
      await screen.findByRole('heading', { level: 2, name: '8 comments' })
      return held
    }

    it.each(['post', 'delete', 'report'] as const)('leaves B’s count, status and ask alone when A’s %s answer arrives late', async kind => {
      const held = await startOnA(kind)
      expect(screen.getByText('3 said yes')).toBeTruthy()
      held.release(kind === 'post' ? Response.json(cm(5, { mine: true })) : ok204())
      await sleep()
      expect(screen.getByRole('heading', { level: 2, name: '8 comments' })).toBeTruthy()
      expect(screen.getByText('3 said yes')).toBeTruthy()
      expect(live()).toBe('')
      expect(screen.queryByText(/Link your Twitch account/)).toBeNull()
      expect(screen.queryByText('fake take')).toBeNull()
    })

    it('does not let A’s late 403 replace B’s sign-in ask', async () => {
      const held = await startOnA('post403')
      held.release(Response.json({ error: 'twitch_required' }, { status: 403 }))
      await sleep()
      expect(screen.queryByText(/Link your Twitch account/)).toBeNull()
      expect(live()).toBe('')
    })
  })

  describe('the count', () => {
    it('is right after two quick deletes', async () => {
      const first = deferred()
      const second = deferred()
      const waiting = [first, second]
      serveComments(feedback({ you: writer, comments: { total: 5 } }), ({ method }) => method === 'DELETE' ? waiting.shift()!.promise : { body: page([cm(1, { mine: true }), cm(2, { mine: true })], 5) })
      renderPage()
      await screen.findByText('fake comment 2')
      const li = (n: number) => screen.getByText(`fake comment ${n}`).closest('li') as HTMLElement
      fireEvent.click(within(li(1)).getByRole('button', { name: 'Delete' }))
      fireEvent.click(within(li(1)).getByRole('button', { name: 'Delete' }))
      fireEvent.click(within(li(2)).getByRole('button', { name: 'Delete' }))
      fireEvent.click(within(li(2)).getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(sent.filter(r => r.method === 'DELETE')).toHaveLength(2))
      second.release(ok204())
      await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: '4 comments' })).toBeTruthy())
      first.release(ok204())
      await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: '3 comments' })).toBeTruthy())
    })

    it('counts a post that resolves before the first page once, and keeps it on top', async () => {
      const firstPage = deferred()
      serveComments(feedback({ you: writer, comments: { total: 5 } }), ({ method }) => method === 'POST' ? { body: cm(9, { mine: true, body: 'fake early take' }) } : firstPage.promise)
      renderPage()
      fireEvent.change(await screen.findByRole('textbox', { name: 'Your comment' }), { target: { value: 'fake early take' } })
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
      expect(await screen.findByRole('heading', { level: 2, name: '6 comments' })).toBeTruthy()
      firstPage.release(Response.json(page([cm(1), cm(2)], 5)))
      expect(await screen.findByText('fake comment 2')).toBeTruthy()
      expect(screen.getByRole('heading', { level: 2, name: '6 comments' })).toBeTruthy()
      const bodies = screen.getAllByRole('listitem').map(l => l.textContent ?? '').filter(t => t.includes('fake'))
      expect(bodies[0]).toContain('fake early take')
      expect(bodies).toHaveLength(3)
    })

    it('does not move after a failed post or a failed delete', async () => {
      serveComments(feedback({ you: writer, comments: { total: 3 } }), ({ method }) => method === 'GET' ? { body: page([cm(1, { mine: true })], 3) } : { status: 503, body: { error: 'down' } })
      renderPage()
      fireEvent.change(await screen.findByRole('textbox', { name: 'Your comment' }), { target: { value: 'fake take' } })
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
      expect(await screen.findByText('Your comment didn’t post. Try again.')).toBeTruthy()
      expect(screen.getByRole('heading', { level: 2, name: '3 comments' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(live()).toBe('Your comment didn’t delete. Try again.'))
      expect(screen.getByRole('heading', { level: 2, name: '3 comments' })).toBeTruthy()
      expect(screen.getByText('fake comment 1')).toBeTruthy()
    })
  })

  describe('focus', () => {
    it('moves into the Delete panel, back to Delete on Cancel', async () => {
      serveComments(feedback({ you: writer }), () => ({ body: page([cm(1, { mine: true })]) }))
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
      expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Delete your comment?' }))
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }))
    })

    it('Escape closes the Delete confirm and the Report panel, and focus goes back to their openers', async () => {
      serveComments(feedback({ you: writer }), () => ({ body: page([cm(1, { mine: true }), cm(2)]) }))
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
      fireEvent.keyDown(screen.getByRole('group', { name: 'Delete your comment?' }), { key: 'Escape' })
      expect(screen.queryByRole('group', { name: 'Delete your comment?' })).toBeNull()
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }))
      fireEvent.click(screen.getByRole('button', { name: 'Report' }))
      fireEvent.keyDown(screen.getByRole('button', { name: 'Spam' }), { key: 'Escape' })
      expect(screen.queryByRole('group', { name: 'Why report it?' })).toBeNull()
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Report' }))
    })

    it('moves into the Report panel, back to Report on Cancel, and to the comment after a report', async () => {
      serveComments(feedback({ you: writer }), ({ method }) => method === 'POST' ? { status: 204 } : { body: page([cm(1)]) })
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: 'Report' }))
      expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Why report it?' }))
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Report' }))
      fireEvent.click(screen.getByRole('button', { name: 'Report' }))
      fireEvent.click(screen.getByRole('button', { name: 'Spam' }))
      await waitFor(() => expect(live()).toBe('Reported. Thanks.'))
      expect(document.activeElement).toBe(screen.getByText('fake comment 1').closest('li'))
    })
  })

  describe('the typed text', () => {
    const box = async () => await screen.findByRole('textbox', { name: 'Your comment' }) as HTMLTextAreaElement
    const code = (...points: number[]) => String.fromCharCode(...points)

    it('strips bidi overrides and control characters but keeps newlines, and counts NFC', async () => {
      serveComments(feedback({ you: writer }), () => ({ body: page([]) }))
      renderPage()
      const input = await box()
      fireEvent.change(input, { target: { value: `a${code(0x202e)}b${code(0x2066)}c${code(1)}d${code(9)}e\nf` } })
      expect(input.value).toBe('abcde\nf')
      fireEvent.change(input, { target: { value: `e${code(0x301)}` } })
      expect(screen.getByText('1/280')).toBeTruthy()
    })

    it('counts the cleaned text: blank lines at the ends cost no line', async () => {
      serveComments(feedback({ you: writer }), () => ({ body: page([]) }))
      renderPage()
      const input = await box()
      fireEvent.change(input, { target: { value: '\na\nb\nc\n' } })
      expect(input.value).toBe('\na\nb\nc\n')
      expect(screen.getByText('5/280')).toBeTruthy()
      fireEvent.change(input, { target: { value: '\na\nb\nc\nd' } })
      expect(input.value).toBe('a\nb\nc')
    })

    it('never lets a character that NFC expands carry the cleaned draft past 280', async () => {
      serveComments(feedback({ you: writer }), ({ method }) => method === 'POST' ? { body: cm(2, { mine: true }) } : { body: page([]) })
      renderPage()
      const input = await box()
      fireEvent.change(input, { target: { value: code(0xfb2c).repeat(280) } })
      expect([...input.value].length).toBeLessThanOrEqual(280)
      expect(input.value).toBe(input.value.normalize('NFC'))
      expect(screen.getByText(`${[...input.value.trim()].length}/280`)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
      await waitFor(() => expect(sent.some(r => r.method === 'POST')).toBe(true))
      expect([...JSON.parse(sent.find(r => r.method === 'POST')!.body!).body].length).toBeLessThanOrEqual(280)
    })
  })

  describe('the second a comment may sit at (R85, R91)', () => {
    const range = () => screen.getByRole('slider', { name: 'Second in the stream' }) as HTMLInputElement
    const started = (startedAt: string, over: Record<string, unknown> = {}) => feedback({ stream: { ...feedback().stream, startedAt }, you: writer, ...over })
    const postedAt = () => JSON.parse(sent.find(r => r.method === 'POST')!.body!).at as string
    const post = async () => {
      fireEvent.change(await screen.findByRole('textbox', { name: 'Your comment' }), { target: { value: 'fake take' } })
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
      await waitFor(() => expect(sent.some(r => r.method === 'POST')).toBe(true))
    }

    it('starts the first minute of a stream that began at :30 at the stream start: 0:00:00, t=0s, the strip min', async () => {
      const began = '2026-11-14T10:40:30Z'
      serveComments(started(began), ({ method }) => method === 'POST' ? { body: cm(2, { at: began, mine: true }) } : { body: page([]) })
      // The stream begins at 10:40:30; the Moment is its offset-0 minute, 10:40:00.
      const orig = globalThis.fetch as unknown as Fetch
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), 'http://localhost')
        if (url.pathname === `/v1/portal/analytics/streams/${STREAM}`) return Response.json({ ...source(), stream: { ...source().stream, startedAt: began } })
        return orig(input, init)
      }))
      renderPage()
      const pill = await screen.findByRole('link', { name: /Watch on Twitch from 0:00:00/ })
      expect(pill.getAttribute('href')).toBe('https://www.twitch.tv/videos/123456789?t=0s')
      expect(range().getAttribute('min')).toBe(String(Date.parse(began)))
      expect(range().value).toBe(String(Date.parse(began)))
      expect(range().getAttribute('aria-valuetext')).toBe('0:00:00')
      expect(screen.getByRole('textbox', { name: 'Your comment' }).getAttribute('placeholder')).toBe('Add a comment at 0:00:00')
      await post()
      expect(postedAt()).toBe(began)
    })

    it('clamps a pin at the window end to its last whole second, on the strip and in a post', async () => {
      serveComments(started('2026-11-14T09:59:30Z'), ({ method }) => method === 'POST' ? { body: cm(3, { mine: true }) }
        : { body: page([cm(1, { at: '2026-11-14T10:45:00Z', body: 'fake late pin' })]) })
      renderPage()
      await screen.findByText('fake late pin')
      expect(range().getAttribute('max')).toBe(String(Date.parse('2026-11-14T10:44:59Z')))
      fireEvent.click(screen.getByRole('button', { name: /show on the strip/ }))
      expect(range().value).toBe(String(Date.parse('2026-11-14T10:44:59Z')))
      await post()
      expect(postedAt()).toBe('2026-11-14T10:44:59Z')
    })

    it('ends the strip at now while live, and clamps again at submit when the clock has moved', async () => {
      setMomentNowForTests(() => Date.parse('2026-11-14T10:41:30.500Z'))
      serveComments({ ...liveFeedback(), you: writer }, ({ method }) => method === 'POST' ? { body: cm(2, { mine: true }) } : { body: page([]) })
      renderPage()
      await screen.findByRole('textbox', { name: 'Your comment' })
      expect(range().getAttribute('max')).toBe(String(Date.parse('2026-11-14T10:41:30Z')))
      fireEvent.change(range(), { target: { value: String(Date.parse('2026-11-14T10:41:30Z')) } })
      expect(range().value).toBe(String(Date.parse('2026-11-14T10:41:30Z')))
      // The clock steps back before the post goes out: the second is clamped to it, not sent as picked.
      setMomentNowForTests(() => Date.parse('2026-11-14T10:41:10.900Z'))
      await post()
      expect(postedAt()).toBe('2026-11-14T10:41:10Z')
    })

    it('offers no second before the stream began, even when the window starts earlier', async () => {
      serveComments(started('2026-11-14T10:36:20.400Z'), () => ({ body: page([]) }))
      renderPage()
      await screen.findByRole('textbox', { name: 'Your comment' })
      expect(range().getAttribute('min')).toBe(String(Date.parse('2026-11-14T10:36:21Z')))
    })
  })

  describe('post errors that retrying cannot fix', () => {
    const attempt = async (answer: Answer) => {
      serveComments(feedback({ you: writer }), ({ method }) => method === 'POST' ? answer : { body: page([]) })
      renderPage()
      fireEvent.change(await screen.findByRole('textbox', { name: 'Your comment' }), { target: { value: 'fake take' } })
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    }
    it.each([
      ['invalid_at', 'That time isn’t in the stream. Pick another time.'],
      ['invalid_comment', 'That comment can’t be posted as written. Edit it, then post.'],
      ['invalid_something_else', 'Your comment didn’t post. Try again.'],
    ])('shows the line for a 400 %s', async (code, line) => {
      await attempt({ status: 400, body: { error: code } })
      expect(await screen.findByText(line)).toBeTruthy()
    })
    it('shows the retry line for a 500 with no code', async () => {
      await attempt({ status: 500, body: {} })
      expect(await screen.findByText('Your comment didn’t post. Try again.')).toBeTruthy()
    })
    it.each([
      [42, 'Too many comments for now. Try again in 42 s.'],
      [119, 'Too many comments for now. Try again in 119 s.'],
      [120, 'Too many comments for now. Try again in 2 min.'],
      [125, 'Too many comments for now. Try again in 3 min.'],
      [7199, 'Too many comments for now. Try again in 120 min.'],
      [7200, 'Too many comments for now. Try again in 2 h.'],
      [41234, 'Too many comments for now. Try again in 12 h.'],
    ])('rounds a %s s wait up in the largest fitting unit', async (seconds, line) => {
      await attempt({ status: 429, body: { error: 'try_later', retryAfterSeconds: seconds } })
      expect(await screen.findByText(line)).toBeTruthy()
    })
  })

  it('gives the comment list list semantics', async () => {
    serveComments(feedback({ you: writer }), () => ({ body: page([cm(1)]) }))
    const { container } = renderPage()
    await screen.findByText('fake comment 1')
    expect(container.querySelector('ul.nc-comment-list')?.getAttribute('role')).toBe('list')
  })

  describe('typing at the cap, and the refused code points', () => {
    const box = async () => await screen.findByRole('textbox', { name: 'Your comment' }) as HTMLTextAreaElement
    const type = (input: HTMLTextAreaElement, value: string, inputType: string) => fireEvent.input(input, { target: { value }, inputType })
    const cp = (...points: number[]) => String.fromCodePoint(...points)

    it('refuses a typed character that would pass 280 and keeps the draft', async () => {
      serveComments(feedback({ you: writer }), () => ({ body: page([]) }))
      renderPage()
      const input = await box()
      type(input, 'a'.repeat(280), 'insertText')
      expect(input.value).toBe('a'.repeat(280))
      type(input, 'b' + 'a'.repeat(280), 'insertText')
      expect(input.value).toBe('a'.repeat(280))
      expect(screen.getByText('280/280')).toBeTruthy()
    })

    it('refuses a typed fourth line, and does not trim the ends while typing', async () => {
      serveComments(feedback({ you: writer }), () => ({ body: page([]) }))
      renderPage()
      const input = await box()
      type(input, '  a\nb\nc ', 'insertText')
      expect(input.value).toBe('  a\nb\nc ')
      type(input, '  a\nb\nc \nd', 'insertLineBreak')
      expect(input.value).toBe('  a\nb\nc ')
    })

    it('cuts a paste to the cap', async () => {
      serveComments(feedback({ you: writer }), () => ({ body: page([]) }))
      renderPage()
      const input = await box()
      type(input, 'a'.repeat(300), 'insertFromPaste')
      expect([...input.value]).toHaveLength(280)
      type(input, 'a\nb\nc\nd', 'insertFromPaste')
      expect(input.value).toBe('a\nb\nc')
    })

    it.each([
      ['U+200B', [0x200b]], ['U+200E', [0x200e]], ['U+200F', [0x200f]], ['U+061C', [0x61c]], ['U+FEFF', [0xfeff]],
      ['U+2060', [0x2060]], ['U+2061', [0x2061]], ['U+2062', [0x2062]], ['U+2063', [0x2063]], ['U+2064', [0x2064]],
      ['U+2028', [0x2028]], ['U+2029', [0x2029]], ['U+202A', [0x202a]], ['U+2069', [0x2069]],
    ])('removes %s from the draft, and a blank line made of it', async (_name, points) => {
      serveComments(feedback({ you: writer }), () => ({ body: page([]) }))
      renderPage()
      const input = await box()
      const bad = cp(...points)
      type(input, `a${bad}b`, 'insertText')
      expect(input.value).toBe('ab')
      type(input, `a\n${bad}\nb`, 'insertText')
      expect(input.value).toBe('a\nb')
      type(input, bad, 'insertText')
      expect(input.value).toBe('')
      expect((screen.getByRole('button', { name: 'Comment' }) as HTMLButtonElement).disabled).toBe(true)
    })

    it.each([[0x2028], [0x2029], [0xfeff]])('sends no leading or trailing code point %i for trim() to hide: it is refused before the trim', async point => {
      serveComments(feedback({ you: writer }), ({ method }) => method === 'POST' ? { body: cm(2, { mine: true }) } : { body: page([]) })
      renderPage()
      const input = await box()
      type(input, `${cp(point)}fake take${cp(point)}`, 'insertText')
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
      await waitFor(() => expect(sent.some(r => r.method === 'POST')).toBe(true))
      expect(JSON.parse(sent.find(r => r.method === 'POST')!.body!).body).toBe('fake take')
    })

    it('keeps a ZWJ emoji sequence and a tag-sequence flag', async () => {
      serveComments(feedback({ you: writer }), () => ({ body: page([]) }))
      renderPage()
      const input = await box()
      const family = cp(0x1f469, 0x200d, 0x1f4bb)
      const flag = cp(0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f)
      type(input, `${family} ${flag}`, 'insertText')
      expect(input.value).toBe(`${family} ${flag}`)
    })
  })

  describe('a comment that is gone', () => {
    it.each(['delete', 'report'] as const)('drops it, lowers the count, says so and focuses the heading on a 404 %s', async kind => {
      serveComments(feedback({ you: writer, comments: { total: 2 } }), ({ method }) => method === 'GET'
        ? { body: page([cm(1, { mine: kind === 'delete' }), cm(2, { mine: false })], 2) } : { status: 404, body: { error: 'comment_not_found' } })
      renderPage()
      await screen.findByText('fake comment 1')
      if (kind === 'delete') {
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      } else {
        fireEvent.click(screen.getAllByRole('button', { name: 'Report' })[0])
        fireEvent.click(screen.getByRole('button', { name: 'Spam' }))
      }
      await waitFor(() => expect(live()).toBe('That comment is no longer here.'))
      expect(screen.queryByText('fake comment 1')).toBeNull()
      expect(screen.getByRole('heading', { level: 2, name: '1 comment' })).toBeTruthy()
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: '1 comment' }))
    })
  })
})

describe('Moment watch page: the live "dropped" note needs the feed', () => {
  const settle = async () => { await waitFor(() => expect(calls).toContain(`/v1/portal/analytics/streams/${STREAM}`)); await new Promise(resolve => setTimeout(resolve, 30)) }

  it('asks nothing of the feed and shows no note while the feed switch is off', async () => {
    serve({ body: liveFeedback() })
    renderPage()
    await screen.findByRole('heading', { level: 1 })
    await settle()
    // No lookup by id, and no feed page either: with the feed off, Up next reads the recap.
    expect(feedIds).toEqual([])
    expect(calls).not.toContain('/v1/public/moments')
    await waitFor(() => expect(calls).toContain(`/v1/portal/analytics/streams/${STREAM}/recap`))
    expect(screen.queryByRole('note')).toBeNull()
  })

  it.each([
    ['a different schema version', { schemaVersion: 2, item: feedItem(2430) }],
    ['a malformed item', { schemaVersion: 1, item: { id: 'nope' } }],
    ['no item', { schemaVersion: 1 }],
  ])('shows no note for a 200 with %s (unknown, not unlisted)', async (_name, body) => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', 'on')
    serve({ body: liveFeedback() }, { item: { body } })
    renderPage(PATH, FROM_HUB)
    await screen.findByRole('heading', { level: 1 })
    await settle()
    expect(feedIds).toHaveLength(1)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('shows the note when the feed is on and does not list the Moment', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', 'on')
    serve({ body: liveFeedback() })
    renderPage(PATH, FROM_HUB)
    expect(await screen.findByRole('note')).toBeTruthy()
  })

  it.each([
    ['a recap for another login', { login: 'fakechan02', streamId: STREAM, topMoments: [] }],
    ['a recap for another stream', { login: 'fakechan01', streamId: '9000009', topMoments: [] }],
    ['a recap with no list', { login: 'fakechan01', streamId: STREAM }],
    ['a recap with the minute twice', { login: 'fakechan01', streamId: STREAM, topMoments: [{ offsetSeconds: 2430 }, { offsetSeconds: 2430 }] }],
  ])('shows no note for %s after the stream (unknown, not unlisted)', async (_name, body) => {
    serve({ body: feedback() }, { recap: { body } })
    renderPage(PATH, FROM_HUB)
    await screen.findByRole('heading', { level: 1 })
    await settle()
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('shows no note for a hidden Moment, live or not', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', 'on')
    serve({ body: feedback({ hidden: true, stream: { ...feedback().stream, endedAt: null } }) })
    renderPage(PATH, FROM_HUB)
    await screen.findByRole('heading', { level: 1 })
    await settle()
    expect(screen.queryByRole('note')).toBeNull()
    cleanup()
    // The stream and recap reads are shared and kept for two minutes: start this view with none read.
    resetMomentReads()
    serve({ body: feedback({ hidden: true }) }, { recap: { body: { login: 'fakechan01', streamId: STREAM, topMoments: [] } } })
    renderPage(PATH, FROM_HUB)
    await screen.findByRole('heading', { level: 1 })
    await settle()
    expect(screen.queryByRole('note')).toBeNull()
  })
})

describe('Moment watch page handed over by a link', () => {
  const handed = (over: Record<string, unknown> = {}) => ({ from: 'moments', moment: {
    streamId: STREAM, momentAt: MINUTE, offsetSeconds: 2430, login: 'fakechan01', displayName: 'FakeChan01', category: 'fake-pog', ...over,
  } })
  const renderHanded = (state: unknown) => render(
    <MemoryRouter initialEntries={[{ pathname: `/analytics/moments/${STREAM}/${MINUTE}`, state }]}>
      <Routes>
        <Route path="/analytics/moments/:streamId/:momentAt" element={<MomentWatchPage />} />
      </Routes>
    </MemoryRouter>,
  )

  it('paints the handed head before the read answers: title and channel, a placeholder box, no Twitch link yet', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { container } = renderHanded(handed())
    expect(screen.getByRole('heading', { level: 1, name: 'Moment at 0:40:30' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'FakeChan01' }).getAttribute('href')).toBe('/analytics/fakechan01')
    expect(screen.getByText('fake-pog')).toBeTruthy()
    expect(container.querySelector('[aria-busy="true"] .mw-picture .nc-skel-player')).not.toBeNull()
    expect(screen.getByText('Loading the Moment…')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Watch on Twitch/ })).toBeNull()
    expect(container.querySelector('[aria-busy="true"] .mw-pill-hold')?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('[aria-busy="true"] .mw-strip .mw-chart')).not.toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'More Moments from this stream' })).toBeTruthy()
  })

  it.each([
    ['another minute', { momentAt: '20261114T1041Z' }],
    ['another stream', { streamId: '9000002' }],
    ['a login that is not one', { login: 'Not A Login' }],
    ['no offset', { offsetSeconds: undefined }],
  ])('paints nothing handed for %s', (_name, over) => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    renderHanded(handed(over))
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.getByText('Loading the Moment…')).toBeTruthy()
  })

  it('keeps the head once the read answers, with the handed channel picture the stream route lacks', async () => {
    serve({ status: 404, body: { error: 'not_found' } }, { source: endedSource() })
    const { container } = renderHanded(handed({ profileImageUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/fake-profile_image-300x300.png' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Moment at 0:40:30' })).toBeTruthy()
    await screen.findByRole('link', { name: /Watch on Twitch from 0:40:30/ })
    expect(screen.getByRole('heading', { level: 1, name: 'Moment at 0:40:30' })).toBeTruthy()
    // The facts name the channel; the handed picture stands in for the one the stream route has none of.
    expect(screen.getByRole('link', { name: 'fakechan01' })).toBeTruthy()
    expect(container.querySelector('img.nc-avatar')?.getAttribute('src')).toContain('fake-profile_image')
  })

  it('shows the same game art on a tap as on a shared link: the game at the Moment’s minute from the stream’s /games read, not the handed Moment', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_FEEDBACK', '')
    // A Moment handed over by the list carries no category id or box art; the stream's game segments name the game at its minute.
    const cover = async (state?: unknown) => {
      serve({ status: 404 }, { source: endedSource(), more: games() })
      const { container } = state === undefined ? renderPage() : renderHanded(state)
      // jsdom has no requestIdleCallback: the picture is read after a 1.2 s timer, and shows once its reads are done.
      await waitFor(() => expect(container.querySelector('.mw-picture img.moment-picture-cover')).not.toBeNull(), { timeout: 4000 })
      const src = container.querySelector('.mw-picture img.moment-picture-cover')!.getAttribute('src')
      expect(container.querySelector('.mw-picture > .mw-picture-label > [aria-hidden="true"]')?.textContent).toBe('Game art')
      cleanup()
      resetMomentReads()
      resetVodFrameCache()
      resetMomentClipCache()
      resetCategoryArtwork()
      return src
    }
    const tapped = await cover(handed())
    // 0:40:30 is past the switch at 0:30:00: the second game's _IGDB cover, at the head's size.
    expect(tapped).toBe('https://static-cdn.jtvnw.net/ttv-boxart/1867279146_IGDB-285x380.jpg')
    expect(await cover()).toBe(tapped)
  })
})

describe('Moment watch page picture', () => {
  const pictureReads = () => calls.filter(path => path.includes('/storyboard-thumb') || path.includes('/clips')).sort()

  it('asks for no frame or clip before the page is idle, then says it found none', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_FEEDBACK', '')
    serve({ body: feedback() }, { source: endedSource() })
    const { container } = renderPage()
    await screen.findByRole('link', { name: /Watch on Twitch from 0:40:30/ })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(pictureReads()).toEqual([])
    expect(screen.queryByText('No picture of this moment yet')).toBeNull()
    expect(container.querySelector('.mw-picture-label')).toBeNull()
    // jsdom has no requestIdleCallback: the page is idle after a 1.2 s timer.
    expect(await screen.findByText('No picture of this moment yet', {}, { timeout: 4000 })).toBeTruthy()
    expect(pictureReads()).toEqual(['/v1/analytics/vods/123456789/storyboard-thumb', '/v1/channels/fakechan01/clips'])
    // Still a link to Twitch, and still no claim about clips.
    expect(screen.getAllByText('Watch on Twitch from 0:40:30')).toHaveLength(2)
    expect(screen.queryByText('No clip of this one yet.')).toBeNull()
  })

  it('shows the stream frame whole and labelled once idle', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_FEEDBACK', '')
    serve({ body: feedback() }, { source: endedSource(), more: { '/v1/analytics/vods/123456789/storyboard-thumb': { body: storyboard } } })
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelector('.mw-picture .moment-picture-frame')).not.toBeNull(), { timeout: 4000 })
    await waitFor(() => expect(pictureReads()).toHaveLength(2))
    const label = container.querySelector('.mw-picture > .mw-picture-label')!
    expect(label.querySelector(':scope > [aria-hidden="true"]')?.textContent).toBe('Stream frame')
    expect(label.querySelector(':scope > .sr-only')?.textContent).toBe('Stream frame from this moment')
    expect(label.getAttribute('aria-hidden')).toBeNull()
    expect(container.querySelector('.mw-picture > a.nc-thumb')?.getAttribute('href')).toBe('https://www.twitch.tv/videos/123456789?t=2430s')
  })

  it('asks for no picture, its own or Up next’s, for a Moment its channel hid', async () => {
    serve({ body: feedback({ hidden: true }) }, { source: endedSource(), recap: { body: { login: 'fakechan01', streamId: STREAM, topMoments: [{ offsetSeconds: 2430 }, { offsetSeconds: 600 }] } } })
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Moment at 0:40:30' })
    // Past the 1.2 s idle timer.
    await new Promise(resolve => setTimeout(resolve, 1500))
    expect(pictureReads()).toEqual([])
  })

  it('gives each Moment the game its stream was on at that minute: the head after a game switch, an Up next row before it', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_FEEDBACK', '')
    serve({ body: feedback() }, {
      source: endedSource(), more: games(),
      recap: { body: { login: 'fakechan01', streamId: STREAM, topMoments: [{ offsetSeconds: 2430 }, { offsetSeconds: 600 }] } },
    })
    const { container } = renderPage()
    // No frame and no clip: the head falls to the game art, the Fake Game at 0:40:30.
    await waitFor(() => expect(container.querySelector('.mw-picture img.moment-picture-cover')).not.toBeNull(), { timeout: 4000 })
    expect(container.querySelector('.mw-picture img.moment-picture-cover')!.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/1867279146_IGDB-285x380.jpg')
    expect(container.querySelector('.mw-picture > .mw-picture-label > .sr-only')?.textContent).toBe('Game art for Fake Game, not this moment')
    // The row at 0:10:00 is before the switch: Just Chatting.
    await waitFor(() => expect(container.querySelector('.mw-up-list img.moment-picture-cover')).not.toBeNull(), { timeout: 4000 })
    expect(container.querySelector('.mw-up-list img.moment-picture-cover')!.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/509658-285x380.jpg')
    expect(container.querySelector('.mw-up-list .mw-picture-label')?.getAttribute('title')).toBe('Game art for Just Chatting, not this moment')
    // One /games read serves the head and every row.
    expect(calls.filter(path => path === GAMES_PATH)).toHaveLength(1)
  })

  it.each([
    ['the games read fails', { [GAMES_PATH]: { status: 503 } }],
    ['the game’s cover is not Twitch’s own for its category', games([
      segment({ gameName: 'Fake Game', categoryId: '1867279146', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658-210x280.jpg', offsetSeconds: 0, durationSeconds: 9000 }),
    ])],
    ['the Moment’s minute falls in no game', games([
      segment({ gameName: 'Fake Game', categoryId: '1867279146', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/1867279146_IGDB-210x280.jpg', offsetSeconds: 3000, durationSeconds: 600 }),
    ])],
  ])('keeps the no-picture box when %s', async (_name, more) => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_FEEDBACK', '')
    serve({ body: feedback() }, { source: endedSource(), more })
    const { container } = renderPage()
    expect(await screen.findByText('No picture of this moment yet', {}, { timeout: 4000 })).toBeTruthy()
    expect(calls).toContain(GAMES_PATH)
    expect(container.querySelector('.mw-picture img')).toBeNull()
    expect(container.querySelector('.mw-picture .nc-thumb-missing')).not.toBeNull()
  })

  it('shows no head picture for a Moment its channel hid: not the stream’s thumbnail, not its game art', async () => {
    const thumbnail = { vodId: '123456789', kind: 'archive_thumbnail', url: 'https://static-cdn.jtvnw.net/cf_vods/fakecdn/123456789/thumb/thumb0-640x360.jpg' }
    const head = async (hidden: boolean) => {
      serve({ body: feedback({ hidden }) }, { source: { ...endedSource(), vodArtwork: thumbnail }, more: games() })
      const { container } = renderPage()
      await screen.findByRole('heading', { level: 1, name: 'Moment at 0:40:30' })
      // Past the 1.2 s idle timer.
      await new Promise(resolve => setTimeout(resolve, 1500))
      const box = container.querySelector('.mw-picture')!
      const seen = { imgs: box.querySelectorAll('img').length, kinds: box.querySelectorAll('[data-kind]').length, label: box.querySelector('.mw-picture-label') !== null, missing: box.querySelector('.nc-thumb-missing') !== null, games: calls.filter(path => path === GAMES_PATH).length }
      cleanup()
      resetMomentReads()
      resetCategoryArtwork()
      return seen
    }
    // The same answers show the stream's thumbnail on a Moment that is not hidden.
    expect(await head(false)).toMatchObject({ imgs: 1, label: true, missing: false })
    expect(await head(true)).toEqual({ imgs: 0, kinds: 0, label: false, missing: true, games: 0 })
  })

  it('asks for no picture when the window has a clip', async () => {
    serve({ body: feedback({ clips: [clip()] }) }, { source: endedSource() })
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'fake-pog play' })).toBeTruthy()
    await new Promise(resolve => setTimeout(resolve, 1500))
    expect(pictureReads()).toEqual([])
  })
})

describe('Moment watch page channel picture', () => {
  const PROFILE_PATH = '/v1/channels/fakechan01'
  const profile = { [PROFILE_PATH]: { body: { login: 'fakechan01', displayName: 'FakeChan01', profileImageUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/fake-chan-profile_image-300x300.png' } } }

  it('paints the letter first on a cold link, then the channel’s Twitch picture once the page is idle', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_FEEDBACK', '')
    serve({ body: feedback() }, { source: endedSource(), more: profile })
    const { container } = renderPage()
    await screen.findByRole('link', { name: /Watch on Twitch from 0:40:30/ })
    expect(container.querySelector('.nc-watch-channel span.nc-avatar')?.textContent).toBe('F')
    expect(calls).not.toContain(PROFILE_PATH)
    // jsdom has no requestIdleCallback: the page is idle after a 1.2 s timer.
    await waitFor(() => expect(container.querySelector('.nc-watch-channel img.nc-avatar')?.getAttribute('src')).toContain('fake-chan-profile_image'), { timeout: 4000 })
    expect(calls.filter(path => path === PROFILE_PATH)).toHaveLength(1)
  })

  it('keeps the letter when Twitch has no picture for the channel', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_FEEDBACK', '')
    serve({ body: feedback() }, { source: endedSource() })
    const { container } = renderPage()
    await waitFor(() => expect(calls).toContain(PROFILE_PATH), { timeout: 4000 })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(container.querySelector('.nc-watch-channel img.nc-avatar')).toBeNull()
    expect(container.querySelector('.nc-watch-channel span.nc-avatar')?.textContent).toBe('F')
  })

  it('asks Twitch for nothing when the answer already has the channel’s picture', async () => {
    serve({ body: feedback({ stream: { ...feedback().stream, profileImageUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/fake-answer-profile_image-300x300.png' } }) }, { source: endedSource(), more: profile })
    const { container } = renderPage()
    await screen.findByRole('link', { name: /Watch on Twitch from 0:40:30/ })
    await new Promise(resolve => setTimeout(resolve, 1500))
    expect(container.querySelector('.nc-watch-channel img.nc-avatar')?.getAttribute('src')).toContain('fake-answer-profile_image')
    expect(calls).not.toContain(PROFILE_PATH)
  })
})

describe('Moment watch page: more from the channel and the game', () => {
  const STREAMS_PATH = '/v1/portal/analytics/channels/fakechan01/streams'
  const HUB_PATH = '/v1/public/hub'
  const OTHER = '9000002'
  const GAME_ID = '1867279146'
  const channelStreams = { [STREAMS_PATH]: { body: { items: [
    { streamId: STREAM, startedAt: '2026-11-14T09:59:30Z', displayName: 'fakechan01' },
    { streamId: OTHER, startedAt: '2026-11-12T18:00:00Z', displayName: 'fakechan01', category: 'Fake Game' },
  ] } } }
  // The other stream's recap: its first five minutes are never a Moment.
  const otherRecap = { [`/v1/portal/analytics/streams/${OTHER}/recap`]: { body: { login: 'fakechan01', streamId: OTHER, topMoments: [{ offsetSeconds: 1200 }, { offsetSeconds: 100 }, { offsetSeconds: 3000 }] } } }
  const AT = Date.parse('2026-11-14T10:30:00Z')
  const live = (login: string, streamId: string, at: number, extra: Record<string, unknown> = {}) => ({
    login, streamId, offsetSeconds: 1800, at, label: 'Chat spike', kind: 'chat_spike', score: 1, category: 'Fake Game', categoryId: GAME_ID, ...extra,
  })
  const hub = { [HUB_PATH]: { body: {
    generatedAt: '2026-11-14T10:45:00Z', poolSize: 3,
    corpus: { streamsTracked: 3, momentsDetected: 3, chatMessagesProcessed: 1, emotesIndexed: 1, vodsAnalyzed: 0 },
    coverage: { databaseOk: true, state: 'ok' }, activity: { points: [], channelCount: 3, windowMinutes: 30 },
    liveChannels: [], moments: [], topEmotes: [], topMovers: [], livePulseMomentsStatus: 'ready',
    livePulseMoments: [
      live('fakechan01', '9000003', AT),
      live('fakechan02', '9100002', AT - 60_000),
      live('fakechan03', '9100003', AT - 120_000, { category: 'Other Fake Game', categoryId: '1000001' }),
      live('fakechan04', '9100004', AT - 180_000),
    ],
  } } }
  // The page's channel lookup asks the same route for its newest stream (limit=1); these sections ask for the channel page's list.
  const urls = () => vi.mocked(fetch).mock.calls.map(([input]) => new URL(String(input), 'http://localhost'))
  const listReads = () => urls().filter(url => url.pathname === STREAMS_PATH && url.searchParams.get('limit') === '24').length
  const hubReads = () => urls().filter(url => url.pathname === HUB_PATH).length
  const moreHeadings = () => screen.queryAllByRole('heading', { level: 2 }).map(h => h.textContent).filter(t => t?.startsWith('More ') && t !== 'More Moments from this stream')

  it('adds the channel’s other streams and the game’s other channels below this stream’s Moments, once the page is idle', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_FEEDBACK', '')
    serve({ body: feedback() }, { source: endedSource(), more: { ...games(), ...channelStreams, ...otherRecap, ...hub } })
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Moment at 0:40:30' })
    expect([listReads(), hubReads()]).toEqual([0, 0])
    const channel = await screen.findByRole('region', { name: 'More from fakechan01' }, { timeout: 4000 })
    expect(within(channel).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      `/analytics/moments/${OTHER}/20261112T1820Z`, `/analytics/moments/${OTHER}/20261112T1850Z`,
    ])
    const game = await screen.findByRole('region', { name: 'More Fake Game Moments' }, { timeout: 4000 })
    // Never this channel, never another game: one row per other channel.
    expect(within(game).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      '/analytics/moments/9100002/20261114T1029Z', '/analytics/moments/9100004/20261114T1027Z',
    ])
    expect(within(game).getByText('fakechan02')).toBeTruthy()
    // Below "More Moments from this stream", in that order.
    expect(moreHeadings()).toEqual(['More from fakechan01', 'More Fake Game Moments'])
    expect([listReads(), hubReads()]).toEqual([1, 1])
  })

  it('reads nothing more and shows no section for a Moment its channel hid', async () => {
    // Only the feedback read says a Moment is hidden (the switch is on here).
    serve({ body: feedback({ hidden: true }) }, { source: endedSource(), more: { ...games(), ...channelStreams, ...otherRecap, ...hub } })
    renderPage()
    await screen.findByRole('heading', { level: 1 })
    await new Promise(resolve => setTimeout(resolve, 2500))
    expect([listReads(), hubReads()]).toEqual([0, 0])
    expect(moreHeadings()).toEqual([])
  })

  it('leaves both sections out when their reads fail, with no message', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_FEEDBACK', '')
    serve({ body: feedback() }, { source: endedSource(), more: { ...games(), [STREAMS_PATH]: { status: 404 }, [HUB_PATH]: { status: 404 } } })
    const { container } = renderPage()
    await waitFor(() => expect([listReads(), hubReads()]).toEqual([1, 1]), { timeout: 4000 })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(moreHeadings()).toEqual([])
    expect(container.querySelector('.mw-more')).toBeNull()
  })

  it('leaves a section out when it has nothing to list', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_FEEDBACK', '')
    const onlyThis = { [STREAMS_PATH]: { body: { items: [{ streamId: STREAM, startedAt: '2026-11-14T09:59:30Z' }] } } }
    serve({ body: feedback() }, { source: endedSource(), more: { ...games(), ...onlyThis, ...hub } })
    renderPage()
    await screen.findByRole('region', { name: 'More Fake Game Moments' }, { timeout: 4000 })
    expect(moreHeadings()).toEqual(['More Fake Game Moments'])
    // Only this stream: no recap besides its own is read.
    expect(calls.filter(path => path.endsWith('/recap') && !path.includes(STREAM))).toEqual([])
  })
})
