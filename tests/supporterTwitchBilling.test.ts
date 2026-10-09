import { describe, expect, it, vi } from 'vitest'
import { SupporterAccountCoordinator } from '../src/background/supporterAccount.ts'
import { SupporterPayFirstCoordinator } from '../src/background/supporterPayFirst.ts'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'
import type { TwitchSignInMode, TwitchStepUpResult } from '../src/shared/twitchSignIn.ts'

/**
 * Account journey spec (closeout 2026-10-08b) §2 E2: with Twitch sign-in on,
 * the worker's Checkout and portal need a signed-in account (`ensureSignedIn`
 * replaces `ensureInstallation`), a portal that answers 403
 * `recent_auth_required` gets one silent step-up (or the click's interactive
 * one) and one retry, and a check that names a different Twitch account never
 * opens the portal.
 */
const now = Date.parse('2026-10-08T12:00:00Z')
const iso = (delta: number) => new Date(now + delta).toISOString()
const credentials = { accountId: '22222222-2222-4222-8222-222222222222', deviceId: '11111111-1111-4111-8111-111111111111', token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), expiresAt: iso(86_400_000), refreshExpiresAt: iso(90 * 86_400_000) }
const attemptId = '33333333-3333-4333-8333-333333333333'
const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_local'
const PORTAL_URL = 'https://billing.stripe.com/p/session/test_local'

type Reply = { status: number; body: unknown }

function fixture({ signedIn = true, twitchSignIn = true, membership: changes = {}, stepUp }: { signedIn?: boolean; twitchSignIn?: boolean; membership?: Record<string, unknown>; stepUp?: (mode: TwitchSignInMode) => Promise<TwitchStepUpResult> } = {}) {
  let account: unknown = signedIn ? { kind: 'linked', ...credentials } : null
  let journey: unknown = null
  const membership: Record<string, unknown> = { schemaVersion: 1, accountId: credentials.accountId, environment: 'live', revision: 1, status: 'none', serverTime: iso(0), accessFrom: iso(-1000), accessUntil: iso(3_600_000), cacheUntil: iso(60_000), features: {}, checkoutEnabled: true, accountKind: 'twitch', ...changes }
  const routes = new Map<string, Reply[]>()
  const request = vi.fn(async (path: string, _body?: Record<string, unknown>, _bearer?: string): Promise<Reply> => {
    const queue = routes.get(path)
    if (queue?.length) return queue.length > 1 ? queue.shift()! : queue[0]
    return { status: 404, body: null }
  })
  const installation = vi.fn(async () => ({ status: 201, body: credentials }))
  const supporter = new SupporterAccountCoordinator({
    read: async () => account,
    write: async value => { account = value },
    readInstallationKey: async () => null,
    writeInstallationKey: async () => {},
    request: async (path, body, bearer) => path === '/v1/billing/supporter' ? { status: 200, body: membership } : path === '/v1/account/installations' ? installation() : request(path, body, bearer),
    now: () => now,
  })
  const open = vi.fn(async (_url: string) => {})
  const step = vi.fn(stepUp ?? (async (): Promise<TwitchStepUpResult> => ({ ok: true, expiresAt: iso(600_000) })))
  const pay = new SupporterPayFirstCoordinator({ account: supporter, request, read: async () => journey, write: async value => { journey = value }, open, now: () => now, twitchSignIn, stepUp: step })
  return { pay, request, open, step, installation, route: (path: string, ...replies: Reply[]) => routes.set(path, replies), journey: () => journey }
}

describe('Twitch sign-in billing: Checkout needs a signed-in account', () => {
  it('never creates an installation account and never calls the provider while signed out', async () => {
    const f = fixture({ signedIn: false })
    expect(await f.pay.billing('checkout')).toEqual({ state: 'sign_in_required' })
    expect(await f.pay.billing('portal')).toEqual({ state: 'sign_in_required' })
    expect(f.installation).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
    expect(f.open).not.toHaveBeenCalled()
  })

  it('opens Stripe Checkout with the signed-in bearer only', async () => {
    const f = fixture()
    f.route('/v1/billing/checkout', { status: 201, body: { attemptId, url: CHECKOUT_URL, expiresAt: iso(30 * 60_000) } })
    expect(await f.pay.billing('checkout')).toEqual({ state: 'waiting', attemptId })
    expect(f.request).toHaveBeenCalledExactlyOnceWith('/v1/billing/checkout', {}, credentials.token)
    expect(f.open).toHaveBeenCalledExactlyOnceWith(CHECKOUT_URL)
    expect(f.installation).not.toHaveBeenCalled()
    // A second click while Checkout is open never pays twice.
    expect(await f.pay.billing('checkout')).toMatchObject({ state: 'waiting' })
    expect(f.request.mock.calls.filter(([path]) => path === '/v1/billing/checkout')).toHaveLength(1)
  })

  it.each<[string, Record<string, unknown>, string]>([
    ['sign-ups closed', { checkoutEnabled: false }, 'closed'],
    ['an active membership', { status: 'active' }, 'active'],
    ['a membership under review', { status: 'review' }, 'review'],
    ['a pending payment', { status: 'pending' }, 'confirming'],
  ])('starts no Checkout for %s', async (_name, membership, state) => {
    const f = fixture({ membership })
    expect(await f.pay.billing('checkout')).toEqual({ state })
    expect(f.request).not.toHaveBeenCalled()
    expect(f.open).not.toHaveBeenCalled()
  })

  it('sends an invited tester whose email account has no Twitch identity to the website, with no attempt left behind', async () => {
    const f = fixture({ membership: { accountKind: 'email' } })
    f.route('/v1/billing/checkout', { status: 403, body: { error: 'browser_sign_in_required' } })
    expect(await f.pay.billing('checkout')).toEqual({ state: 'fallback' })
    expect(f.open).not.toHaveBeenCalled()
    expect(await f.pay.billing('status')).toEqual({ state: 'idle' })
  })

  it('treats the sandbox refusal as closed sign-ups', async () => {
    const f = fixture()
    f.route('/v1/billing/checkout', { status: 403, body: { error: 'checkout_not_available' } })
    expect(await f.pay.billing('checkout')).toEqual({ state: 'closed' })
    expect(f.open).not.toHaveBeenCalled()
  })
})

describe('Twitch sign-in billing: Manage subscription and the recent Twitch check', () => {
  it('opens the portal for this account with no step-up when the server does not ask', async () => {
    const f = fixture({ membership: { status: 'active' } })
    f.route('/v1/billing/portal', { status: 200, body: { url: PORTAL_URL } })
    expect(await f.pay.billing('portal')).toEqual({ state: 'idle' })
    expect(f.request).toHaveBeenCalledExactlyOnceWith('/v1/billing/portal', {}, credentials.token)
    expect(f.open).toHaveBeenCalledExactlyOnceWith(PORTAL_URL)
    expect(f.step).not.toHaveBeenCalled()
  })

  it('tries a silent step-up on 403 recent_auth_required, then retries the portal once', async () => {
    const f = fixture({ membership: { status: 'active' } })
    f.route('/v1/billing/portal', { status: 403, body: { error: 'recent_auth_required' } }, { status: 200, body: { url: PORTAL_URL } })
    expect(await f.pay.billing('portal')).toEqual({ state: 'idle' })
    expect(f.step).toHaveBeenCalledExactlyOnceWith('silent')
    expect(f.request.mock.calls.filter(([path]) => path === '/v1/billing/portal')).toHaveLength(2)
    expect(f.open).toHaveBeenCalledExactlyOnceWith(PORTAL_URL)
  })

  it('asks for a click when silent step-up cannot finish, and opens nothing', async () => {
    const f = fixture({ membership: { status: 'active' }, stepUp: async () => ({ ok: false, error: 'interaction_required' }) })
    f.route('/v1/billing/portal', { status: 403, body: { error: 'recent_auth_required' } })
    expect(await f.pay.billing('portal')).toEqual({ state: 'step_up_required' })
    expect(f.open).not.toHaveBeenCalled()
    expect(f.request.mock.calls.filter(([path]) => path === '/v1/billing/portal')).toHaveLength(1)
  })

  it('uses the interactive Twitch window from the confirm click', async () => {
    const f = fixture({ membership: { status: 'active' } })
    f.route('/v1/billing/portal', { status: 403, body: { error: 'recent_auth_required' } }, { status: 200, body: { url: PORTAL_URL } })
    expect(await f.pay.billing('portal_confirm')).toEqual({ state: 'idle' })
    expect(f.step).toHaveBeenCalledExactlyOnceWith('interactive')
    expect(f.open).toHaveBeenCalledExactlyOnceWith(PORTAL_URL)
  })

  it('never opens the portal after a check that names a different Twitch account', async () => {
    const f = fixture({ membership: { status: 'active' }, stepUp: async () => ({ ok: false, error: 'identity_mismatch' }) })
    f.route('/v1/billing/portal', { status: 403, body: { error: 'recent_auth_required' } })
    expect(await f.pay.billing('portal_confirm')).toEqual({ state: 'wrong_account' })
    expect(f.open).not.toHaveBeenCalled()
    expect(f.request.mock.calls.filter(([path]) => path === '/v1/billing/portal')).toHaveLength(1)
  })

  it('does not loop when the server still asks after a granted step-up', async () => {
    const f = fixture({ membership: { status: 'active' } })
    f.route('/v1/billing/portal', { status: 403, body: { error: 'recent_auth_required' } })
    expect(await f.pay.billing('portal')).toEqual({ state: 'step_up_required' })
    expect(f.step).toHaveBeenCalledOnce()
    expect(f.request.mock.calls.filter(([path]) => path === '/v1/billing/portal')).toHaveLength(2)
    expect(f.open).not.toHaveBeenCalled()
  })

  it('refuses a portal URL on any host but billing.stripe.com', async () => {
    const f = fixture({ membership: { status: 'active' } })
    f.route('/v1/billing/portal', { status: 200, body: { url: 'https://billing.stripe.com.evil.test/p' } })
    expect(await f.pay.billing('portal')).toEqual({ state: 'error' })
    expect(f.open).not.toHaveBeenCalled()
  })

  it('keeps today\'s behaviour with Twitch sign-in off: no interactive check exists', async () => {
    const f = fixture({ twitchSignIn: false, membership: { status: 'active' } })
    expect(await f.pay.billing('portal_confirm')).toEqual({ state: 'unavailable' })
    expect(f.step).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
  })
})

describe('portal_confirm is a settings-page request with no destination', () => {
  it('parses only the exact shape', () => {
    expect(parseBackgroundRequest({ type: 'SUPPORTER_BILLING', action: 'portal_confirm' })).toEqual({ type: 'SUPPORTER_BILLING', action: 'portal_confirm' })
    expect(parseBackgroundRequest({ type: 'SUPPORTER_BILLING', action: 'portal_confirm', url: PORTAL_URL })).toBeNull()
  })
})
