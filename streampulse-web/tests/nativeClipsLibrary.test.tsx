import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NativeClipsLibrary from '../src/ui/components/clips/NativeClipsLibrary'
import NativeClipWatchPage from '../src/routes/analytics/NativeClipWatchPage'
import { resetClipListsForTests } from '../src/lib/nativeClipsList'
import { nativeClipsPage, rawNativeClip, stubClipsFetch } from './fixtures/nativeClips'

vi.mock('../src/ui/components/analytics/AnalyticsFigmaShell', () => ({ AnalyticsFigmaShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
const follows = vi.hoisted(() => ({ state: { status: 'off' } as Record<string, unknown>, connect: vi.fn(), forget: vi.fn() }))
vi.mock('../src/lib/twitchFollows', () => ({
  useTwitchFollows: () => follows.state,
  connectTwitchFollows: follows.connect,
  forgetTwitchFollows: follows.forget,
}))

const second = rawNativeClip({ id: 'Second', url: 'https://clips.twitch.tv/Second', title: 'The comeback', views: null, vod: null, game: null,
  channel: { id: '2', login: 'kaicenat', displayName: 'KaiCenat', profileImageUrl: '' },
  reaction: { chatLift: 3, emoteLift: 2.4, chatters: 95, largestShare: 0.1, topEmote: { name: 'KEKW', count: 140 } } })

let where = ''
function Where() {
  const location = useLocation()
  where = location.pathname + location.search
  return null
}

const renderAt = (url = '/analytics/moments?view=clips') => render(
  <MemoryRouter initialEntries={[url]}>
    <Where />
    <Routes>
      <Route path="/analytics/moments" element={<NativeClipsLibrary onOpenMoments={() => {}} />} />
      <Route path="/analytics/clips/:clipId" element={<NativeClipWatchPage />} />
    </Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  window.localStorage.clear()
  resetClipListsForTests()
  follows.state = { status: 'off' }
  follows.connect.mockClear()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  // jsdom has no scrollIntoView; the period menu scrolls its active option into view.
  Element.prototype.scrollIntoView = () => {}
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Clips library', () => {
  it('lists clips as links to their own pages, with one number and the game’s art on each', async () => {
    const calls = stubClipsFetch({ body: nativeClipsPage([rawNativeClip(), second]) })
    renderAt()
    const card = await screen.findByRole('link', { name: /Chat loses it/ })
    expect(card.getAttribute('href')).toBe('/analytics/clips/BraveClipSlug-abc_1')
    expect(within(card).getByText('Chat 6.2× faster, 412+ chatters')).toBeTruthy()
    expect(within(card).getByText('Chat loses it')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(within(card).getByText(/1\.2K views/)).toBeTruthy()
    expect(within(card).getByText('Ju')).toBeTruthy()
    expect(screen.getByText(/Views not in yet/)).toBeTruthy()
    expect(document.querySelector('iframe')).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('says the library is not switched on when the backend answers 404', async () => {
    stubClipsFetch({ status: 404, body: { error: 'not found' } })
    const onOpenMoments = vi.fn()
    render(<MemoryRouter><NativeClipsLibrary onOpenMoments={onOpenMoments} /></MemoryRouter>)
    await screen.findByText(/Clips aren.t switched on yet/)
    fireEvent.click(screen.getByRole('button', { name: 'Open Moments' }))
    expect(onOpenMoments).toHaveBeenCalledTimes(1)
  })

  it('offers Try again when the answer is not the clip list', async () => {
    const calls = stubClipsFetch({ body: { schemaVersion: 2 } }, { body: nativeClipsPage([rawNativeClip()]) })
    renderAt()
    await screen.findByText(/Clips didn.t load\./)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('link', { name: /Chat loses it/ })
    expect(calls).toHaveLength(2)
  })

  it('explains an empty period without inventing clips', async () => {
    stubClipsFetch({ body: nativeClipsPage([]) })
    renderAt()
    await screen.findByText('No clips yet')
    expect(screen.getByText(/Nothing was clipped in the last 7 days/)).toBeTruthy()
  })

  it('keeps the period and game in the address and asks the backend again', async () => {
    const page = nativeClipsPage([rawNativeClip()], { facets: { games: [{ id: '509658', name: 'Just Chatting', count: 1 }, { id: '27471', name: 'Minecraft', count: 1 }], channels: [] } })
    const calls = stubClipsFetch({ body: page })
    renderAt()
    await screen.findByRole('link', { name: /Chat loses it/ })
    fireEvent.click(screen.getByRole('combobox', { name: 'Made in the last' }))
    fireEvent.click(screen.getByRole('option', { name: '30 days' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(new URL(calls[1].url).searchParams.get('period')).toBe('30d')
    expect(where).toContain('period=30d')
    fireEvent.click(await screen.findByRole('button', { name: /Minecraft/ }))
    await waitFor(() => expect(calls).toHaveLength(3))
    expect(new URL(calls[2].url).searchParams.get('game')).toBe('27471')
    expect(where).toContain('game=27471')
    expect(screen.getByRole('button', { name: /Minecraft/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('shows saved clips read fresh by id, and one that left the library', async () => {
    window.localStorage.setItem('streampulse.saved-clips.v1', JSON.stringify({ version: 1, items: [
      { id: 'Gone', savedAt: 2, title: 'An old clip', channel: 'xQc' },
      { id: 'BraveClipSlug-abc_1', savedAt: 1, title: 'Chat loses it', channel: 'xQc' },
    ] }))
    vi.resetModules()
    const { default: Library } = await import('../src/ui/components/clips/NativeClipsLibrary')
    const calls = stubClipsFetch({ body: nativeClipsPage([]) }, { body: nativeClipsPage([rawNativeClip()]) })
    render(<MemoryRouter initialEntries={['/analytics/moments?view=clips']}><Library onOpenMoments={() => {}} /></MemoryRouter>)
    await screen.findByText('No clips yet')
    fireEvent.click(screen.getByRole('button', { name: 'Saved 2' }))
    await screen.findByText('Not in the library any more')
    expect(screen.getByRole('link', { name: /Chat loses it/ })).toBeTruthy()
    const lookup = new URL(calls[1].url)
    expect(lookup.searchParams.get('ids')).toBe('Gone,BraveClipSlug-abc_1')
    expect(calls[1].init?.cache).toBe('no-store')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.queryByText('Not in the library any more')).toBeNull())
  })

  it('asks before reading Twitch follows, and reads nothing for it', async () => {
    follows.state = { status: 'idle' }
    const calls = stubClipsFetch({ body: nativeClipsPage([rawNativeClip()]) })
    renderAt('/analytics/moments?view=clips&show=follows')
    expect(screen.getByText(/never sent to StreamPulse/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show my Twitch follows' }))
    expect(follows.connect).toHaveBeenCalledTimes(1)
    await act(async () => {})
    expect(calls).toHaveLength(0)
  })

  it('filters to channels you follow in the browser, without sending the list', async () => {
    follows.state = { status: 'ready', follows: { login: 'me', name: 'Me', logins: ['kaicenat'], total: 1, at: 1 } }
    const calls = stubClipsFetch({ body: nativeClipsPage([rawNativeClip(), second]) })
    renderAt('/analytics/moments?view=clips&show=follows')
    await screen.findByRole('link', { name: /The comeback/ })
    expect(screen.queryByRole('link', { name: /Chat loses it/ })).toBeNull()
    expect(calls.every(call => !call.url.includes('kaicenat'))).toBe(true)
    expect(new URL(calls[0].url).searchParams.get('limit')).toBe('48')
  })
})

describe('A clip’s own page', () => {
  it('opens from a card without another read, plays only after Play, and carries on through the list', async () => {
    const calls = stubClipsFetch({ body: nativeClipsPage([rawNativeClip(), second]) })
    renderAt()
    fireEvent.click(await screen.findByRole('link', { name: /Chat loses it/ }))
    expect(where).toBe('/analytics/clips/BraveClipSlug-abc_1')
    expect(screen.getByRole('heading', { level: 1, name: 'Chat 6.2× faster, 412+ chatters' })).toBeTruthy()
    expect(screen.getByText('On Twitch: Chat loses it')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Watch on Twitch/ }).getAttribute('href')).toBe('https://clips.twitch.tv/BraveClipSlug-abc_1')
    expect(screen.getByRole('link', { name: /Watch in the VOD/ }).getAttribute('href')).toBe('https://www.twitch.tv/videos/2100000000?t=1h2m5s')
    expect(screen.getByRole('link', { name: 'See clips from this game' }).getAttribute('href')).toBe('/analytics/moments?view=clips&game=509658&period=30d')
    const upNext = screen.getByRole('complementary', { name: 'Up next' })
    expect(within(upNext).getByRole('link', { name: /KEKW flood/ })).toBeTruthy()
    expect(document.querySelector('iframe')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Play clip' }))
    const src = new URL(document.querySelector('iframe')!.getAttribute('src')!)
    expect(src.origin + src.pathname).toBe('https://clips.twitch.tv/embed')
    expect(src.searchParams.get('parent')).toBe(window.location.hostname)
    expect(calls).toHaveLength(1)
    fireEvent.click(within(upNext).getByRole('link', { name: /KEKW flood/ }))
    expect(screen.getByRole('heading', { level: 1, name: 'KEKW flood: chat 3× faster, 95+ chatters' })).toBeTruthy()
    expect(screen.getByText(/KEKW/, { selector: '.nc-facts .nc-strong' }).closest('li')?.textContent).toBe("KEKW was chat's top emote then, used 140 times")
    expect(document.querySelector('iframe')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByRole('heading', { level: 1, name: 'Chat 6.2× faster, 412+ chatters' })
  })

  it('reads a shared link by id', async () => {
    const calls = stubClipsFetch({ body: nativeClipsPage([rawNativeClip()]) })
    renderAt('/analytics/clips/BraveClipSlug-abc_1')
    await screen.findByRole('heading', { level: 1, name: 'Chat 6.2× faster, 412+ chatters' })
    expect(new URL(calls[0].url).searchParams.get('ids')).toBe('BraveClipSlug-abc_1')
    expect(screen.getByRole('link', { name: 'All clips' }).getAttribute('href')).toBe('/analytics/moments?view=clips')
  })

  it('says when a linked clip is not in the library, or the library is off', async () => {
    stubClipsFetch({ body: nativeClipsPage([]) })
    renderAt('/analytics/clips/Missing')
    await screen.findByText(/This clip isn.t in the library/)
    cleanup()
    stubClipsFetch({ status: 404, body: {} })
    renderAt('/analytics/clips/Other')
    await screen.findByText(/Clips aren.t switched on yet/)
    cleanup()
    renderAt('/analytics/clips/not%20a%20clip')
    expect(screen.getByText(/This clip isn.t in the library/)).toBeTruthy()
  })
})
