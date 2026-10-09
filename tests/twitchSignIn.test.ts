import { describe, expect, it, vi } from 'vitest'
import { SupporterAccountCoordinator } from '../src/background/supporterAccount.ts'
import {
  parseAuthorizeRedirect,
  parseTwitchProfile,
  requiresStepUp,
  TwitchSignIn,
  twitchSurface,
  type TwitchSignInPorts,
  type WebAuthFlowDetails,
} from '../src/background/twitchSignIn.ts'
import { TWITCH_SIGNIN_ENABLED } from '../src/shared/twitchSignIn.ts'

const API = 'https://api.streampulse.stream'
const REDIRECT = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/'
const FLOW_ID = '0123456789abcdef0123456789abcdef'
const FLOW_SECRET = 'd'.repeat(64)
// A stand-in JWT shape ({"alg":"RS256"}.{"sub":"123"}.signature), built so no token-like literal sits in source.
const ID_TOKEN = [{ alg: 'RS256' }, { sub: '123' }].map(part => btoa(JSON.stringify(part)).replace(/=+$/, '')).concat(btoa('signature')).join('.')
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222'
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()
const EXPIRES = future(30)
const REFRESH_EXPIRES = future(90)
const pair = (overrides: Record<string, unknown> = {}) => ({
  state: 'approved', deviceId: '11111111-1111-4111-8111-111111111111', accountId: ACCOUNT_ID,
  token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), expiresAt: EXPIRES, refreshExpiresAt: REFRESH_EXPIRES,
  created: false, profile: { displayName: 'PulseFan', picture: 'https://static-cdn.jtvnw.net/jtv_user_pictures/fan.png' }, ...overrides,
})
const authorizeUrl = (state = FLOW_ID, redirect = REDIRECT, host = 'id.twitch.tv') =>
  `https://${host}/oauth2/authorize?client_id=abc&redirect_uri=${encodeURIComponent(redirect)}&response_type=id_token&scope=openid&nonce=n&state=${state}&force_verify=false`
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

type Route = (body: Record<string, unknown>, init: RequestInit) => Response | Promise<Response>

function fixture(options: {
  stored?: unknown
  meta?: unknown
  routes?: Record<string, Route>
  launch?: (details: WebAuthFlowDetails) => Promise<string | undefined>
  ports?: Partial<TwitchSignInPorts>
} = {}) {
  let stored = options.stored ?? null
  let meta = options.meta ?? null
  let profile: unknown = null
  const accountRequest = vi.fn<(path: string, body?: Record<string, unknown>, bearer?: string) => Promise<{ status: number; body: unknown }>>(async () => ({ status: 204, body: null }))
  const identityChanged = vi.fn(async () => {})
  const account = new SupporterAccountCoordinator({ read: async () => stored, write: async next => { stored = next }, request: accountRequest, identityChanged })
  const routes: Record<string, Route> = {
    '/v1/account/auth/twitch/start-device': () => json(201, { flowId: FLOW_ID, flowSecret: FLOW_SECRET, authorizeUrl: authorizeUrl(), expiresAt: future(0.002) }),
    '/v1/account/auth/twitch/device': () => json(200, pair()),
    '/v1/account/auth/twitch/stepup': () => json(200, { status: 'step_up_granted', expiresAt: future(0.007) }),
    ...options.routes,
  }
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const route = routes[url.pathname]
    if (!route) return json(404, { error: 'not_found' })
    return route(JSON.parse(String(init?.body ?? '{}')), init ?? {})
  })
  const launch = vi.fn(options.launch ?? (async () => `${REDIRECT}#id_token=${ID_TOKEN}&state=${FLOW_ID}`))
  const signIn = new TwitchSignIn({
    enabled: true,
    account,
    fetch: fetchMock as unknown as typeof fetch,
    launchWebAuthFlow: launch,
    redirectUrl: () => REDIRECT,
    surface: 'chrome',
    chromium: true,
    apiOrigin: API,
    hosted: async () => true,
    meta: { read: async () => meta, write: async value => { meta = value } },
    profile: { read: async () => profile, write: async value => { profile = value } },
    ...options.ports,
  })
  const calls = (path: string) => fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname === path)
  const bodyOf = (path: string, index = 0) => JSON.parse(String(calls(path)[index]?.[1]?.body))
  return { signIn, account, accountRequest, identityChanged, fetchMock, launch, calls, bodyOf, stored: () => stored, meta: () => meta as Record<string, unknown> | null, profile: () => profile }
}
const linkedRecord = { kind: 'linked', ...pair(), token: 'c'.repeat(64), refreshToken: 'e'.repeat(64), deviceId: '33333333-3333-4333-8333-333333333333' }

describe('Sign in with Twitch worker flow', () => {
  it('ships off by default', () => {
    expect(TWITCH_SIGNIN_ENABLED).toBe(false)
  })

  it('signs in interactively and stores the device pair through the account coordinator', async () => {
    const f = fixture()
    const response = await f.signIn.signIn('interactive')
    expect(response.outcome).toBe('signed_in')
    expect(response.account).toEqual({ state: 'linked', accountId: ACCOUNT_ID, expiresAt: pair().expiresAt })
    expect(f.bodyOf('/v1/account/auth/twitch/start-device')).toEqual({ surface: 'chrome', purpose: 'signin', mode: 'interactive', forceVerify: false })
    const [, init] = f.calls('/v1/account/auth/twitch/start-device')[0]
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store' })
    expect((init!.headers as Record<string, string>).Authorization).toBeUndefined()
    // Interactive mode passes no Chromium non-interactive fields.
    expect(f.launch).toHaveBeenCalledWith({ url: authorizeUrl(), interactive: true })
    expect(f.bodyOf('/v1/account/auth/twitch/device')).toEqual({ flowId: FLOW_ID, flowSecret: FLOW_SECRET, idToken: ID_TOKEN })
    expect(f.stored()).toMatchObject({ kind: 'linked', token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), accountId: ACCOUNT_ID })
    expect(f.identityChanged).toHaveBeenCalled()
    expect(response.status.profile).toEqual({ displayName: 'PulseFan', picture: 'https://static-cdn.jtvnw.net/jtv_user_pictures/fan.png' })
    // Secrets never reach the page.
    const visible = JSON.stringify(response)
    for (const secret of [FLOW_SECRET, ID_TOKEN, 'a'.repeat(64), 'b'.repeat(64)]) expect(visible).not.toContain(secret)
    // Existing paths keep working with the adopted pair.
    expect(await f.account.run('status')).toMatchObject({ state: 'linked', accountId: ACCOUNT_ID })
    await f.account.withCredential(async token => { expect(token).toBe('a'.repeat(64)); return { status: 200 } })
  })

  it('treats a closed window as a cancel and stores nothing', async () => {
    const f = fixture({ launch: async () => { throw new Error('The user did not approve access.') } })
    const response = await f.signIn.signIn('interactive')
    expect(response.outcome).toBe('cancelled')
    expect(f.calls('/v1/account/auth/twitch/device')).toHaveLength(0)
    expect(f.stored()).toBeNull()
  })

  it('treats a Twitch access_denied redirect as a cancel', async () => {
    const f = fixture({ launch: async () => `${REDIRECT}?error=access_denied&error_description=denied&state=${FLOW_ID}` })
    expect((await f.signIn.signIn('interactive')).outcome).toBe('cancelled')
    expect(f.calls('/v1/account/auth/twitch/device')).toHaveLength(0)
  })

  it('rejects a redirect whose state is not this flow', async () => {
    const f = fixture({ launch: async () => `${REDIRECT}#id_token=${ID_TOKEN}&state=${'f'.repeat(32)}` })
    expect((await f.signIn.signIn('interactive')).outcome).toBe('state_mismatch')
    expect(f.calls('/v1/account/auth/twitch/device')).toHaveLength(0)
    expect(f.stored()).toBeNull()
  })

  it('maps each server error code from the device route and never stores credentials', async () => {
    const cases: Array<[number, string, string, Record<string, string>?]> = [
      [403, 'interaction_required', 'interaction_required'],
      [403, 'revoked', 'revoked'],
      [403, 'pilot_only', 'pilot_only'],
      [403, 'link_required', 'link_required'],
      [409, 'identity_in_use', 'identity_in_use'],
      [403, 'account_deleted', 'account_deleted'],
      [503, 'signup_unavailable', 'signup_unavailable', { 'Retry-After': '120' }],
      [401, 'flow_invalid_or_expired', 'flow_expired'],
      [401, 'token_invalid', 'token_invalid'],
      [429, 'try_later', 'try_later', { 'Retry-After': '60' }],
      [503, 'request_unavailable', 'unavailable'],
      [404, 'not_found', 'unavailable'],
      [400, 'invalid_request', 'error'],
      [403, 'recent_auth_required', 'error'],
    ]
    for (const [status, code, outcome, headers] of cases) {
      const f = fixture({ routes: { '/v1/account/auth/twitch/device': () => json(status, { error: code }, headers) } })
      const response = await f.signIn.signIn('interactive')
      expect(response.outcome, code).toBe(outcome)
      if (headers?.['Retry-After']) expect(response.retryAfterSeconds).toBe(Number(headers['Retry-After']))
      expect(f.stored(), code).toBeNull()
    }
  })

  it('maps start-device failures without opening a window', async () => {
    for (const [status, code, outcome] of [[400, 'surface_unavailable', 'surface_unavailable'], [404, 'not_found', 'unavailable'], [429, 'try_later', 'try_later'], [503, 'request_unavailable', 'unavailable']] as const) {
      const f = fixture({ routes: { '/v1/account/auth/twitch/start-device': () => json(status, { error: code }) } })
      expect((await f.signIn.signIn('interactive')).outcome).toBe(outcome)
      expect(f.launch).not.toHaveBeenCalled()
    }
  })

  it('refuses an authorize URL that is not Twitch or not this flow', async () => {
    for (const url of [authorizeUrl(FLOW_ID, REDIRECT, 'evil.example'), authorizeUrl('f'.repeat(32)), 'javascript:alert(1)']) {
      const f = fixture({ routes: { '/v1/account/auth/twitch/start-device': () => json(201, { flowId: FLOW_ID, flowSecret: FLOW_SECRET, authorizeUrl: url }) } })
      expect((await f.signIn.signIn('interactive')).outcome).toBe('error')
      expect(f.launch).not.toHaveBeenCalled()
    }
  })

  it('refuses a redirect configured for another extension ID before opening a window', async () => {
    const f = fixture({ routes: { '/v1/account/auth/twitch/start-device': () => json(201, { flowId: FLOW_ID, flowSecret: FLOW_SECRET, authorizeUrl: authorizeUrl(FLOW_ID, 'https://otherextensionidotherextensionid.chromiumapp.org/') }) } })
    expect((await f.signIn.signIn('interactive')).outcome).toBe('redirect_mismatch')
    expect(f.launch).not.toHaveBeenCalled()
  })

  it('reports a network failure on either request', async () => {
    const start = fixture({ routes: { '/v1/account/auth/twitch/start-device': () => { throw new TypeError('Failed to fetch') } } })
    expect((await start.signIn.signIn('interactive')).outcome).toBe('network')
    const device = fixture({ routes: { '/v1/account/auth/twitch/device': () => { throw new TypeError('Failed to fetch') } } })
    expect((await device.signIn.signIn('interactive')).outcome).toBe('network')
    expect(device.stored()).toBeNull()
  })

  it('never sends account requests to a developer backend override', async () => {
    const f = fixture({ ports: { hosted: async () => false } })
    expect((await f.signIn.signIn('interactive')).outcome).toBe('hosted_only')
    expect(f.fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing while the build flag is off or the identity API is missing', async () => {
    const off = fixture({ ports: { enabled: false } })
    expect((await off.signIn.signIn('interactive')).outcome).toBe('disabled')
    await off.signIn.markFirstInstall()
    await off.signIn.markSignedOutByUser()
    expect(off.meta()).toBeNull()
    expect((await off.signIn.status()).status).toMatchObject({ enabled: false, silentEligible: false })
    const android = fixture({ ports: { launchWebAuthFlow: undefined } })
    expect((await android.signIn.signIn('interactive')).outcome).toBe('unsupported')
    expect((await android.signIn.status()).status.available).toBe(false)
    expect(off.fetchMock).not.toHaveBeenCalled()
    expect(android.fetchMock).not.toHaveBeenCalled()
  })

  it('runs one sign-in at a time', async () => {
    let finish!: (url: string) => void
    const f = fixture({ launch: () => new Promise(resolve => { finish = resolve }) })
    const first = f.signIn.signIn('interactive')
    await vi.waitFor(() => expect(f.launch).toHaveBeenCalled())
    expect((await f.signIn.signIn('interactive')).outcome).toBe('busy')
    expect((await f.signIn.stepUp('interactive'))).toEqual({ ok: false, error: 'busy' })
    finish(`${REDIRECT}#id_token=${ID_TOKEN}&state=${FLOW_ID}`)
    expect((await first).outcome).toBe('signed_in')
  })

  it('is a no-op when already signed in, and gives way to a device-link code in progress', async () => {
    const linked = fixture({ stored: linkedRecord })
    expect((await linked.signIn.signIn('interactive')).outcome).toBe('already_signed_in')
    expect(linked.fetchMock).not.toHaveBeenCalled()
    const pending = fixture({ stored: { kind: 'pending', secret: 'f'.repeat(64), code: 'ABCDE-12345', expiresAt: future(0.005), nextPoll: Date.now() + 5000 } })
    expect((await pending.signIn.signIn('interactive')).outcome).toBe('signed_in')
    expect(pending.stored()).toMatchObject({ kind: 'linked', token: 'a'.repeat(64) })
  })

  it('asks for a retried sign-out before signing in over an unconfirmed revocation', async () => {
    const f = fixture({ stored: { kind: 'revoking', token: 'c'.repeat(64) } })
    expect((await f.signIn.signIn('interactive')).outcome).toBe('revocation_pending')
    expect(f.fetchMock).not.toHaveBeenCalled()
  })

  it('revokes the new pair when the user signs out while the Twitch window is open', async () => {
    let finish!: (url: string) => void
    const f = fixture({ launch: () => new Promise(resolve => { finish = resolve }) })
    const pendingSignIn = f.signIn.signIn('interactive')
    await vi.waitFor(() => expect(f.launch).toHaveBeenCalled())
    await f.signIn.markSignedOutByUser()
    await f.account.run('disconnect')
    finish(`${REDIRECT}#id_token=${ID_TOKEN}&state=${FLOW_ID}`)
    const response = await pendingSignIn
    expect(response.outcome).not.toBe('signed_in')
    expect(f.accountRequest).toHaveBeenCalledWith('/v1/account/devices/disconnect', { token: 'a'.repeat(64) })
    expect(f.stored()).toBeNull()
  })

  it('"Not you?" signs the current identity out, then forces the Twitch account chooser', async () => {
    const f = fixture({ stored: linkedRecord, routes: { '/v1/account/auth/twitch/device': () => json(200, pair({ accountId: '44444444-4444-4444-8444-444444444444', profile: { displayName: 'OtherFan' } })) } })
    const response = await f.signIn.signIn('interactive', true)
    expect(response.outcome).toBe('signed_in')
    expect(f.accountRequest).toHaveBeenCalledWith('/v1/account/devices/disconnect', { token: 'c'.repeat(64) })
    expect(f.bodyOf('/v1/account/auth/twitch/start-device')).toMatchObject({ mode: 'interactive', forceVerify: true })
    expect(f.stored()).toMatchObject({ accountId: '44444444-4444-4444-8444-444444444444' })
    expect(response.status.profile).toEqual({ displayName: 'OtherFan' })
    expect(f.meta()).toMatchObject({ signedOutByUser: false })
  })

  it('leaves the user signed out when "Not you?" is cancelled', async () => {
    const f = fixture({ stored: linkedRecord, launch: async () => { throw new Error('The user did not approve access.') } })
    const response = await f.signIn.signIn('interactive', true)
    expect(response.outcome).toBe('cancelled')
    expect(response.account.state).toBe('signed_out')
    expect(f.meta()).toMatchObject({ signedOutByUser: true })
  })

  it('refuses silent mode with forceVerify', async () => {
    const f = fixture({ meta: { v: 1, firstInstallPending: true, signedOutByUser: false, serverRevoked: false } })
    expect((await f.signIn.signIn('silent', true)).outcome).toBe('error')
    expect(f.fetchMock).not.toHaveBeenCalled()
  })
})

describe('silent sign-in rules', () => {
  it('never runs silent outside a true first install', async () => {
    const f = fixture()
    expect((await f.signIn.status()).status.silentEligible).toBe(false)
    expect((await f.signIn.signIn('silent')).outcome).toBe('interaction_required')
    expect(f.fetchMock).not.toHaveBeenCalled()
    expect(f.launch).not.toHaveBeenCalled()
  })

  it('tries non-interactive exactly once on first install and signs in a returning identity', async () => {
    const f = fixture()
    await f.signIn.markFirstInstall()
    expect((await f.signIn.status()).status.silentEligible).toBe(true)
    const response = await f.signIn.signIn('silent')
    expect(response.outcome).toBe('signed_in')
    expect(f.bodyOf('/v1/account/auth/twitch/start-device')).toEqual({ surface: 'chrome', purpose: 'signin', mode: 'silent', forceVerify: false })
    expect(f.launch).toHaveBeenCalledWith({ url: authorizeUrl(), interactive: false, abortOnLoadForNonInteractive: false, timeoutMsForNonInteractive: 5000 })
    expect(f.meta()).toMatchObject({ firstInstallPending: false })
    expect(response.status.silentEligible).toBe(false)
  })

  it('spends the attempt even when it needs a click, and never retries silently', async () => {
    const f = fixture({ launch: async () => { throw new Error('User interaction required.') } })
    await f.signIn.markFirstInstall()
    expect((await f.signIn.signIn('silent')).outcome).toBe('interaction_required')
    expect(f.calls('/v1/account/auth/twitch/device')).toHaveLength(0)
    expect((await f.signIn.signIn('silent')).outcome).toBe('interaction_required')
    expect(f.calls('/v1/account/auth/twitch/start-device')).toHaveLength(1)
    expect(f.launch).toHaveBeenCalledTimes(1)
  })

  it('passes no Chromium-only fields to Firefox', async () => {
    const f = fixture({ ports: { surface: 'firefox', chromium: false } })
    await f.signIn.markFirstInstall()
    await f.signIn.signIn('silent')
    expect(f.launch).toHaveBeenCalledWith({ url: authorizeUrl(), interactive: false })
  })

  it('does not create an account silently: a new identity gets interaction_required', async () => {
    const f = fixture({ routes: { '/v1/account/auth/twitch/device': () => json(403, { error: 'interaction_required' }) } })
    await f.signIn.markFirstInstall()
    const response = await f.signIn.signIn('silent')
    expect(response.outcome).toBe('interaction_required')
    expect(response.account.state).toBe('signed_out')
    expect(f.stored()).toBeNull()
  })

  it('never tries silent after a user sign-out', async () => {
    const f = fixture()
    await f.signIn.markFirstInstall()
    await f.signIn.markSignedOutByUser()
    expect((await f.signIn.status()).status.silentEligible).toBe(false)
    expect((await f.signIn.signIn('silent')).outcome).toBe('interaction_required')
    expect(f.fetchMock).not.toHaveBeenCalled()
  })

  it('a server revoke blocks silent sign-in until a click signs in', async () => {
    let revoked = true
    const f = fixture({ routes: { '/v1/account/auth/twitch/device': () => revoked ? json(403, { error: 'revoked' }) : json(200, pair()) } })
    await f.signIn.markFirstInstall()
    const response = await f.signIn.signIn('silent')
    expect(response.outcome).toBe('revoked')
    expect(f.meta()).toMatchObject({ serverRevoked: true, firstInstallPending: false })
    expect(response.status.silentEligible).toBe(false)
    expect(f.stored()).toBeNull()
    // Only a click recovers; it clears the revoke marker.
    revoked = false
    expect((await f.signIn.signIn('interactive')).outcome).toBe('signed_in')
    expect(f.meta()).toMatchObject({ serverRevoked: false, signedOutByUser: false })
  })

  it('ends the first-install window when a connection already exists', async () => {
    const f = fixture({ stored: linkedRecord })
    await f.signIn.markFirstInstall()
    expect((await f.signIn.signIn('silent')).outcome).toBe('already_signed_in')
    expect(f.fetchMock).not.toHaveBeenCalled()
    expect(f.meta()).toMatchObject({ firstInstallPending: false })
  })

  it('forgets the session profile once signed out', async () => {
    const f = fixture()
    await f.signIn.signIn('interactive')
    expect(f.profile()).toMatchObject({ accountId: ACCOUNT_ID, displayName: 'PulseFan' })
    await f.signIn.markSignedOutByUser()
    await f.account.run('disconnect')
    expect((await f.signIn.status()).status.profile).toBeNull()
    expect(f.profile()).toBeNull()
  })
})

describe('step-up', () => {
  it('proves the account identity with the device bearer on both requests', async () => {
    const f = fixture({ stored: linkedRecord })
    const result = await f.signIn.stepUp()
    expect(result).toMatchObject({ ok: true })
    expect(f.bodyOf('/v1/account/auth/twitch/start-device')).toEqual({ surface: 'chrome', purpose: 'stepup', mode: 'silent', forceVerify: false })
    expect((f.calls('/v1/account/auth/twitch/start-device')[0][1]!.headers as Record<string, string>).Authorization).toBe(`Bearer ${'c'.repeat(64)}`)
    expect(f.launch).toHaveBeenCalledWith(expect.objectContaining({ interactive: false }))
    expect(f.bodyOf('/v1/account/auth/twitch/stepup')).toEqual({ flowId: FLOW_ID, flowSecret: FLOW_SECRET, idToken: ID_TOKEN })
    expect((f.calls('/v1/account/auth/twitch/stepup')[0][1]!.headers as Record<string, string>).Authorization).toBe(`Bearer ${'c'.repeat(64)}`)
    expect(f.stored()).toMatchObject({ token: 'c'.repeat(64) })
  })

  it('needs a click when silent step-up cannot finish', async () => {
    const f = fixture({ stored: linkedRecord, launch: async () => { throw new Error('User interaction required.') } })
    expect(await f.signIn.stepUp('silent')).toEqual({ ok: false, error: 'interaction_required' })
    expect(f.calls('/v1/account/auth/twitch/stepup')).toHaveLength(0)
  })

  it('keeps the link on a flow or token failure and on an identity mismatch', async () => {
    for (const [status, code, error] of [[401, 'token_invalid', 'token_invalid'], [401, 'flow_invalid_or_expired', 'flow_expired'], [403, 'identity_mismatch', 'identity_mismatch']] as const) {
      const f = fixture({ stored: linkedRecord, routes: { '/v1/account/auth/twitch/stepup': () => json(status, { error: code }) } })
      expect(await f.signIn.stepUp('interactive')).toEqual({ ok: false, error })
      expect(f.stored(), code).toMatchObject({ kind: 'linked', token: 'c'.repeat(64) })
    }
  })

  it('drops a device bearer the server refuses and marks the link for relinking', async () => {
    const f = fixture({ stored: linkedRecord, routes: { '/v1/account/auth/twitch/start-device': () => json(401, { error: 'sign_in_required' }) } })
    expect(await f.signIn.stepUp()).toEqual({ ok: false, error: 'sign_in_required' })
    // The account store keeps no credential, only the pay-first relink marker.
    expect(f.stored()).toEqual({ kind: 'relink_required' })
    expect(f.launch).not.toHaveBeenCalled()
  })

  it('requires a signed-in device and reports network failures', async () => {
    const signedOut = fixture()
    expect(await signedOut.signIn.stepUp()).toEqual({ ok: false, error: 'sign_in_required' })
    expect(signedOut.fetchMock).not.toHaveBeenCalled()
    const offline = fixture({ stored: linkedRecord, routes: { '/v1/account/auth/twitch/stepup': () => { throw new TypeError('Failed to fetch') } } })
    expect(await offline.signIn.stepUp()).toEqual({ ok: false, error: 'network' })
    expect(offline.stored()).toMatchObject({ kind: 'linked' })
  })

  it('recognizes the step-up-gated refusal', () => {
    expect(requiresStepUp({ status: 403, body: { error: 'recent_auth_required' } })).toBe(true)
    expect(requiresStepUp({ status: 401, body: { error: 'recent_auth_required' } })).toBe(false)
    expect(requiresStepUp({ status: 403, body: { error: 'identity_mismatch' } })).toBe(false)
  })
})

describe('Sign in with Twitch parsing helpers', () => {
  it('names the store listing for store builds and the browser for development builds', () => {
    expect(twitchSurface('cws', 'chrome-extension://id/', 'Mozilla/5.0 Chrome/129.0 Edg/129.0')).toBe('chrome')
    expect(twitchSurface('edge', 'chrome-extension://id/', 'Mozilla/5.0 Chrome/129.0')).toBe('edge')
    expect(twitchSurface('firefox', 'moz-extension://id/', '')).toBe('firefox')
    expect(twitchSurface('development', 'moz-extension://id/', 'Firefox/131.0')).toBe('firefox')
    expect(twitchSurface('development', 'chrome-extension://id/', 'Mozilla/5.0 Chrome/129.0 Edg/129.0')).toBe('edge')
    expect(twitchSurface('development', 'chrome-extension://id/', 'Mozilla/5.0 Chrome/129.0')).toBe('chrome')
  })

  it('takes the ID token from the fragment only', () => {
    const flow = { flowId: FLOW_ID, redirectUri: REDIRECT }
    expect(parseAuthorizeRedirect(`${REDIRECT}#id_token=${ID_TOKEN}&state=${FLOW_ID}`, flow, 'interactive')).toBe(ID_TOKEN)
    expect(parseAuthorizeRedirect(`${REDIRECT}?id_token=${ID_TOKEN}&state=${FLOW_ID}`, flow, 'interactive')).toEqual({ outcome: 'error' })
    expect(parseAuthorizeRedirect(`https://elsewhere.example/#id_token=${ID_TOKEN}&state=${FLOW_ID}`, flow, 'interactive')).toEqual({ outcome: 'error' })
    expect(parseAuthorizeRedirect(`${REDIRECT}#id_token=not-a-jwt&state=${FLOW_ID}`, flow, 'interactive')).toEqual({ outcome: 'error' })
    expect(parseAuthorizeRedirect(undefined, flow, 'silent')).toEqual({ outcome: 'interaction_required' })
    expect(parseAuthorizeRedirect(`${REDIRECT}#error=login_required&state=${FLOW_ID}`, flow, 'silent')).toEqual({ outcome: 'interaction_required' })
  })

  it('keeps only a Twitch-hosted avatar and a plain display name', () => {
    expect(parseTwitchProfile({ displayName: 'Fan', picture: 'https://evil.example/a.png' })).toEqual({ displayName: 'Fan' })
    expect(parseTwitchProfile({ displayName: 'Fan', picture: 'http://static-cdn.jtvnw.net/a.png' })).toEqual({ displayName: 'Fan' })
    expect(parseTwitchProfile({ displayName: '', picture: 'https://static-cdn.jtvnw.net/a.png' })).toBeNull()
    expect(parseTwitchProfile({ displayName: 'x'.repeat(65) })).toBeNull()
    expect(parseTwitchProfile(null)).toBeNull()
  })
})

describe('account coordinator adopt', () => {
  const coordinator = (stored: unknown, disconnect: () => Promise<{ status: number; body: unknown }> = async () => ({ status: 204, body: null })) => {
    let value = stored
    const request = vi.fn(async (path: string, _body?: Record<string, unknown>) => {
      if (path === '/v1/account/devices/disconnect') return disconnect()
      return { status: 404, body: null }
    })
    const account = new SupporterAccountCoordinator({ read: async () => value, write: async next => { value = next }, request })
    return { account, request, stored: () => value }
  }

  it('refuses a malformed or unapproved pair without writing', async () => {
    for (const body of [null, { ...pair(), state: 'pending' }, { ...pair(), token: 'short' }, { ...pair(), accountId: 'not-a-uuid' }]) {
      const c = coordinator(null)
      expect(await c.account.adopt(body, c.account.identityGeneration)).toEqual({ adopted: false, account: { state: 'error' } })
      expect(c.stored()).toBeNull()
    }
  })

  it('keeps a connection that appeared meanwhile and revokes the new pair', async () => {
    const c = coordinator(linkedRecord)
    const result = await c.account.adopt(pair(), c.account.identityGeneration)
    expect(result.adopted).toBe(false)
    expect(result.account).toMatchObject({ state: 'linked' })
    expect(c.request).toHaveBeenCalledWith('/v1/account/devices/disconnect', { token: 'a'.repeat(64) })
    expect(c.stored()).toMatchObject({ token: 'c'.repeat(64) })
  })

  it('finishes a pending revocation before adopting, and never overwrites one it cannot finish', async () => {
    const ok = coordinator({ kind: 'revoking', token: 'c'.repeat(64) })
    expect((await ok.account.adopt(pair(), ok.account.identityGeneration)).adopted).toBe(true)
    expect(ok.request).toHaveBeenCalledWith('/v1/account/devices/disconnect', { token: 'c'.repeat(64) })
    expect(ok.stored()).toMatchObject({ kind: 'linked', token: 'a'.repeat(64) })
    const failing = coordinator({ kind: 'revoking', token: 'c'.repeat(64) }, async () => ({ status: 503, body: null }))
    expect(await failing.account.adopt(pair(), failing.account.identityGeneration)).toEqual({ adopted: false, account: { state: 'error', revocationPending: true } })
    expect(failing.stored()).toEqual({ kind: 'revoking', token: 'c'.repeat(64) })
  })

  it('revokes through a tombstone when a disconnect happened since the flow began', async () => {
    const c = coordinator(null, async () => ({ status: 503, body: null }))
    const generation = c.account.identityGeneration
    await c.account.run('disconnect')
    const result = await c.account.adopt(pair(), generation)
    expect(result).toEqual({ adopted: false, account: { state: 'error', revocationPending: true } })
    // The tombstone keeps the authority to retry revoking the unwanted pair.
    expect(c.stored()).toEqual({ kind: 'revoking', token: 'a'.repeat(64) })
  })
})

describe('Sign out everywhere', () => {
  const REVOKE_ALL = '/v1/account/sessions/revoke-all'
  const stepUpNeeded = () => json(403, { error: 'recent_auth_required' })
  const done = () => new Response(null, { status: 204 })
  /** Answers revoke-all from a queue, the last answer repeating. */
  const answers = (...queue: Array<() => Response>): Route => () => (queue.length > 1 ? queue.shift()! : queue[0])()

  it('posts revoke-all with the device bearer, then signs this extension out with silent sign-in kept off', async () => {
    const f = fixture({ stored: linkedRecord, meta: { v: 1, firstInstallPending: true, signedOutByUser: false, serverRevoked: false }, routes: { [REVOKE_ALL]: done } })
    const response = await f.signIn.signOutEverywhere()
    expect(response.everywhere).toBe('signed_out_everywhere')
    expect(response.account).toEqual({ state: 'signed_out' })
    expect(f.calls(REVOKE_ALL)).toHaveLength(1)
    const [, init] = f.calls(REVOKE_ALL)[0]
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', body: '{}' })
    expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${'c'.repeat(64)}`)
    // No step-up was needed, and no second revocation request was made for a dead credential.
    expect(f.calls('/v1/account/auth/twitch/start-device')).toHaveLength(0)
    expect(f.accountRequest).not.toHaveBeenCalled()
    expect(f.stored()).toBeNull()
    expect(f.identityChanged).toHaveBeenCalled()
    expect(f.meta()).toMatchObject({ signedOutByUser: true, firstInstallPending: false })
    expect(response.status.silentEligible).toBe(false)
    expect(response.status.profile).toBeNull()
    // Silent sign-in stays blocked: no network, no window.
    f.fetchMock.mockClear(); f.launch.mockClear()
    expect((await f.signIn.signIn('silent')).outcome).toBe('interaction_required')
    expect(f.fetchMock).not.toHaveBeenCalled()
    expect(f.launch).not.toHaveBeenCalled()
    // Secrets never reach the page.
    expect(JSON.stringify(response)).not.toContain('c'.repeat(64))
  })

  it('on recent_auth_required tries one silent Twitch check and retries once', async () => {
    const f = fixture({ stored: linkedRecord, routes: { [REVOKE_ALL]: answers(stepUpNeeded, done) } })
    const response = await f.signIn.signOutEverywhere()
    expect(response.everywhere).toBe('signed_out_everywhere')
    expect(f.calls(REVOKE_ALL)).toHaveLength(2)
    expect(f.bodyOf('/v1/account/auth/twitch/start-device')).toEqual({ surface: 'chrome', purpose: 'stepup', mode: 'silent', forceVerify: false })
    expect(f.launch).toHaveBeenCalledWith(expect.objectContaining({ interactive: false }))
    expect(f.stored()).toBeNull()
  })

  it('asks for a click when the silent check cannot finish, and signs nothing out', async () => {
    const f = fixture({ stored: linkedRecord, routes: { [REVOKE_ALL]: stepUpNeeded }, launch: async () => { throw new Error('User interaction required.') } })
    const response = await f.signIn.signOutEverywhere()
    expect(response.everywhere).toBe('step_up_required')
    expect(response.account).toMatchObject({ state: 'linked', accountId: ACCOUNT_ID })
    expect(f.calls(REVOKE_ALL)).toHaveLength(1)
    expect(f.calls('/v1/account/auth/twitch/stepup')).toHaveLength(0)
    expect(f.stored()).toMatchObject({ kind: 'linked', token: 'c'.repeat(64) })
    expect(f.meta()).toBeNull()
  })

  it('opens the Twitch window from a click, then retries once', async () => {
    const f = fixture({ stored: linkedRecord, routes: { [REVOKE_ALL]: answers(stepUpNeeded, done) } })
    const response = await f.signIn.signOutEverywhere('interactive')
    expect(response.everywhere).toBe('signed_out_everywhere')
    expect(f.bodyOf('/v1/account/auth/twitch/start-device')).toMatchObject({ purpose: 'stepup', mode: 'interactive' })
    expect(f.launch).toHaveBeenCalledWith({ url: authorizeUrl(), interactive: true })
    expect(f.calls(REVOKE_ALL)).toHaveLength(2)
  })

  it('never loops: a second recent-auth refusal after a check asks again', async () => {
    const f = fixture({ stored: linkedRecord, routes: { [REVOKE_ALL]: stepUpNeeded } })
    expect((await f.signIn.signOutEverywhere('interactive')).everywhere).toBe('step_up_required')
    expect(f.calls(REVOKE_ALL)).toHaveLength(2)
    expect(f.calls('/v1/account/auth/twitch/stepup')).toHaveLength(1)
    expect(f.stored()).toMatchObject({ kind: 'linked' })
  })

  it('signs nothing out when the check names a different Twitch account', async () => {
    const f = fixture({ stored: linkedRecord, routes: { [REVOKE_ALL]: stepUpNeeded, '/v1/account/auth/twitch/stepup': () => json(403, { error: 'identity_mismatch' }) } })
    const response = await f.signIn.signOutEverywhere('interactive')
    expect(response.everywhere).toBe('wrong_account')
    expect(f.calls(REVOKE_ALL)).toHaveLength(1)
    expect(f.stored()).toMatchObject({ kind: 'linked', token: 'c'.repeat(64) })
  })

  it.each([
    [404, { error: 'not_found' }, 'not_available'],
    [503, { error: 'request_unavailable' }, 'failed'],
    [400, { error: 'invalid_request' }, 'failed'],
  ] as const)('keeps this extension signed in on %i', async (status, body, everywhere) => {
    const f = fixture({ stored: linkedRecord, routes: { [REVOKE_ALL]: () => json(status, body) } })
    const response = await f.signIn.signOutEverywhere()
    expect(response.everywhere).toBe(everywhere)
    expect(response.account).toMatchObject({ state: 'linked' })
    expect(f.stored()).toMatchObject({ kind: 'linked', token: 'c'.repeat(64) })
    expect(f.calls('/v1/account/auth/twitch/start-device')).toHaveLength(0)
    expect(f.meta()).toBeNull()
  })

  it('passes a rate limit through with its wait', async () => {
    const f = fixture({ stored: linkedRecord, routes: { [REVOKE_ALL]: () => json(429, { error: 'try_later' }, { 'Retry-After': '900' }) } })
    const response = await f.signIn.signOutEverywhere()
    expect(response).toMatchObject({ everywhere: 'try_later', retryAfterSeconds: 900 })
    expect(f.stored()).toMatchObject({ kind: 'linked' })
  })

  it('reports a network failure as unconfirmed and keeps the sign-in', async () => {
    const f = fixture({ stored: linkedRecord, routes: { [REVOKE_ALL]: () => { throw new TypeError('Failed to fetch') } } })
    expect((await f.signIn.signOutEverywhere()).everywhere).toBe('failed')
    expect(f.stored()).toMatchObject({ kind: 'linked' })
  })

  it('treats a refused bearer as an ended sign-in', async () => {
    const f = fixture({ stored: linkedRecord, routes: { [REVOKE_ALL]: () => json(401, { error: 'sign_in_required' }) } })
    const response = await f.signIn.signOutEverywhere()
    expect(response.everywhere).toBe('sign_in_required')
    expect(f.stored()).toEqual({ kind: 'relink_required' })
  })

  it('needs a signed-in extension and the build flag', async () => {
    const signedOut = fixture()
    expect((await signedOut.signIn.signOutEverywhere()).everywhere).toBe('sign_in_required')
    expect(signedOut.fetchMock).not.toHaveBeenCalled()
    const off = fixture({ stored: linkedRecord, ports: { enabled: false } })
    expect((await off.signIn.signOutEverywhere()).everywhere).toBe('disabled')
    expect(off.fetchMock).not.toHaveBeenCalled()
    expect(off.stored()).toMatchObject({ kind: 'linked' })
  })

  it('the coordinator forgets only the account that was signed out everywhere', async () => {
    let stored: unknown = linkedRecord
    const request = vi.fn(async () => ({ status: 204, body: null }))
    const c = new SupporterAccountCoordinator({ read: async () => stored, write: async next => { stored = next }, request })
    expect(await c.forgetSignedOutEverywhere('44444444-4444-4444-8444-444444444444')).toMatchObject({ state: 'linked', accountId: ACCOUNT_ID })
    expect(stored).toMatchObject({ kind: 'linked' })
    expect(await c.forgetSignedOutEverywhere(ACCOUNT_ID)).toEqual({ state: 'signed_out' })
    expect(stored).toBeNull()
    expect(request).not.toHaveBeenCalled()
  })
})
