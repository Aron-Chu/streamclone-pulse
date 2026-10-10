// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountConnection } from '../src/options/AccountConnection.tsx'
import { twitchOutcomeMessage } from '../src/options/TwitchAccountConnection.tsx'
import { TWITCH_SIGNIN_ENABLED, type TwitchSignInOutcome, type TwitchSignInStatus } from '../src/shared/twitchSignIn.ts'
import { findStoreDeveloperMarkers } from '../scripts/store-artifact-policy.mjs'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222'
const linked = { state: 'linked', accountId: ACCOUNT_ID, expiresAt: new Date(Date.now() + 86_400_000).toISOString() }
const profile = { displayName: 'PulseFan', picture: 'https://static-cdn.jtvnw.net/jtv_user_pictures/fan.png' }
const status = (overrides: Partial<TwitchSignInStatus> = {}): TwitchSignInStatus => ({ enabled: true, available: true, silentEligible: false, profile: null, ...overrides })

type Message = { type: string; action?: string; mode?: string; forceVerify?: boolean }

function worker(options: { account?: unknown; status?: TwitchSignInStatus; signIn?: (message: Message) => unknown } = {}) {
  let account = options.account ?? { state: 'signed_out' }
  let twitch = options.status ?? status()
  const send = vi.fn(async (message: Message) => {
    if (message.type === 'SUPPORTER_ACCOUNT') {
      if (message.action === 'disconnect') { account = { state: 'signed_out' }; twitch = { ...twitch, profile: null } }
      return { type: 'SUPPORTER_ACCOUNT', account }
    }
    if (message.type === 'TWITCH_SIGN_IN' && message.action === 'status') return { type: 'TWITCH_SIGN_IN', status: twitch, account }
    if (message.type === 'TWITCH_SIGN_IN') {
      const response = (options.signIn?.(message) ?? { outcome: 'signed_in', account: linked, status: status({ profile }) }) as { account: unknown; status: TwitchSignInStatus }
      account = response.account
      twitch = response.status
      return { type: 'TWITCH_SIGN_IN', ...response }
    }
    throw new Error(`unexpected ${message.type}`)
  })
  vi.stubGlobal('chrome', { runtime: { sendMessage: send } })
  return send
}

let host: HTMLDivElement
let root: Root
async function render(twitchSignIn?: boolean) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(twitchSignIn === undefined ? <AccountConnection /> : <AccountConnection twitchSignIn={twitchSignIn} />))
}
const buttons = () => [...host.querySelectorAll('button')].map(button => button.textContent)
const button = (label: string) => [...host.querySelectorAll('button')].find(item => item.textContent === label)!
const twitchCalls = (send: ReturnType<typeof worker>) => send.mock.calls.map(([message]) => message).filter(message => message.type === 'TWITCH_SIGN_IN')

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  vi.unstubAllGlobals()
})

describe('Pulse account card with Sign in with Twitch off (the build default)', () => {
  it('keeps the device-code card exactly and never asks the worker about Twitch', async () => {
    expect(TWITCH_SIGNIN_ENABLED).toBe(false)
    const send = worker()
    await render()
    expect(host.textContent).toContain('Connect this extension to your Pulse account.')
    expect(buttons()).toEqual(['Link extension'])
    expect(host.querySelector('.pulse-twitch-signin')).toBeNull()
    expect(host.querySelector('details')).toBeNull()
    expect(host.textContent).not.toContain('Twitch')
    expect(twitchCalls(send)).toHaveLength(0)
  })

  it('keeps the original linked copy and disconnect action', async () => {
    worker({ account: linked })
    await render(false)
    expect(host.textContent).toContain('This extension is connected.')
    expect(host.textContent).toContain('does not confirm a subscription or link your Twitch identity')
    expect(buttons()).toEqual(['Disconnect extension'])
  })
})

describe('Pulse account card with Sign in with Twitch on', () => {
  it('leads with a Twitch-branded Continue with Twitch button and tucks the code flow under Other ways to connect (testers)', async () => {
    worker()
    await render(true)
    const signIn = host.querySelector<HTMLButtonElement>('button.pulse-twitch-signin')!
    expect(signIn.textContent).toBe('Continue with Twitch')
    expect(signIn.querySelector('svg.pulse-twitch-glitch[aria-hidden="true"]')).not.toBeNull()
    expect(host.textContent).toContain('Free tools work without an account.')
    const details = host.querySelector('details.pulse-account-other-ways')!
    expect(details.querySelector('summary')!.textContent).toBe('Other ways to connect (testers)')
    expect(details.hasAttribute('open')).toBe(false)
    expect(details.textContent).toContain('Link with a code')
  })

  it('signs in through the worker and shows the returned name and avatar for display only', async () => {
    const send = worker()
    await render(true)
    await act(async () => host.querySelector<HTMLButtonElement>('button.pulse-twitch-signin')!.click())
    expect(send).toHaveBeenCalledWith({ type: 'TWITCH_SIGN_IN', action: 'sign_in', mode: 'interactive' })
    expect(host.textContent).toContain('Signed in with Twitch as PulseFan')
    const avatar = host.querySelector<HTMLImageElement>('img.pulse-account-avatar')!
    expect(avatar.src).toBe(profile.picture)
    expect(avatar.alt).toBe('')
    expect(avatar.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(buttons()).toEqual(['Sign out', 'Not you?'])
    expect(host.querySelector('details')).toBeNull()
    expect(host.querySelector('.pulse-twitch-signin')).toBeNull()
  })

  it('"Not you?" forces the account chooser and Sign out uses the existing disconnect', async () => {
    const send = worker({ account: linked, status: status({ profile }) })
    await render(true)
    expect(host.textContent).toContain('Signed in with Twitch as PulseFan')
    await act(async () => button('Not you?').click())
    expect(send).toHaveBeenLastCalledWith({ type: 'TWITCH_SIGN_IN', action: 'sign_in', mode: 'interactive', forceVerify: true })
    await act(async () => button('Sign out').click())
    expect(send).toHaveBeenLastCalledWith({ type: 'SUPPORTER_ACCOUNT', action: 'disconnect' })
    expect(host.querySelector('.pulse-twitch-signin')).not.toBeNull()
    expect(host.textContent).not.toContain('PulseFan')
  })

  it('without a session profile still offers a plain switch-account action', async () => {
    worker({ account: linked })
    await render(true)
    expect(host.textContent).toContain('Signed in')
    expect(host.querySelector('img')).toBeNull()
    expect(buttons()).toEqual(['Sign out', 'Use a different Twitch account'])
  })

  it('explains each failure in plain words that say what to do', async () => {
    for (const [outcome, copy, retryAfterSeconds] of [
      ['pilot_only', 'Twitch sign-in is open to invited testers right now.', undefined],
      ['link_required', 'This Twitch account isn’t linked to a StreamPulse account yet. Invited testers can connect with a one-time code below instead.', undefined],
      ['identity_in_use', 'That Twitch account already has its own StreamPulse account. We never combine accounts. Contact us if one of them has a membership.', undefined],
      ['cancelled', 'Sign-in was cancelled. Select Continue with Twitch to try again.', undefined],
      ['signup_unavailable', 'try again in about 2 minutes', 120],
      ['state_mismatch', 'nothing changed. Try again.', undefined],
    ] as const) {
      worker({ signIn: () => ({ outcome, retryAfterSeconds, account: { state: 'signed_out' }, status: status() }) })
      await render(true)
      await act(async () => host.querySelector<HTMLButtonElement>('button.pulse-twitch-signin')!.click())
      expect(host.textContent).toContain(copy)
      expect(host.querySelector('.pulse-twitch-signin')).not.toBeNull()
      act(() => root.unmount()); host.remove(); vi.unstubAllGlobals()
    }
    expect(twitchOutcomeMessage('signed_in')).toBe('')
    // A server revoke shows the button only.
    expect(twitchOutcomeMessage('revoked')).toBe('')
    expect(twitchOutcomeMessage('try_later', 30)).toContain('about 1 minute.')
  })

  it('keeps every outcome message free of store developer-tooling markers', () => {
    // SupporterJourney imports this copy into store options bundles, which the
    // package validator scans for developer tooling text.
    const outcomes: TwitchSignInOutcome[] = [
      'signed_in', 'already_signed_in', 'interaction_required', 'revoked', 'cancelled', 'state_mismatch', 'token_invalid',
      'flow_expired', 'pilot_only', 'link_required', 'identity_in_use', 'account_deleted', 'signup_unavailable', 'try_later',
      'surface_unavailable', 'redirect_mismatch', 'auth_window_failed', 'network', 'unavailable', 'hosted_only',
      'revocation_pending', 'busy', 'disabled', 'unsupported', 'error',
    ]
    for (const outcome of outcomes) expect(findStoreDeveloperMarkers(twitchOutcomeMessage(outcome, 30))).toEqual([])
    expect(twitchOutcomeMessage('hosted_only')).toContain('hosted StreamPulse service')
  })

  it('tries a silent sign-in once on first install and stays quiet when it needs a click', async () => {
    const send = worker({ status: status({ silentEligible: true }), signIn: () => ({ outcome: 'interaction_required', account: { state: 'signed_out' }, status: status() }) })
    await render(true)
    const silent = twitchCalls(send).filter(message => message.action === 'sign_in')
    expect(silent).toEqual([{ type: 'TWITCH_SIGN_IN', action: 'sign_in', mode: 'silent' }])
    expect(host.textContent).not.toContain('Select Continue with Twitch to continue.')
    expect(host.querySelector('.pulse-twitch-signin')).not.toBeNull()
  })

  it('never tries silent sign-in when the worker says it is not a first install', async () => {
    const send = worker()
    await render(true)
    expect(twitchCalls(send).filter(message => message.action === 'sign_in')).toHaveLength(0)
  })

  it('opens Other ways to connect while a device code is pending', async () => {
    worker({ account: { state: 'pending', code: 'ABCDE-12345', expiresAt: new Date(Date.now() + 600_000).toISOString(), retryAfterSeconds: 5 } })
    await render(true)
    const details = host.querySelector('details.pulse-account-other-ways')!
    expect(details.hasAttribute('open')).toBe(true)
    expect(details.textContent).toContain('ABCDE-12345')
    expect(details.querySelector('a')!.getAttribute('href')).toBe('https://streampulse.stream/account/link-device#code=ABCDE12345')
    expect(buttons()).toContain('Cancel code')
  })

  it('starts a device code from the disclosure', async () => {
    const send = worker()
    await render(true)
    await act(async () => button('Link with a code').click())
    expect(send).toHaveBeenLastCalledWith({ type: 'SUPPORTER_ACCOUNT', action: 'start' })
  })

  it('falls back to the device-code card where the browser has no identity API (Firefox for Android)', async () => {
    worker({ status: status({ available: false }) })
    await render(true)
    expect(host.querySelector('.pulse-twitch-signin')).toBeNull()
    expect(host.querySelector('details')).toBeNull()
    expect(host.textContent).toContain('Connect this extension to your Pulse account.')
    expect(buttons()).toEqual(['Link extension'])
  })

  it('offers Retry sign out instead of signing in over an unconfirmed revocation', async () => {
    worker({ account: { state: 'error', revocationPending: true } })
    await render(true)
    expect(buttons()).toEqual(['Retry sign out'])
    expect(host.querySelector('.pulse-twitch-signin')).toBeNull()
  })
})
