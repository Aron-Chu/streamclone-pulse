/**
 * Show my Twitch follows, the way back (11-01): before the app starts, the callback page checks the sign-in
 * against the one this tab started, keeps the token in memory only, puts the address back, and has Twitch cancel
 * any token the hub will not read.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isPrivateSupporterRoute } from '../src/lib/accountRestore'
import {
  TWITCH_FOLLOWS_MAX_AGE_MS,
  TWITCH_FOLLOWS_PENDING_KEY,
  captureTwitchFollowsCallback,
  takeTwitchFollowsReturn,
} from '../src/lib/twitchFollowsCallback'

const TOKEN = 'abcdefghij0123456789klmnop' // gitleaks:allow (made-up test token)
const STATE = 'f.0123456789abcdef0123456789abcdef'
const FAKE = 'http://127.0.0.1:8098'

/** Twitch's cancel, on the dev stand-in so this origin has a Twitch app. */
function cancels() {
  vi.stubEnv('VITE_DEV_FAKE_TWITCH', FAKE)
  const fetch = vi.fn(async () => new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  return () => fetch.mock.calls.map((call) => {
    const [url, init] = call as unknown as [string, RequestInit]
    return { url: String(url), ...Object.fromEntries(init.body as URLSearchParams) }
  })
}
const cancelled = { url: `${FAKE}/oauth2/revoke`, client_id: 'devfaketwitchclient000000000000', token: TOKEN }

function pending(over: Record<string, unknown> = {}) {
  window.sessionStorage.setItem(TWITCH_FOLLOWS_PENDING_KEY, JSON.stringify({ state: STATE, returnTo: '/analytics?window=1h#follows', at: Date.now(), ...over }))
}

function arrive(url: string) {
  window.history.replaceState(null, '', url)
  captureTwitchFollowsCallback()
}

const here = () => `${window.location.pathname}${window.location.search}${window.location.hash}`
const tokenBack = (over: Record<string, string> = {}) =>
  `/account/twitch/callback#${new URLSearchParams({ access_token: TOKEN, scope: 'user:read:follows', state: STATE, token_type: 'bearer', ...over })}`

beforeEach(() => {
  takeTwitchFollowsReturn()
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('captureTwitchFollowsCallback', () => {
  it('takes the token, clears the address and the started sign-in, and goes back to the page that asked', () => {
    pending()
    arrive(tokenBack())
    expect(here()).toBe('/analytics?window=1h#follows')
    expect(window.sessionStorage.getItem(TWITCH_FOLLOWS_PENDING_KEY)).toBeNull()
    expect(takeTwitchFollowsReturn()).toEqual({ token: TOKEN })
    expect(takeTwitchFollowsReturn()).toBeNull()
  })

  it('also answers on the trailing-slash path and with several scopes', () => {
    pending()
    arrive(`/account/twitch/callback/#${new URLSearchParams({ access_token: TOKEN, scope: 'user:read:email user:read:follows', state: STATE })}`)
    expect(takeTwitchFollowsReturn()).toEqual({ token: TOKEN })
  })

  it('leaves other pages and other sign-ins alone', () => {
    pending()
    arrive('/analytics#access_token=abcdefghij0123456789') // gitleaks:allow (made-up test token)
    expect(here()).toBe('/analytics#access_token=abcdefghij0123456789') // gitleaks:allow (made-up test token)
    arrive('/account/twitch/callback?code=servercode&state=s.other')
    expect(here()).toBe('/account/twitch/callback?code=servercode&state=s.other')
    arrive('/account/twitch/callback?error=access_denied&state=s.other')
    expect(here()).toBe('/account/twitch/callback?error=access_denied&state=s.other')
    expect(window.sessionStorage.getItem(TWITCH_FOLLOWS_PENDING_KEY)).not.toBeNull()
    expect(takeTwitchFollowsReturn()).toBeNull()
  })

  it('reads a "no" from Twitch as cancelled, and any other error as refused', () => {
    pending()
    arrive(`/account/twitch/callback?error=access_denied&error_description=The+user+denied+you+access&state=${STATE}`)
    expect(here()).toBe('/analytics?window=1h#follows')
    expect(takeTwitchFollowsReturn()).toEqual({ failed: 'denied' })
    pending()
    arrive(`/account/twitch/callback?error=server_error&state=${STATE}`)
    expect(takeTwitchFollowsReturn()).toEqual({ failed: 'rejected' })
  })

  it('calls a sign-in this tab did not start, or started too long ago, unfinished, cancels its token, and sends it to the hub', () => {
    const sent = cancels()
    arrive(tokenBack())
    expect(here()).toBe('/analytics#follows')
    expect(takeTwitchFollowsReturn()).toEqual({ failed: 'unfinished' })

    pending({ state: 'f.someotherstate' })
    arrive(tokenBack())
    expect(takeTwitchFollowsReturn()).toEqual({ failed: 'unfinished' })

    pending({ at: Date.now() - TWITCH_FOLLOWS_MAX_AGE_MS - 1 })
    arrive(tokenBack())
    expect(takeTwitchFollowsReturn()).toEqual({ failed: 'unfinished' })

    pending({ at: Date.now() + 60_000 })
    arrive(tokenBack())
    expect(takeTwitchFollowsReturn()).toEqual({ failed: 'unfinished' })
    expect(sent()).toEqual([cancelled, cancelled, cancelled, cancelled])

    // a string that is not a token goes nowhere
    arrive(tokenBack({ access_token: 'short' }))
    expect(takeTwitchFollowsReturn()).toEqual({ failed: 'unfinished' })
    expect(sent()).toHaveLength(4)
  })

  it('refuses a token without the follows permission (cancelling it) or with an odd shape', () => {
    const sent = cancels()
    pending()
    arrive(tokenBack({ scope: 'user:read:email' }))
    expect(takeTwitchFollowsReturn()).toEqual({ failed: 'rejected' })
    expect(sent()).toEqual([cancelled])
    for (const bad of ['short', 'abcdefghij-0123456789', `${'a'.repeat(129)}`]) {
      pending()
      arrive(tokenBack({ access_token: bad }))
      expect(takeTwitchFollowsReturn()).toEqual({ failed: 'rejected' })
    }
    expect(sent()).toHaveLength(1)
  })

  it('cancels a token the hub never took as the page goes, once, and calls that sign-in unfinished', () => {
    const sent = cancels()
    pending()
    arrive(tokenBack())
    expect(sent()).toEqual([])
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))
    expect(sent()).toEqual([cancelled])
    // back from the back/forward cache, the hub finds a sign-in that did not finish
    expect(takeTwitchFollowsReturn()).toEqual({ failed: 'unfinished' })
  })

  it('leaves a token the hub took to the hub', () => {
    const sent = cancels()
    pending()
    arrive(tokenBack())
    expect(takeTwitchFollowsReturn()).toEqual({ token: TOKEN })
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))
    expect(sent()).toEqual([])
  })

  it('never goes back to another site', () => {
    for (const returnTo of ['//evil.example/x', 'https://evil.example/', '/\\evil.example', 'analytics', '/analytics x', 42]) {
      pending({ returnTo })
      arrive(tokenBack())
      expect(here()).toBe('/analytics#follows')
      expect(takeTwitchFollowsReturn()).toEqual({ token: TOKEN })
    }
  })

  it('treats storage it cannot read as a sign-in it cannot check', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    arrive(tokenBack())
    expect(here()).toBe('/analytics#follows')
    expect(takeTwitchFollowsReturn()).toEqual({ failed: 'unfinished' })
  })

  it('lets the result go after 15 minutes, cancelling its token', () => {
    const sent = cancels()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 10, 1, 12))
    pending()
    arrive(tokenBack())
    vi.setSystemTime(Date.UTC(2026, 10, 1, 12) + TWITCH_FOLLOWS_MAX_AGE_MS)
    expect(takeTwitchFollowsReturn()).toBeNull()
    expect(sent()).toEqual([cancelled])
  })

  it('runs in the portal entry before diagnostics start, which stay off for a page that opened on the callback', () => {
    const main = readFileSync(resolve(__dirname, '../src/main.tsx'), 'utf8')
    const privateLoad = main.indexOf('\nconst privateLoad = isPrivateSupporterRoute(window.location.pathname)')
    const capture = main.indexOf('\ncaptureTwitchFollowsCallback()')
    const sentry = main.indexOf('\nif (!privateLoad) initPortalSentry()')
    expect(privateLoad).toBeGreaterThan(-1)
    expect(capture).toBeGreaterThan(privateLoad)
    expect(sentry).toBeGreaterThan(capture)
    expect(main.match(/initPortalSentry\(\)/g)).toHaveLength(1)
    expect(isPrivateSupporterRoute('/account/twitch/callback')).toBe(true)
  })
})
