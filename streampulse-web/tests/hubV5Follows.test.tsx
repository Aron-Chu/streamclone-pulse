/**
 * Show my Twitch follows on the hub (11-01): the hero's button, and "Your follows" while it reads, after a
 * failure, with the list, while the hub waits for live data, and after Forget; what a screen reader hears when
 * the read is done, and where keyboard focus goes when the focused control leaves.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HubLiveChannel } from '../src/lib/publicHub'
import { TWITCH_FOLLOWS_PENDING_KEY, captureTwitchFollowsCallback, takeTwitchFollowsReturn } from '../src/lib/twitchFollowsCallback'
import { resetTwitchFollowsForTests } from '../src/lib/twitchFollows'
import { HubV5Follows, HubV5FollowsButton } from '../src/ui/components/hub/v5/HubV5Follows'

const MIN = 60_000
const END = Date.UTC(2026, 10, 1, 18, 0)
const SAVED_KEY = 'sp.twitchFollows.v1'

function chan(login: string, rate: number | null, viewers: number): HubLiveChannel {
  return {
    login,
    displayName: login.toUpperCase(),
    category: 'Just Chatting',
    streamId: `s-${login}`,
    viewers,
    chatPerMin: 0,
    seventvPerMin: 0,
    coverageState: 'synced',
    trendPct: 0,
    ...(rate == null ? {} : {
      screenerV1: {
        version: 1,
        measuredAt: END,
        baselineKind: 'current_stream_measured_average',
        state: 'ready',
        currentWindow: { start: END - 5 * MIN, end: END, expectedMinutes: 5, measuredMinutes: 5, coveragePct: 100 },
        baselineWindow: null,
        baselineMeasuredMinutes: 40,
        evidence: null,
        chat: { state: 'ready', currentPerMin: rate, baselinePerMin: rate, multiplier: 1, baselineMeasuredMinutes: 40 },
        emotes: null,
      },
    }),
  } as HubLiveChannel
}

const LIVE = [chan('xqc', 120, 50_000), chan('other', 300, 9_000), chan('cozy', null, 4_321)]
const FOLLOWS = { login: 'viewer', name: 'Viewer', logins: ['xqc', 'cozy', 'offline_friend'], total: 3, at: END }

function hub(props: Partial<Parameters<typeof HubV5Follows>[0]> = {}) {
  const page = (p: typeof props) => (
    <MemoryRouter>
      <HubV5FollowsButton />
      <HubV5Follows live={LIVE} nowMs={END + MIN} poolSize={1_000} {...p} />
    </MemoryRouter>
  )
  const view = render(page(props))
  return { ...view, again: (next: typeof props) => view.rerender(page(next)) }
}

const startButton = () => screen.queryByRole('button', { name: /^(Show my Twitch follows|Opening Twitch…)$/ })
const section = () => document.getElementById('follows')
/** The live region the end of a read is said in. */
const said = () => document.querySelector('.hv5-vh[aria-live="polite"]')?.textContent

/** Back from Twitch with a token; Twitch has 150 follows, and the second page waits for the returned release. */
function readingFromTwitch() {
  let release!: () => void
  const gate = new Promise<void>((done) => { release = done })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname === '/oauth2/revoke') return new Response(null)
    if (url.pathname === '/helix/users') return new Response(JSON.stringify({ data: [{ id: '1', login: 'viewer', display_name: 'Viewer' }] }))
    if (!url.searchParams.get('after')) {
      return new Response(JSON.stringify({ total: 150, data: Array.from({ length: 100 }, (_, i) => ({ broadcaster_login: `c${i}` })), pagination: { cursor: 'n' } }))
    }
    await gate
    return new Response(JSON.stringify({ total: 150, data: [{ broadcaster_login: 'xqc' }], pagination: {} }))
  }))
  window.sessionStorage.setItem(TWITCH_FOLLOWS_PENDING_KEY, JSON.stringify({ state: 'f.a', returnTo: '/analytics#follows', at: Date.now() }))
  window.history.replaceState(null, '', '/account/twitch/callback#access_token=abcdefghij0123456789&state=f.a')
  captureTwitchFollowsCallback()
  return () => act(async () => release())
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms))

beforeEach(() => {
  vi.stubEnv('VITE_DEV_FAKE_TWITCH', 'http://127.0.0.1:8098')
  // jsdom has no scrollIntoView
  Element.prototype.scrollIntoView = vi.fn()
  takeTwitchFollowsReturn()
  resetTwitchFollowsForTests()
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/analytics')
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetTwitchFollowsForTests()
})

describe('Show my Twitch follows', () => {
  it('shows neither the button nor the row where the site has no Twitch app', () => {
    vi.stubEnv('VITE_DEV_FAKE_TWITCH', '')
    hub()
    expect(startButton()).toBeNull()
    expect(section()).toBeNull()
  })

  it('offers the button, with its (i), and no row yet', () => {
    hub()
    expect(startButton()?.textContent).toContain('Show my Twitch follows')
    expect(screen.getByRole('button', { name: 'About Show my Twitch follows' })).toBeTruthy()
    expect(section()).toBeNull()
  })

  it('goes to Twitch once, saying so on the button', () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    hub()
    fireEvent.click(startButton()!)
    expect(startButton()?.textContent).toContain('Opening Twitch…')
    expect(startButton()?.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(startButton()!)
    expect(assign).toHaveBeenCalledTimes(1)
  })

  it('shows its progress while Twitch answers, and says when the list is in', async () => {
    const release = readingFromTwitch()
    hub()
    expect(startButton()).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/^Reading your follows from Twitch…$/)
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Reading your follows from Twitch… 100 of 150'))
    // the count moves with each page Twitch sends; a screen reader hears the line once, not each count
    expect(screen.getByRole('status').querySelector('[aria-hidden="true"]')?.textContent).toBe(' 100 of 150')
    expect(said()).toBe('')
    await release()
    await waitFor(() => expect(section()!.querySelector('[data-login="xqc"]')).not.toBeNull())
    expect(screen.getByText(/1 of your 150 follows is live here/)).toBeTruthy()
    await waitFor(() => expect(said()).toBe('1 of your 150 follows is live here'))
  })

  it('says so only once the hub’s live channels are in, once, and not for a list a reload brought back', async () => {
    const release = readingFromTwitch()
    const view = hub({ live: [], loading: true })
    await release()
    await waitFor(() => expect(section()!.querySelector('.hv5-fol-meta')).not.toBeNull())
    await pause(60)
    expect(said()).toBe('')
    view.again({})
    await waitFor(() => expect(said()).toBe('1 of your 150 follows is live here'))
    view.again({ live: [...LIVE, chan('c7', 50, 100)] })
    await pause(60)
    expect(said()).toBe('1 of your 150 follows is live here')

    cleanup()
    resetTwitchFollowsForTests()
    hub()
    expect(section()!.querySelector('.hv5-fol-meta')?.textContent).toContain('1 of your 150 follows is live here')
    await pause(60)
    expect(said()).toBe('')
  })

  it('ranks the live follows on Busiest now’s tiles, with viewers where there is no chat count', () => {
    window.sessionStorage.setItem(SAVED_KEY, JSON.stringify(FOLLOWS))
    hub()
    expect(startButton()).toBeNull()
    const row = section()!
    expect(within(row).getByRole('heading', { name: 'Your follows' })).toBeTruthy()
    expect([...row.querySelectorAll('[data-login]')].map((li) => li.getAttribute('data-login'))).toEqual(['xqc', 'cozy'])
    expect(row.querySelector('.hv5-fol-meta')?.textContent).toContain('2 of your 3 follows are live here · Forget')
    expect(within(row).getByText('Live')).toBeTruthy()
    const [xqc, cozy] = within(row).getAllByRole('link')
    expect(xqc?.textContent).toContain('120 chat/min')
    expect(cozy?.textContent).toContain('4,321 viewers')
    expect(cozy!.getAttribute('aria-label')).toMatch(/^COZY, 4,321 viewers, no chat count, Just Chatting, rank 2 of 2\./)
    expect(xqc!.getAttribute('tabindex')).toBe('0')
    expect(cozy!.getAttribute('tabindex')).toBe('-1')
    expect(within(row).getByRole('button', { name: 'About Your follows' })).toBeTruthy()
  })

  it('says viewer for a channel with one', () => {
    window.sessionStorage.setItem(SAVED_KEY, JSON.stringify(FOLLOWS))
    hub({ live: [chan('cozy', null, 1)] })
    const tile = within(section()!).getByRole('link')
    expect(tile.textContent).toContain('1 viewer')
    expect(tile.textContent).not.toContain('viewers')
    expect(tile.getAttribute('aria-label')).toMatch(/^COZY, 1 viewer, no chat count, /)
  })

  it('shows the pager only while some tiles are out of view', () => {
    window.sessionStorage.setItem(SAVED_KEY, JSON.stringify(FOLLOWS))
    // jsdom lays nothing out: the track is as wide as its tiles
    hub()
    expect(screen.queryByRole('button', { name: 'Next follows' })).toBeNull()
    cleanup()
    vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(1_200)
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(600)
    hub()
    expect(screen.getByRole('button', { name: 'Next follows' }).getAttribute('aria-disabled')).toBe('false')
    expect(screen.getByRole('button', { name: 'Previous follows' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('waits with the hub, and says when the hub is unavailable, without a false "none live"', () => {
    window.sessionStorage.setItem(SAVED_KEY, JSON.stringify(FOLLOWS))
    const view = hub({ live: [], loading: true })
    expect(section()!.querySelector('.hv5-bzs-wait')).not.toBeNull()
    expect(section()!.querySelector('.hv5-fol-meta')?.textContent).toMatch(/^Forget$/)
    expect(screen.queryByRole('button', { name: 'About Your follows' })).toBeNull()
    view.again({ live: [], unavailable: true })
    expect(within(section()!).getByText('Unavailable right now.')).toBeTruthy()
    expect(section()!.querySelector('.hv5-fol-meta')?.textContent).toMatch(/^Forget$/)
    view.again({ live: [chan('other', 300, 9_000)] })
    expect(section()!.querySelector('.hv5-fol-meta')?.textContent).toContain('None of your 3 follows are live here right now · Forget')
    expect(section()!.querySelector('[data-login]')).toBeNull()
  })

  it('Forget takes the row away and puts focus back on the button, in view', async () => {
    window.sessionStorage.setItem(SAVED_KEY, JSON.stringify(FOLLOWS))
    hub()
    fireEvent.click(screen.getByRole('button', { name: 'Forget your Twitch follows' }))
    expect(section()).toBeNull()
    expect(window.sessionStorage.getItem(SAVED_KEY)).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(startButton()))
    const scrolled = vi.mocked(Element.prototype.scrollIntoView)
    expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' })
    expect(scrolled.mock.contexts.at(-1)).toBe(startButton())
  })

  it('says why a sign-in failed, with Try again and Dismiss', async () => {
    window.sessionStorage.setItem(TWITCH_FOLLOWS_PENDING_KEY, JSON.stringify({ state: 'f.a', returnTo: '/analytics#follows', at: Date.now() }))
    window.history.replaceState(null, '', '/account/twitch/callback?error=access_denied&state=f.a')
    captureTwitchFollowsCallback()
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    hub()
    expect(screen.getByRole('alert').textContent).toContain('You cancelled on Twitch, so nothing was read.')
    expect(startButton()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(section()).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(startButton()))
  })

  it('Dismiss puts focus on the row’s heading when the list stays', async () => {
    window.sessionStorage.setItem(SAVED_KEY, JSON.stringify(FOLLOWS))
    window.sessionStorage.setItem(TWITCH_FOLLOWS_PENDING_KEY, JSON.stringify({ state: 'f.a', returnTo: '/analytics#follows', at: Date.now() }))
    window.history.replaceState(null, '', '/account/twitch/callback?error=access_denied&state=f.a')
    captureTwitchFollowsCallback()
    hub()
    expect(screen.getByRole('alert').textContent).toContain('You cancelled on Twitch')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(section()!.querySelector('[data-login="xqc"]')).not.toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Your follows' })))
  })

  it('Try again goes back to Twitch', () => {
    window.sessionStorage.setItem(TWITCH_FOLLOWS_PENDING_KEY, JSON.stringify({ state: 'f.a', returnTo: '/analytics#follows', at: Date.now() }))
    window.history.replaceState(null, '', '/account/twitch/callback?error=server_error&state=f.a')
    captureTwitchFollowsCallback()
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    hub()
    expect(screen.getByRole('alert').textContent).toContain('Twitch didn’t accept the sign-in, so nothing was read.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(assign).toHaveBeenCalledTimes(1)
    expect(section()).toBeNull()
    expect(startButton()?.textContent).toContain('Opening Twitch…')
  })

  it('offers no Try again when the tab’s storage is blocked', () => {
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    hub()
    fireEvent.click(startButton()!)
    expect(screen.getByRole('alert').textContent).toContain('Your browser is blocking this tab’s storage, which the Twitch sign-in needs.')
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy()
  })
})
