import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountError, accountRequest } from '../src/lib/accountApi'
import { knownTwitchIdentity, refreshAccountSession, resetAccountSessionForTests } from '../src/lib/accountSession'
import {
  MAX_ID_TOKEN_LENGTH,
  captureTwitchCallback,
  parseTwitchCallback,
  resetTwitchCallbackForTests,
  takeTwitchCallback,
} from '../src/lib/twitchCallback'
import {
  completeTwitchCallback,
  resetTwitchSignInForTests,
  startTwitchFlow,
  trustedAuthorizeUrl,
  twitchErrorCode,
  twitchErrorCopy,
  twitchProfile,
  twitchReturnPath,
  type TwitchErrorCode,
} from '../src/lib/twitchSignIn'

vi.mock('../src/lib/accountApi', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/accountApi')>(), accountRequest: vi.fn() }))
vi.mock('../src/lib/accountSession', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/lib/accountSession')>()
  return { ...actual, refreshAccountSession: vi.fn(async () => {}) }
})

const FLOW_ID = 'a'.repeat(32)
const FLOW_SECRET = 'b'.repeat(64)
const ID_TOKEN = /* A stand-in, built at runtime so secret scanners see no token literal. */ [{ alg: 'RS256' }, { sub: '12345' }].map(part => btoa(JSON.stringify(part))).concat(btoa('signature')).map(part => part.replace(/=+$/, '')).join('.')
const CSRF = 'c'.repeat(64)
const billingReturn = '/account/billing/return?attempt=12345678-1234-4234-8234-123456789abc'
const origin = window.location.origin

function authorizeUrl(overrides: Record<string, string> = {}, base = 'https://id.twitch.tv/oauth2/authorize'): string {
  const query = new URLSearchParams({
    client_id: 'testclientid0000000000000000000', redirect_uri: `${origin}/account/twitch/callback`,
    response_type: 'id_token', scope: 'openid', nonce: 'n'.repeat(64), state: FLOW_ID, force_verify: 'false', ...overrides,
  })
  return `${base}?${query}`
}

function startResponse(overrides: Record<string, unknown> = {}) {
  return { flowId: FLOW_ID, flowSecret: FLOW_SECRET, authorizeUrl: authorizeUrl(), expiresAt: new Date(Date.now() + 600_000).toISOString(), ...overrides }
}

function arriveAtCallback(hash: string, search = '') {
  window.history.replaceState(null, '', `/account/twitch/callback${search}${hash}`)
  captureTwitchCallback()
}

let cookie = ''
beforeEach(() => {
  resetTwitchCallbackForTests()
  resetTwitchSignInForTests()
  resetAccountSessionForTests()
  cookie = `__Host-pulse_csrf=${CSRF}`
  vi.spyOn(document, 'cookie', 'get').mockImplementation(() => cookie)
  vi.mocked(accountRequest).mockReset()
  vi.mocked(refreshAccountSession).mockClear()
  window.history.replaceState(null, '', '/')
})

describe('callback fragment parsing', () => {
  it('reads the ID token and state from the fragment', () => {
    expect(parseTwitchCallback(`id_token=${ID_TOKEN}&scope=openid&state=${FLOW_ID}`, '')).toEqual({ kind: 'token', idToken: ID_TOKEN, state: FLOW_ID })
  })

  it('reads a declined authorization from the query', () => {
    expect(parseTwitchCallback('', `error=access_denied&error_description=The+user+denied+you+access&state=${FLOW_ID}`))
      .toEqual({ kind: 'error', error: 'access_denied', state: FLOW_ID })
  })

  it.each([
    ['no token', `state=${FLOW_ID}`, ''],
    ['no state', `id_token=${ID_TOKEN}`, ''],
    ['a repeated state', `id_token=${ID_TOKEN}&state=${FLOW_ID}&state=${'d'.repeat(32)}`, ''],
    ['a repeated token', `id_token=${ID_TOKEN}&id_token=${ID_TOKEN}&state=${FLOW_ID}`, ''],
    ['an uppercase state', `id_token=${ID_TOKEN}&state=${'A'.repeat(32)}`, ''],
    ['a short state', `id_token=${ID_TOKEN}&state=abc`, ''],
    ['a token that is not a JWT', `id_token=not-a-jwt&state=${FLOW_ID}`, ''],
    ['a token with script', `id_token=<script>.a.b&state=${FLOW_ID}`, ''],
    ['an oversized token', `id_token=${'a'.repeat(MAX_ID_TOKEN_LENGTH)}.b.c&state=${FLOW_ID}`, ''],
    ['an error without state', '', 'error=access_denied'],
    ['a malformed error', '', `error=${encodeURIComponent('<b>')}&state=${FLOW_ID}`],
  ])('treats %s as invalid', (_, fragment, query) => {
    expect(parseTwitchCallback(fragment, query)).toEqual({ kind: 'invalid' })
  })
})

describe('callback capture', () => {
  it('strips the fragment and query from the address and history before handing the token out once', () => {
    const replace = vi.spyOn(window.history, 'replaceState')
    arriveAtCallback(`#id_token=${ID_TOKEN}&state=${FLOW_ID}`, '?utm=1')
    expect(replace).toHaveBeenLastCalledWith(null, '', '/account/twitch/callback')
    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('')
    expect(window.location.href).not.toContain(ID_TOKEN)
    expect(takeTwitchCallback()).toEqual({ kind: 'token', idToken: ID_TOKEN, state: FLOW_ID })
    expect(takeTwitchCallback()).toBeNull()
  })

  it('strips malformed values too, and accepts a trailing slash', () => {
    window.history.replaceState(null, '', '/account/twitch/callback/#id_token=garbage')
    captureTwitchCallback()
    expect(window.location.pathname).toBe('/account/twitch/callback')
    expect(window.location.hash).toBe('')
    expect(takeTwitchCallback()).toEqual({ kind: 'invalid' })
  })

  it('leaves every other path alone', () => {
    window.history.replaceState(null, '', '/account/confirm#secret')
    captureTwitchCallback()
    expect(window.location.hash).toBe('#secret')
    expect(takeTwitchCallback()).toBeNull()
  })

  it('forgets a captured token after ten minutes', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    arriveAtCallback(`#id_token=${ID_TOKEN}&state=${FLOW_ID}`)
    now.mockReturnValue(1_000_000 + 10 * 60_000)
    expect(takeTwitchCallback()).toBeNull()
  })
})

describe('return paths (no open redirects)', () => {
  it.each(['/account/settings', '/account/billing', billingReturn])('accepts %s', path => {
    expect(twitchReturnPath(path)).toBe(path)
  })

  it.each([
    'https://evil.example/account/settings', '//evil.example/account/settings', '/\\evil.example', '\\\\evil.example',
    'javascript:alert(1)', '/account/settings?next=//evil.example', '/account/settings#x', '/account/sign-in',
    '/account/twitch/callback', '/account/billing/../../evil', '%2F%2Fevil.example', '/account/billing/return?attempt=1&next=//evil',
    '/', '', null, undefined, 42, { toString: () => '/account/settings' },
  ])('refuses %s', value => {
    expect(twitchReturnPath(value)).toBeNull()
  })
})

describe('authorize URL check', () => {
  it('accepts Twitch’s authorize endpoint for this flow and this site’s callback', () => {
    expect(trustedAuthorizeUrl(authorizeUrl(), FLOW_ID)).toBe(authorizeUrl())
  })

  it.each([
    ['another host', authorizeUrl({}, 'https://id.twitch.tv.evil.example/oauth2/authorize')],
    ['plain http', authorizeUrl({}, 'http://id.twitch.tv/oauth2/authorize')],
    ['another path', authorizeUrl({}, 'https://id.twitch.tv/oauth2/token')],
    ['userinfo', authorizeUrl({}, 'https://user@id.twitch.tv/oauth2/authorize')],
    ['another state', authorizeUrl({ state: 'e'.repeat(32) })],
    ['a code flow', authorizeUrl({ response_type: 'code' })],
    ['another redirect', authorizeUrl({ redirect_uri: 'https://evil.example/account/twitch/callback' })],
    ['a fragment', `${authorizeUrl()}#x`],
    ['a repeated state', `${authorizeUrl()}&state=${FLOW_ID}`],
    ['javascript', 'javascript:alert(1)'],
  ])('refuses %s', (_, url) => {
    expect(trustedAuthorizeUrl(url, FLOW_ID)).toBeNull()
  })
})

describe('starting a flow', () => {
  it('starts a sign-in, keeps the flow secret only in this tab, and returns the Twitch URL', async () => {
    vi.mocked(accountRequest).mockResolvedValue(startResponse())
    await expect(startTwitchFlow({ purpose: 'signin', returnTo: billingReturn })).resolves.toBe(authorizeUrl())
    expect(accountRequest).toHaveBeenCalledWith('/auth/twitch/start', { purpose: 'signin' })
    const stored = JSON.parse(sessionStorage.getItem('pulse.account.twitchFlow.v1')!)
    expect(stored).toMatchObject({ flowId: FLOW_ID, flowSecret: FLOW_SECRET, purpose: 'signin', returnTo: billingReturn })
    expect(localStorage.length).toBe(0)
    expect(authorizeUrl()).not.toContain(FLOW_SECRET)
  })

  it('drops an untrusted return path and sends a link flow back to settings', async () => {
    vi.mocked(accountRequest).mockResolvedValue(startResponse())
    await startTwitchFlow({ purpose: 'signin', returnTo: '//evil.example' })
    expect(JSON.parse(sessionStorage.getItem('pulse.account.twitchFlow.v1')!).returnTo).toBe('/account/settings')
    await startTwitchFlow({ purpose: 'link', returnTo: billingReturn, forceVerify: true })
    expect(accountRequest).toHaveBeenLastCalledWith('/auth/twitch/start', { purpose: 'link', forceVerify: true })
    expect(JSON.parse(sessionStorage.getItem('pulse.account.twitchFlow.v1')!)).toMatchObject({ purpose: 'link', returnTo: '/account/settings' })
  })

  it.each([
    ['a malformed flow ID', { flowId: 'x' }],
    ['a malformed flow secret', { flowSecret: 'short' }],
    ['an authorize URL elsewhere', { authorizeUrl: authorizeUrl({}, 'https://evil.example/oauth2/authorize') }],
  ])('refuses a start response with %s and stores nothing', async (_, override) => {
    vi.mocked(accountRequest).mockResolvedValue(startResponse(override))
    await expect(startTwitchFlow({ purpose: 'signin' })).rejects.toSatisfy(error => twitchErrorCode(error) === 'unavailable')
    expect(sessionStorage.getItem('pulse.account.twitchFlow.v1')).toBeNull()
  })

  it('reports blocked storage instead of leaving for Twitch', async () => {
    vi.mocked(accountRequest).mockResolvedValue(startResponse())
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    await expect(startTwitchFlow({ purpose: 'signin' })).rejects.toSatisfy(error => twitchErrorCode(error) === 'storage_unavailable')
  })
})

describe('completing the callback', () => {
  async function started(purpose: 'signin' | 'link' = 'signin', returnTo?: string) {
    vi.mocked(accountRequest).mockResolvedValueOnce(startResponse())
    await startTwitchFlow({ purpose, returnTo })
  }

  it('posts the flow and token to complete, remembers the profile, refreshes the session and returns', async () => {
    await started('signin', billingReturn)
    arriveAtCallback(`#id_token=${ID_TOKEN}&state=${FLOW_ID}`)
    vi.mocked(accountRequest).mockResolvedValueOnce({
      status: 'signed_in', created: false,
      profile: { displayName: 'PulseTester', picture: 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x300.png' },
    })
    await expect(completeTwitchCallback()).resolves.toEqual({
      status: 'signed_in', purpose: 'signin', returnTo: billingReturn,
      profile: { displayName: 'PulseTester', avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-70x70.png' },
    })
    expect(accountRequest).toHaveBeenLastCalledWith('/auth/twitch/complete', { flowId: FLOW_ID, flowSecret: FLOW_SECRET, idToken: ID_TOKEN })
    expect(refreshAccountSession).toHaveBeenCalledOnce()
    expect(knownTwitchIdentity()).toEqual({ displayName: 'PulseTester', avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-70x70.png', via: 'signin' })
    expect(sessionStorage.getItem('pulse.account.twitchFlow.v1')).toBeNull()
  })

  it('finishes a link through the link route and returns to settings', async () => {
    await started('link')
    arriveAtCallback(`#id_token=${ID_TOKEN}&state=${FLOW_ID}`)
    vi.mocked(accountRequest).mockResolvedValueOnce({ status: 'linked', profile: { displayName: 'PulseTester', picture: '' } })
    await expect(completeTwitchCallback()).resolves.toMatchObject({ status: 'linked', returnTo: '/account/settings' })
    expect(accountRequest).toHaveBeenLastCalledWith('/identities/twitch/link', { flowId: FLOW_ID, flowSecret: FLOW_SECRET, idToken: ID_TOKEN })
  })

  it('posts a single-use token once even when asked twice', async () => {
    await started()
    arriveAtCallback(`#id_token=${ID_TOKEN}&state=${FLOW_ID}`)
    vi.mocked(accountRequest).mockResolvedValueOnce({ status: 'signed_in', profile: {} })
    const [first, second] = await Promise.all([completeTwitchCallback(), completeTwitchCallback()])
    expect(first).toBe(second)
    expect(accountRequest).toHaveBeenCalledTimes(2) // start + one complete
  })

  it('refuses a callback whose state names another flow, and keeps the real flow', async () => {
    await started()
    arriveAtCallback(`#id_token=${ID_TOKEN}&state=${'f'.repeat(32)}`)
    await expect(completeTwitchCallback()).resolves.toEqual({ status: 'error', purpose: 'signin', code: 'state_mismatch' })
    expect(accountRequest).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('pulse.account.twitchFlow.v1')).not.toBeNull()
  })

  it('refuses a callback in a tab that never started a flow', async () => {
    arriveAtCallback(`#id_token=${ID_TOKEN}&state=${FLOW_ID}`)
    await expect(completeTwitchCallback()).resolves.toMatchObject({ code: 'state_mismatch' })
    expect(accountRequest).not.toHaveBeenCalled()
  })

  it('treats a visit without a callback as invalid', async () => {
    await started()
    window.history.replaceState(null, '', '/account/twitch/callback')
    captureTwitchCallback()
    await expect(completeTwitchCallback()).resolves.toMatchObject({ code: 'callback_invalid' })
  })

  it('reports a declined authorization without posting anything', async () => {
    await started()
    arriveAtCallback('', `?error=access_denied&error_description=denied&state=${FLOW_ID}`)
    await expect(completeTwitchCallback()).resolves.toMatchObject({ code: 'access_denied' })
    expect(accountRequest).toHaveBeenCalledTimes(1)
  })

  it('does not post an expired flow', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    await started()
    now.mockReturnValue(1_000_000 + 10 * 60_000 + 1)
    arriveAtCallback(`#id_token=${ID_TOKEN}&state=${FLOW_ID}`)
    await expect(completeTwitchCallback()).resolves.toMatchObject({ code: 'flow_invalid_or_expired' })
    expect(accountRequest).toHaveBeenCalledTimes(1)
  })

  it.each([
    [new AccountError(403, 'pilot_only'), 'pilot_only'],
    [new AccountError(403, 'link_required'), 'link_required'],
    [new AccountError(409, 'identity_in_use'), 'identity_in_use'],
    [new AccountError(403, 'revoked'), 'revoked'],
    [new AccountError(503, 'signup_unavailable'), 'signup_unavailable'],
    [new AccountError(401, 'flow_invalid_or_expired'), 'flow_invalid_or_expired'],
    [new AccountError(401, 'token_invalid'), 'token_invalid'],
    [new AccountError(403, 'recent_auth_required'), 'recent_auth_required'],
    [new AccountError(429, 'try_later'), 'try_later'],
    [new AccountError(429), 'try_later'],
    [new AccountError(503, 'request_unavailable'), 'unavailable'],
    [new AccountError(404, 'not_found'), 'unavailable'],
    [new AccountError(403, 'origin_not_allowed'), 'unavailable'],
    [new AccountError(400, 'some_future_code'), 'unavailable'],
    [new TypeError('Failed to fetch'), 'unavailable'],
  ] as const)('maps %s to %s', async (failure, code) => {
    await started()
    arriveAtCallback(`#id_token=${ID_TOKEN}&state=${FLOW_ID}`)
    vi.mocked(accountRequest).mockRejectedValueOnce(failure)
    await expect(completeTwitchCallback()).resolves.toEqual({ status: 'error', purpose: 'signin', code })
    expect(refreshAccountSession).not.toHaveBeenCalled()
    expect(knownTwitchIdentity()).toBeNull()
  })

  it('records that an account is already linked when the API says so', async () => {
    await started('link')
    arriveAtCallback(`#id_token=${ID_TOKEN}&state=${FLOW_ID}`)
    vi.mocked(accountRequest).mockRejectedValueOnce(new AccountError(409, 'account_already_linked'))
    await expect(completeTwitchCallback()).resolves.toMatchObject({ code: 'account_already_linked', purpose: 'link' })
    expect(knownTwitchIdentity()).toEqual({ via: 'link' })
  })

  it('refuses an unexpected success body', async () => {
    await started()
    arriveAtCallback(`#id_token=${ID_TOKEN}&state=${FLOW_ID}`)
    vi.mocked(accountRequest).mockResolvedValueOnce({ status: 'linked' })
    await expect(completeTwitchCallback()).resolves.toMatchObject({ code: 'unavailable' })
  })
})

describe('profile and copy', () => {
  it('keeps only Twitch CDN avatars and printable names', () => {
    expect(twitchProfile({ displayName: ' Viewer ', picture: 'https://static-cdn.jtvnw.net/jtv_user_pictures/x.png' }))
      .toEqual({ displayName: 'Viewer', avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/x.png' })
    expect(twitchProfile({ displayName: 'bad\nname', picture: 'https://evil.example/a.png' })).toEqual({})
    expect(twitchProfile({ picture: 'http://static-cdn.jtvnw.net/a.png' })).toEqual({})
    expect(twitchProfile({ picture: 'https://static-cdn.jtvnw.net.evil.example/a.png' })).toEqual({})
    expect(twitchProfile({ displayName: 'x'.repeat(101) })).toEqual({})
    expect(twitchProfile(null)).toEqual({})
  })

  const codes: TwitchErrorCode[] = [
    'pilot_only', 'link_required', 'identity_in_use', 'account_already_linked', 'revoked', 'signup_unavailable',
    'interaction_required', 'recent_auth_required', 'sign_in_required', 'account_deleted', 'flow_invalid_or_expired',
    'token_invalid', 'try_later', 'state_mismatch', 'callback_invalid', 'access_denied', 'twitch_error',
    'storage_unavailable', 'unavailable',
  ]
  it.each(codes)('explains %s with a title, plain copy and a next step for both purposes', code => {
    for (const purpose of ['signin', 'link'] as const) {
      const copy = twitchErrorCopy(code, purpose)
      expect(copy.title.length).toBeGreaterThan(5)
      expect(copy.body.length).toBeGreaterThan(20)
      expect(copy.next).toBeTruthy()
      expect(copy.body).not.toMatch(/_|\b(?:403|409|503|token|nonce|OAuth)\b/)
    }
  })

  it('points each pilot outcome at the step that resolves it', () => {
    expect(twitchErrorCopy('pilot_only', 'signin').next).toBe('email')
    expect(twitchErrorCopy('link_required', 'signin').next).toBe('email')
    expect(twitchErrorCopy('identity_in_use', 'link').next).toBe('switch_account')
    expect(twitchErrorCopy('revoked', 'signin').next).toBe('twitch')
    expect(twitchErrorCopy('signup_unavailable', 'signin').next).toBe('later')
    expect(twitchErrorCopy('recent_auth_required', 'link').next).toBe('reauth')
    expect(twitchErrorCopy('unavailable', 'signin').next).toBe('email')
  })
})
