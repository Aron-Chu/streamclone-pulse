/**
 * Show my Twitch follows (11-01): the sign-in it starts, the read from Twitch (page by page, then the token is
 * cancelled), why a read fails, the list this tab keeps until Forget or the tab closes, and what Privacy says of it.
 */
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TWITCH_FOLLOWS_PENDING_KEY,
  TWITCH_FOLLOWS_SCOPE,
  captureTwitchFollowsCallback,
  resolveTwitchFollowsSetup,
  takeTwitchFollowsReturn,
} from '../src/lib/twitchFollowsCallback'
import {
  connectTwitchFollows,
  dismissTwitchFollowsFailure,
  forgetTwitchFollows,
  resetTwitchFollowsForTests,
  twitchAuthorizeUrl,
  useTwitchFollows,
} from '../src/lib/twitchFollows'
import Privacy from '../src/routes/public/Privacy'

const FAKE = 'http://127.0.0.1:8098'
const FAKE_CLIENT = 'devfaketwitchclient000000000000'
const TOKEN = 'abcdefghij0123456789klmnop'
const SAVED_KEY = 'sp.twitchFollows.v1'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const USER = { data: [{ id: '42', login: 'Viewer_One', display_name: 'Viewer_One' }] }
const logins = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `chan_${from + i}`)
const page = (names: string[], total: number, cursor?: string) =>
  json({ total, data: names.map((broadcaster_login) => ({ broadcaster_login })), pagination: cursor ? { cursor } : {} })

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>

/** Twitch, played by `handler`; the cancel always answers 200. */
function twitch(handler: Handler) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === '/oauth2/revoke') return new Response(null, { status: 200 })
    return handler(url, init)
  })
  vi.stubGlobal('fetch', fetch)
  const revokes = () => fetch.mock.calls.filter(([u]) => new URL(String(u)).pathname === '/oauth2/revoke')
  const reads = () => fetch.mock.calls.filter(([u]) => new URL(String(u)).pathname.startsWith('/helix/'))
  return { fetch, revokes, reads }
}

/** Back from Twitch with a token, as the callback page leaves it. */
function backWithToken() {
  window.sessionStorage.setItem(TWITCH_FOLLOWS_PENDING_KEY, JSON.stringify({ state: 'f.abc', returnTo: '/analytics#follows', at: Date.now() }))
  window.history.replaceState(null, '', `/account/twitch/callback#access_token=${TOKEN}&scope=user%3Aread%3Afollows&state=f.abc&token_type=bearer`)
  captureTwitchFollowsCallback()
}

beforeEach(() => {
  vi.stubEnv('VITE_DEV_FAKE_TWITCH', FAKE)
  takeTwitchFollowsReturn()
  resetTwitchFollowsForTests()
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/analytics')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetTwitchFollowsForTests()
})

describe('resolveTwitchFollowsSetup', () => {
  it('uses the app registered for the site and for the plain dev server, and nothing anywhere else', () => {
    expect(resolveTwitchFollowsSetup('https://streampulse.stream', null)).toEqual({
      clientId: 'd1n7ykujmr737b2o82mrt0kh94zj8a',
      idOrigin: 'https://id.twitch.tv',
      apiOrigin: 'https://api.twitch.tv',
      redirectUri: 'https://streampulse.stream/account/twitch/callback',
    })
    expect(resolveTwitchFollowsSetup('http://localhost:5173', null)?.clientId).toBe('tu9nskvs2kptj4mrp0py80r3j8uue0')
    for (const origin of ['http://127.0.0.1:5173', 'https://preview.streampulse-main.pages.dev', 'https://www.streampulse.stream', '__proto__', 'constructor']) {
      expect(resolveTwitchFollowsSetup(origin, null)).toBeNull()
    }
  })

  it('sends everything to the dev stand-in when one is set', () => {
    expect(resolveTwitchFollowsSetup('http://127.0.0.1:14500', FAKE)).toEqual({
      clientId: FAKE_CLIENT,
      idOrigin: FAKE,
      apiOrigin: FAKE,
      redirectUri: 'http://127.0.0.1:14500/account/twitch/callback',
    })
  })

  it('asks Twitch for a token with the follows permission only', () => {
    const url = new URL(twitchAuthorizeUrl(resolveTwitchFollowsSetup('https://streampulse.stream', null)!, 'f.xyz'))
    expect(`${url.origin}${url.pathname}`).toBe('https://id.twitch.tv/oauth2/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'token',
      client_id: 'd1n7ykujmr737b2o82mrt0kh94zj8a',
      redirect_uri: 'https://streampulse.stream/account/twitch/callback',
      scope: 'user:read:follows',
      state: 'f.xyz',
    })
  })
})

describe('the follows store', () => {
  it('is off where the site has no Twitch app', () => {
    vi.stubEnv('VITE_DEV_FAKE_TWITCH', '')
    const { result } = renderHook(() => useTwitchFollows())
    expect(result.current).toEqual({ status: 'off' })
  })

  it('ignores a dev stand-in that is not on this machine', () => {
    vi.stubEnv('VITE_DEV_FAKE_TWITCH', 'https://twitch.example')
    const { result } = renderHook(() => useTwitchFollows())
    expect(result.current).toEqual({ status: 'off' })
  })

  it('goes to Twitch with a fresh state, remembers the sign-in it started, and shows Opening', () => {
    window.history.replaceState(null, '', '/analytics?window=1h')
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    const { result } = renderHook(() => useTwitchFollows())
    expect(result.current).toEqual({ status: 'idle' })
    act(() => connectTwitchFollows())
    expect(result.current).toEqual({ status: 'opening' })
    expect(assign).toHaveBeenCalledTimes(1)
    const url = new URL(assign.mock.calls[0]![0] as string)
    expect(`${url.origin}${url.pathname}`).toBe(`${FAKE}/oauth2/authorize`)
    const state = url.searchParams.get('state')!
    expect(state).toMatch(/^f\.[0-9a-f]{32}$/)
    expect(url.searchParams.get('redirect_uri')).toBe(`${window.location.origin}/account/twitch/callback`)
    const saved = JSON.parse(window.sessionStorage.getItem(TWITCH_FOLLOWS_PENDING_KEY)!)
    expect(saved).toEqual({ state, returnTo: '/analytics?window=1h#follows', at: expect.any(Number) })
    act(() => connectTwitchFollows())
    expect(assign).toHaveBeenCalledTimes(1)
  })

  it('says so when the tab cannot keep the sign-in, without leaving the page', () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'QuotaExceededError')
    })
    const { result } = renderHook(() => useTwitchFollows())
    act(() => connectTwitchFollows())
    expect(result.current).toEqual({ status: 'failed', why: 'storage' })
    expect(assign).not.toHaveBeenCalled()
  })

  it('gives the button back when the trip to Twitch never leaves the page (Stop, or Esc)', () => {
    vi.useFakeTimers()
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    const { result } = renderHook(() => useTwitchFollows())
    act(() => connectTwitchFollows())
    act(() => { vi.advanceTimersByTime(7_999) })
    expect(result.current.status).toBe('opening')
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toEqual({ status: 'idle' })
    act(() => connectTwitchFollows())
    expect(assign).toHaveBeenCalledTimes(2)
    // a page that did leave and came back from the back/forward cache, its timer still due, keeps what it shows
    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })) })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'QuotaExceededError')
    })
    act(() => connectTwitchFollows())
    act(() => { vi.advanceTimersByTime(8_000) })
    expect(result.current).toEqual({ status: 'failed', why: 'storage' })
  })

  it('shows the button again when the viewer comes back from Twitch’s page with Back', () => {
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() })
    const { result } = renderHook(() => useTwitchFollows())
    act(() => connectTwitchFollows())
    expect(result.current.status).toBe('opening')
    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })) })
    expect(result.current.status).toBe('opening')
    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })) })
    expect(result.current).toEqual({ status: 'idle' })
  })

  it('reads the account and its follows a page at a time, keeps only the logins, and cancels the token', async () => {
    let release!: () => void
    const gate = new Promise<void>((done) => { release = done })
    const first = [...logins(97), 'CHAN_0', 'not a login', 'Big_Streamer']
    const tw = twitch(async (url) => {
      if (url.pathname === '/helix/users') return json(USER)
      if (!url.searchParams.get('after')) return page(first, 140, 'c1')
      await gate
      return page(logins(40, 100), 140)
    })
    backWithToken()
    const { result } = renderHook(() => useTwitchFollows())
    expect(result.current).toEqual({ status: 'reading', read: 0, total: null })
    await waitFor(() => expect(result.current).toEqual({ status: 'reading', read: 98, total: 140 }))
    release()
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const follows = result.current.status === 'ready' ? result.current.follows : null
    expect(follows).toMatchObject({ login: 'viewer_one', name: 'Viewer_One', total: 140 })
    expect(follows!.logins).toHaveLength(138)
    expect(follows!.logins).toContain('big_streamer')
    expect(follows!.logins).not.toContain('not a login')

    const [users, page1, page2] = tw.reads()
    expect(new URL(String(users![0])).href).toBe(`${FAKE}/helix/users`)
    expect(Object.fromEntries(new URL(String(page1![0])).searchParams)).toEqual({ user_id: '42', first: '100' })
    expect(Object.fromEntries(new URL(String(page2![0])).searchParams)).toEqual({ user_id: '42', first: '100', after: 'c1' })
    expect(users![1]).toMatchObject({
      headers: { Authorization: `Bearer ${TOKEN}`, 'Client-Id': FAKE_CLIENT },
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    expect(tw.revokes()).toHaveLength(1)
    const [revokeUrl, revokeInit] = tw.revokes()[0]!
    expect(String(revokeUrl)).toBe(`${FAKE}/oauth2/revoke`)
    expect(revokeInit).toMatchObject({ method: 'POST', credentials: 'omit', keepalive: true })
    expect(Object.fromEntries(revokeInit!.body as URLSearchParams)).toEqual({ client_id: FAKE_CLIENT, token: TOKEN })

    const kept = window.sessionStorage.getItem(SAVED_KEY)!
    expect(JSON.parse(kept)).toEqual(follows)
    for (let i = 0; i < window.sessionStorage.length; i++) {
      expect(window.sessionStorage.getItem(window.sessionStorage.key(i)!)).not.toContain(TOKEN)
    }
    expect(window.location.href).not.toContain(TOKEN)
  })

  it('stops at 3,000 follows and keeps Twitch’s count', async () => {
    const tw = twitch((url) => {
      if (url.pathname === '/helix/users') return json(USER)
      const at = Number(url.searchParams.get('after') ?? 0)
      return page(logins(100, at), 3_200, String(at + 100))
    })
    backWithToken()
    const { result } = renderHook(() => useTwitchFollows())
    await waitFor(() => expect(result.current.status).toBe('ready'), { timeout: 10_000 })
    const follows = result.current.status === 'ready' ? result.current.follows : null
    expect(follows!.logins).toHaveLength(3_000)
    expect(follows!.total).toBe(3_200)
    expect(tw.reads()).toHaveLength(31)
  })

  it('reads an account that follows nobody', async () => {
    twitch((url) => (url.pathname === '/helix/users' ? json(USER) : page([], 0)))
    backWithToken()
    const { result } = renderHook(() => useTwitchFollows())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current).toMatchObject({ status: 'ready', follows: { logins: [], total: 0 } })
  })

  const failures: Array<[string, Handler, 'rejected' | 'unreachable']> = [
    ['a refused token', () => json({ status: 401 }, 401), 'rejected'],
    ['a forbidden read', () => json({ status: 403 }, 403), 'rejected'],
    ['too many requests', () => json({ status: 429 }, 429), 'unreachable'],
    ['Twitch down', () => json({ status: 503 }, 503), 'unreachable'],
    ['no answer', () => { throw new TypeError('Failed to fetch') }, 'unreachable'],
    ['a broken body', () => new Response('<html>', { status: 200 }), 'unreachable'],
    ['no account', (url) => (url.pathname === '/helix/users' ? json({ data: [] }) : page([], 0)), 'rejected'],
    ['an odd account', (url) => (url.pathname === '/helix/users' ? json({ data: [{ id: 42, login: 'x' }] }) : page([], 0)), 'rejected'],
    ['a failed second page', (url) => (url.pathname === '/helix/users' ? json(USER) : url.searchParams.get('after') ? json({}, 500) : page(logins(100), 150, 'c1')), 'unreachable'],
    ['a page without data', (url) => (url.pathname === '/helix/users' ? json(USER) : json({ total: 3 })), 'unreachable'],
  ]
  it.each(failures)('reads %s as %s, keeps nothing, and still cancels the token', async (_name, handler, why) => {
    const tw = twitch(handler)
    backWithToken()
    const { result } = renderHook(() => useTwitchFollows())
    await waitFor(() => expect(result.current.status).toBe('failed'))
    expect(result.current).toEqual({ status: 'failed', why })
    expect(window.sessionStorage.getItem(SAVED_KEY)).toBeNull()
    expect(tw.revokes()).toHaveLength(1)
  })

  it('cancels the token as the tab leaves mid-read, and calls the read it cut short unfinished', async () => {
    let release!: () => void
    const gate = new Promise<void>((done) => { release = done })
    const tw = twitch(async (url) => {
      if (url.pathname === '/helix/users') return json(USER)
      if (!url.searchParams.get('after')) return page(logins(100), 150, 'c1')
      await gate
      return json({ status: 401 }, 401)
    })
    backWithToken()
    const { result } = renderHook(() => useTwitchFollows())
    await waitFor(() => expect(result.current).toEqual({ status: 'reading', read: 100, total: 150 }))
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    expect(tw.revokes()).toHaveLength(1)
    expect(Object.fromEntries(tw.revokes()[0]![1]!.body as URLSearchParams)).toEqual({ client_id: FAKE_CLIENT, token: TOKEN })
    // back from the back/forward cache, Twitch refuses the cancelled token
    release()
    await waitFor(() => expect(result.current).toEqual({ status: 'failed', why: 'unfinished' }))
    expect(tw.revokes()).toHaveLength(1)
    expect(window.sessionStorage.getItem(SAVED_KEY)).toBeNull()
  })

  it('cancels a token that comes back unused; Back past a finished read keeps the list', () => {
    const tw = twitch(() => json({}, 500))
    const follows = { login: 'viewer_one', name: 'Viewer_One', logins: ['xqc'], total: 1, at: 1 }
    window.sessionStorage.setItem(SAVED_KEY, JSON.stringify(follows))
    // Back from the hub reaches Twitch's sign-in again, which sends a new token straight back: no sign-in is under way
    window.history.replaceState(null, '', `/account/twitch/callback#access_token=${TOKEN}&scope=user%3Aread%3Afollows&state=f.abc&token_type=bearer`)
    captureTwitchFollowsCallback()
    const { result } = renderHook(() => useTwitchFollows())
    expect(result.current).toEqual({ status: 'ready', follows })
    expect(tw.reads()).toHaveLength(0)
    expect(tw.revokes()).toHaveLength(1)
    expect(Object.fromEntries(tw.revokes()[0]![1]!.body as URLSearchParams)).toEqual({ client_id: FAKE_CLIENT, token: TOKEN })
  })

  it('cancels the token of a sign-in it turns down', () => {
    const tw = twitch(() => json({}, 500))
    window.sessionStorage.setItem(TWITCH_FOLLOWS_PENDING_KEY, JSON.stringify({ state: 'f.abc', returnTo: '/analytics#follows', at: Date.now() }))
    window.history.replaceState(null, '', `/account/twitch/callback#access_token=${TOKEN}&scope=user%3Aread%3Aemail&state=f.abc&token_type=bearer`)
    captureTwitchFollowsCallback()
    const { result } = renderHook(() => useTwitchFollows())
    expect(result.current).toEqual({ status: 'failed', why: 'rejected' })
    expect(tw.reads()).toHaveLength(0)
    expect(tw.revokes()).toHaveLength(1)
  })

  it('back from the back/forward cache, shows the list as a later page in this tab left it', () => {
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() })
    const { result } = renderHook(() => useTwitchFollows())
    act(() => connectTwitchFollows())
    // the page Twitch sent the viewer back to read the list; Back twice returns here
    const follows = { login: 'viewer_one', name: 'Viewer_One', logins: ['xqc'], total: 1, at: 1 }
    window.sessionStorage.setItem(SAVED_KEY, JSON.stringify(follows))
    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })) })
    expect(result.current).toEqual({ status: 'ready', follows })
    // a later page forgot it
    window.sessionStorage.removeItem(SAVED_KEY)
    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })) })
    expect(result.current).toEqual({ status: 'idle' })
  })

  it('shows a sign-in Twitch turned down', () => {
    window.sessionStorage.setItem(TWITCH_FOLLOWS_PENDING_KEY, JSON.stringify({ state: 'f.abc', returnTo: '/analytics#follows', at: Date.now() }))
    window.history.replaceState(null, '', '/account/twitch/callback?error=access_denied&state=f.abc')
    captureTwitchFollowsCallback()
    const { result } = renderHook(() => useTwitchFollows())
    expect(result.current).toEqual({ status: 'failed', why: 'denied' })
  })

  it('brings this tab’s list back after a reload, and drops a damaged one', () => {
    const follows = { login: 'viewer_one', name: 'Viewer_One', logins: ['xqc'], total: 1, at: 1 }
    window.sessionStorage.setItem(SAVED_KEY, JSON.stringify(follows))
    expect(renderHook(() => useTwitchFollows()).result.current).toEqual({ status: 'ready', follows })

    resetTwitchFollowsForTests()
    window.sessionStorage.setItem(SAVED_KEY, JSON.stringify({ ...follows, logins: ['<script>'] }))
    expect(renderHook(() => useTwitchFollows()).result.current).toEqual({ status: 'idle' })
    expect(window.sessionStorage.getItem(SAVED_KEY)).toBeNull()
  })

  it('Forget drops the list; Dismiss goes back to the list, or to the button', () => {
    const follows = { login: 'viewer_one', name: 'Viewer_One', logins: ['xqc'], total: 1, at: 1 }
    window.sessionStorage.setItem(SAVED_KEY, JSON.stringify(follows))
    const { result } = renderHook(() => useTwitchFollows())
    expect(result.current.status).toBe('ready')
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('blocked', 'QuotaExceededError')
    })
    act(() => connectTwitchFollows())
    expect(result.current).toEqual({ status: 'failed', why: 'storage' })
    act(() => dismissTwitchFollowsFailure())
    expect(result.current).toEqual({ status: 'ready', follows })
    act(() => forgetTwitchFollows())
    expect(result.current).toEqual({ status: 'idle' })
    expect(window.sessionStorage.getItem(SAVED_KEY)).toBeNull()
  })
})

describe('Privacy', () => {
  it('names the permission and both keys this tab keeps, and says StreamPulse’s servers are not involved', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    expect(screen.getByTestId('privacy-twitch-follows').textContent).toContain(TWITCH_FOLLOWS_SCOPE)
    const policy = screen.getByTestId('privacy-policy').textContent ?? ''
    expect(policy).toContain(TWITCH_FOLLOWS_PENDING_KEY)
    expect(policy).toContain(SAVED_KEY)
    expect(screen.getByTestId('privacy-third-party-twitch').textContent).toMatch(/StreamPulse's servers are not involved/)
  })
})
