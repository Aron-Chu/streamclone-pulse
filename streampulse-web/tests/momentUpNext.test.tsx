import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMomentClipCache } from '@streampulse/analytics-console/moment-previews'
import { resetVodFrameCache } from '@streampulse/analytics-console/utils/vodFrames'
import { MomentUpNext } from '../src/ui/components/moments/watch/MomentUpNext'
import { fromHubMoment } from '../src/lib/discoveryMoments'
import { resetMomentReads } from '../src/lib/momentReads'

const STREAM = '9000001'
const STARTED = Date.parse('2026-11-14T09:59:30Z')
// Offset 2430 is the page's own Moment: 09:59:30 + 40:30 = 10:40:00, minute 20261114T1040Z.
const current = () => fromHubMoment({ login: 'fakechan01', streamId: STREAM, offsetSeconds: 2430, label: 'Measured reaction' })
const spark = () => Array.from({ length: 25 }, () => 1)
const feedItem = (offsetSeconds: number, over: Record<string, unknown> = {}) => ({
  id: `pulse-fakechan01-${STREAM}-${offsetSeconds}`, login: 'fakechan01', displayName: 'fakechan01', streamId: STREAM, offsetSeconds,
  minuteStart: STARTED + offsetSeconds * 1000, streamLive: true, tier: 'strong', verdict: 'ok', score: 80,
  label: { kind: 'chat', text: 'chat burst' }, reaction: { key: 'other', label: 'Other' }, category: null, topEmotes: [], hero: 'chat',
  chat: { perMin: 1, baselinePerMin: 1, x: 1, state: 'ok' }, emotes: { perMin: 1, baselinePerMin: 1, x: 1, state: 'ok' }, spanMinutes: 1,
  spark: { chat: spark(), emotes: spark(), momentIndex: 16, sparkStartIndex: 0 }, checks: { history: { level: 'ok', code: 'ok' } }, ...over,
})
const artwork = { vodId: '123456789', kind: 'archive_thumbnail' as const, url: 'https://static-cdn.jtvnw.net/cf_vods/fake/thumb.jpg' }

let calls: string[]
function serve(answer: (path: string) => { status?: number; body?: unknown }) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    calls.push(url.pathname)
    const a = answer(url.pathname)
    return Response.json(a.body ?? {}, { status: a.status ?? 200 })
  }))
}
const recap = (offsets: number[]) => ({ body: { login: 'fakechan01', streamId: STREAM, topMoments: offsets.map(offsetSeconds => ({ offsetSeconds, score: 5 })) } })
const renderUp = (props: Partial<Parameters<typeof MomentUpNext>[0]> = {}) => render(
  <MemoryRouter>
    <MomentUpNext moment={current()} streamStartedAtMs={STARTED} live={false} artwork={null} {...props} />
  </MemoryRouter>,
)
// The recap is read once per stream and kept, and so are frames and clips: each test starts with none read.
beforeEach(() => { resetMomentReads(); resetVodFrameCache(); resetMomentClipCache() })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

/** IntersectionObserver as a switch: `near()` brings every watched row onto the screen. */
function screenRows() {
  const watched: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = []
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { watched.push(callback) }
    observe() {}
    disconnect() {}
  })
  return { near: () => act(() => { watched.forEach(callback => callback([{ isIntersecting: true }])) }) }
}
const storyboard = () => ({ body: { sheetUrl: 'https://d2vi6trrdongqn.cloudfront.net/fake/storyboards/1-high-0.jpg', sheetWidth: 1100, sheetHeight: 620, cropX: 0, cropY: 0, cropW: 220, cropH: 124 } })

describe('More Moments from this stream', () => {
  it('shows a hidden skeleton, and reads nothing, until the Moment is known', () => {
    serve(() => recap([100]))
    const { container } = renderUp({ moment: null })
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(container.querySelectorAll('.nc-skel-row[aria-hidden="true"]')).toHaveLength(3)
    expect(screen.queryByRole('list')).toBeNull()
    expect(calls).toEqual([])
  })

  it('shows a skeleton while loading, then linked rows without the current minute', async () => {
    serve(() => recap([2430, 600, 600, 1200]))
    const { container } = renderUp({ artwork })
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    const list = await screen.findByRole('list')
    const links = Array.from(list.querySelectorAll('a')).map(a => a.getAttribute('href'))
    // 09:59:30 + 600 s = 10:09:30 -> next whole minute 10:10; + 1200 s = 10:19:30 -> 10:20.
    expect(links).toEqual([`/analytics/moments/${STREAM}/20261114T1010Z`, `/analytics/moments/${STREAM}/20261114T1020Z`])
    expect(screen.getByText('0:10:00').getAttribute('aria-hidden')).toBe('true')
    // The stream's thumbnail says what it is, for the eye; the link's name stays the row's.
    expect(screen.getAllByRole('link').map(a => a.textContent)).toEqual(['VOD thumbnail0:10:00Moment at 0:10:00', 'VOD thumbnail0:20:00Moment at 0:20:00'])
    const label = list.querySelector('.mw-picture-label')!
    expect(label.getAttribute('aria-hidden')).toBe('true')
    expect(label.getAttribute('title')).toBe('The stream’s thumbnail, not this moment')
    expect(list.tagName).toBe('UL')
    expect(list.getAttribute('role')).toBe('list')
    expect(screen.getByText('Moment at 0:10:00')).toBeTruthy()
    expect(list.querySelector('img')?.getAttribute('src')).toBe(artwork.url)
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('shows no clip line and no comment count on a row', async () => {
    serve(() => recap([600]))
    renderUp()
    await screen.findByRole('list')
    expect(screen.queryByText(/clip/i)).toBeNull()
    expect(screen.queryByText(/comment/i)).toBeNull()
  })

  it('caps the rows at 20', async () => {
    serve(() => recap(Array.from({ length: 30 }, (_, i) => 3000 + i * 60)))
    renderUp()
    expect((await screen.findByRole('list')).querySelectorAll('li')).toHaveLength(20)
  })

  it('says so when no other Moment is listed', async () => {
    serve(() => recap([2430]))
    renderUp()
    expect((await screen.findByRole('status')).textContent).toBe('No other Moments from this stream yet.')
  })

  it('says the read failed, and never shows that as empty', async () => {
    serve(() => ({ status: 503, body: { error: 'down' } }))
    renderUp()
    const status = await screen.findByRole('status')
    expect(status.textContent).toBe('Other Moments didn’t load.')
    expect(screen.queryByText('No other Moments from this stream yet.')).toBeNull()
  })

  it('while live reads the feed, keeps this stream in feed order, and uses a live frame when it has one', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', 'on')
    const other = { ...feedItem(900), streamId: '9000099' }
    serve(path => path === '/v1/public/moments'
      ? { body: { schemaVersion: 1, generatedAt: 1, snapshotVersion: 'v', window: '12h', status: 'ready', stale: false, coverage: { streamsScored: 1, streamsEligible: 1 }, total: 4, nextCursor: null,
        items: [feedItem(1500, { liveFrameUrl: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_fakechan01-440x248.jpg' }), other, feedItem(2430), feedItem(300)] } }
      : { status: 404 })
    const { container } = renderUp({ live: true, artwork })
    const list = await screen.findByRole('list')
    expect(calls).toEqual(['/v1/public/moments'])
    expect(Array.from(list.querySelectorAll('a')).map(a => a.getAttribute('href'))).toEqual([
      `/analytics/moments/${STREAM}/20261114T1025Z`, `/analytics/moments/${STREAM}/20261114T1005Z`,
    ])
    const images = Array.from(container.querySelectorAll('img')).map(i => i.getAttribute('src'))
    expect(images).toEqual(['https://static-cdn.jtvnw.net/previews-ttv/live_user_fakechan01-440x248.jpg', artwork.url])
  })

  it.each([
    ['a cut-off live page', "'next-page'", 'Other Moments from this stream aren’t in the latest feed.', 'No other Moments from this stream yet.'],
    ['a complete live page', 'null', 'No other Moments from this stream yet.', 'Other Moments from this stream aren’t in the latest feed.'],
  ])('says the right line when %s has none of this stream’s other Moments', async (_name, cursor, shown, notShown) => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', 'on')
    serve(() => ({ body: { schemaVersion: 1, generatedAt: 1, snapshotVersion: 'v', window: '12h', status: 'ready', stale: false, coverage: { streamsScored: 1, streamsEligible: 1 }, total: 60,
      nextCursor: cursor === 'null' ? null : 'next-page', items: [{ ...feedItem(900), streamId: '9000099' }, feedItem(2430)] } }))
    renderUp({ live: true })
    expect((await screen.findByRole('status')).textContent).toBe(shown)
    expect(screen.queryByText(notShown)).toBeNull()
    expect(calls).toEqual(['/v1/public/moments'])
  })

  it('while live with the live feed switched off, reads the recap and never /v1/public/moments', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
    serve(path => path.endsWith('/recap') ? recap([600]) : { status: 404 })
    renderUp({ live: true })
    const list = await screen.findByRole('list')
    expect(Array.from(list.querySelectorAll('a')).map(a => a.getAttribute('href'))).toEqual([`/analytics/moments/${STREAM}/20261114T1010Z`])
    expect(calls).toEqual([`/v1/portal/analytics/streams/${STREAM}/recap`])
  })

  it('shares the page\'s one recap read, and only stops waiting on unmount', async () => {
    let answer!: (response: Response) => void
    const fetch = vi.fn(() => new Promise<Response>(resolve => { answer = resolve }))
    vi.stubGlobal('fetch', fetch)
    const first = renderUp()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    first.unmount()
    renderUp()
    answer(Response.json(recap([600]).body))
    expect((await screen.findByRole('list')).querySelectorAll('li')).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('hands the row\'s Moment to the next page, keyed to its minute', async () => {
    serve(() => recap([600]))
    let state: unknown
    function Next() { state = useLocation().state; return <p>next page</p> }
    render(
      <MemoryRouter initialEntries={['/here']}>
        <Routes>
          <Route path="/here" element={<MomentUpNext moment={fromHubMoment({ login: 'fakechan01', streamId: STREAM, offsetSeconds: 2430, label: 'Measured reaction', displayName: 'FakeChan01', category: 'fake-pog' })}
            streamStartedAtMs={STARTED} live={false} artwork={null} />} />
          <Route path="/analytics/moments/:streamId/:momentAt" element={<Next />} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(within(await screen.findByRole('list')).getByRole('link'))
    await screen.findByText('next page')
    expect(state).toEqual({ from: 'moment', moment: {
      streamId: STREAM, momentAt: '20261114T1010Z', offsetSeconds: 600, login: 'fakechan01', displayName: 'FakeChan01', category: 'fake-pog', profileImageUrl: undefined,
    } })
  })

  describe('row pictures', () => {
    const pictures = { vodId: '123456789', vodAlignSeconds: 0, games: [] }

    it('asks for nothing until the page gives pictures and the row is near the screen, then shows the labelled frame', async () => {
      const rows = screenRows()
      serve(path => path.endsWith('/recap') ? recap([600]) : path.includes('/storyboard-thumb') ? storyboard() : { body: { items: [] } })
      const { container, rerender } = renderUp({ artwork })
      await screen.findByRole('list')
      rows.near()
      await new Promise(resolve => setTimeout(resolve, 20))
      // No pictures from the page yet (it is not idle): the row keeps the approved thumbnail and reads nothing.
      expect(calls).toEqual([`/v1/portal/analytics/streams/${STREAM}/recap`])
      expect(container.querySelector('.mw-up-row img')?.getAttribute('src')).toBe(artwork.url)
      rerender(<MemoryRouter><MomentUpNext moment={current()} streamStartedAtMs={STARTED} live={false} artwork={artwork} pictures={pictures} /></MemoryRouter>)
      await waitFor(() => expect(container.querySelector('.mw-up-row .moment-picture-frame')).not.toBeNull())
      // The channel's clips are asked once too (after a short gather); none is near, so the frame stays.
      await waitFor(() => expect(calls).toContain('/v1/channels/fakechan01/clips'))
      expect(calls.filter(path => path.includes('/storyboard-thumb'))).toEqual(['/v1/analytics/vods/123456789/storyboard-thumb'])
      const label = container.querySelector('.mw-up-row .mw-picture-label')!
      expect(label.textContent).toBe('Stream frame')
      expect(label.getAttribute('aria-hidden')).toBe('true')
      expect(screen.getByRole('link').textContent).toBe('Stream frame0:10:00Moment at 0:10:00')
    })

    it('asks for nothing while the row is off the screen', async () => {
      screenRows()
      serve(path => path.endsWith('/recap') ? recap([600]) : path.includes('/storyboard-thumb') ? storyboard() : { body: { items: [] } })
      renderUp({ artwork, pictures })
      await screen.findByRole('list')
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(calls).toEqual([`/v1/portal/analytics/streams/${STREAM}/recap`])
    })

    it('asks for no frame while the page’s own picture is still being read, then does', async () => {
      const rows = screenRows()
      serve(path => path.endsWith('/recap') ? recap([600]) : path.includes('/storyboard-thumb') ? storyboard() : { body: { items: [] } })
      const { container, rerender } = renderUp({ artwork, pictures, holdReads: true })
      await screen.findByRole('list')
      rows.near()
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(calls.filter(path => path.includes('/storyboard-thumb'))).toEqual([])
      rerender(<MemoryRouter><MomentUpNext moment={current()} streamStartedAtMs={STARTED} live={false} artwork={artwork} pictures={pictures} holdReads={false} /></MemoryRouter>)
      await waitFor(() => expect(container.querySelector('.mw-up-row .moment-picture-frame')).not.toBeNull())
    })

    // The stream's game segments: Just Chatting for its first half hour, then a game whose cover is under Twitch's _IGDB name.
    const games = [
      { gameName: 'Just Chatting', categoryId: '509658', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658-210x280.jpg', offsetSeconds: 0, durationSeconds: 1800 },
      { gameName: 'Fake Game', categoryId: '1234567', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/1234567_IGDB-210x280.jpg', offsetSeconds: 1800, durationSeconds: 5400 },
    ]

    it('shows labelled game art when there is no frame and no thumbnail: each row the game at its own minute', async () => {
      const rows = screenRows()
      serve(path => path.endsWith('/recap') ? recap([600, 4000]) : { status: 404, body: { error: 'nope' } })
      const { container } = renderUp({ pictures: { vodId: null, vodAlignSeconds: null, games } })
      await screen.findByRole('list')
      rows.near()
      await waitFor(() => expect(container.querySelectorAll('.mw-up-row img')).toHaveLength(2))
      const [early, late] = [...container.querySelectorAll('.mw-up-row')]
      expect(early!.querySelector('img')?.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/509658-285x380.jpg')
      expect(late!.querySelector('img')?.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/1234567_IGDB-285x380.jpg')
      expect(early!.querySelector('img')?.className).toBe('moment-picture-cover')
      expect(early!.querySelector('.mw-picture-label')?.textContent).toBe('Game art')
      expect(early!.querySelector('.mw-picture-label')?.getAttribute('title')).toBe('Game art for Just Chatting, not this moment')
      expect(late!.querySelector('.mw-picture-label')?.getAttribute('title')).toBe('Game art for Fake Game, not this moment')
      // No VOD: neither a frame nor a clip is asked for.
      expect(calls).toEqual([`/v1/portal/analytics/streams/${STREAM}/recap`])
    })

    it('shows no game art for a row whose game has no exact cover, or while the games are still read', async () => {
      const rows = screenRows()
      serve(path => path.endsWith('/recap') ? recap([600]) : { status: 404, body: { error: 'nope' } })
      const { container, rerender } = renderUp({ pictures: { vodId: null, vodAlignSeconds: null, games: null } })
      await screen.findByRole('list')
      rows.near()
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(container.querySelector('.mw-up-row img')).toBeNull()
      expect(container.querySelector('.mw-up-row .nc-thumb-missing')).not.toBeNull()
      const noCover = [{ ...games[0]!, boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/Just%20Chatting-210x280.jpg', categoryId: null }]
      rerender(<MemoryRouter><MomentUpNext moment={current()} streamStartedAtMs={STARTED} live={false} artwork={null}
        pictures={{ vodId: null, vodAlignSeconds: null, games: noCover }} /></MemoryRouter>)
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(container.querySelector('.mw-up-row img')).toBeNull()
      expect(container.querySelector('.mw-up-row .nc-thumb-missing')).not.toBeNull()
    })
  })
})
