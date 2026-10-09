import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountSettings from '../src/routes/account/AccountSettings'
import { knownTwitchIdentity, rememberTwitchIdentity, resetAccountSessionForTests } from '../src/lib/accountSession'
import { completeBillingStepUp, rememberBillingStepUp, takeBillingStepUp } from '../src/lib/accountStepUp'
import { beginTwitchFlow } from '../src/lib/twitchSignIn'

/**
 * Sign out everywhere in Account & devices (backend #162,
 * POST /v1/account/sessions/revoke-all): behind VITE_TWITCH_SIGNIN, with a
 * confirm step, a clear signed-out success, "Confirm it's you" on
 * recent_auth_required, and "not available yet" while the route 404s (not
 * deployed, or the website relay does not allow it yet).
 */
vi.mock('../src/lib/twitchSignIn', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/twitchSignIn')>(),
  beginTwitchFlow: vi.fn(),
}))
vi.mock('../src/ui/components/PublicLayout', () => ({ PublicLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111'
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222'
const FLOW = 'a'.repeat(32)
const CSRF = 'd'.repeat(64)
const REVOKE_ALL = '/v1/account/sessions/revoke-all'
const STEP_UP_KEY = 'pulse.account.billingStepUp.v1'
let cookie = ''
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

type Call = { method: string; path: string; body?: string; csrf?: string }
const calls: Call[] = []
function stubApi(options: { me?: Record<string, unknown>; revokeAll?: () => Response; logout?: () => Response }) {
  calls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({ method: init?.method ?? 'GET', path, body: typeof init?.body === 'string' ? init.body : undefined, csrf: headers['X-Pulse-CSRF'] })
    if (path === '/v1/account/me') return options.me ? json(options.me) : json({ error: 'sign_in_required' }, 401)
    if (path === '/v1/account/devices') return json({ devices: [{ id: 'dev-1', label: 'Chrome on Windows', expiresAt: '2026-11-08T00:00:00Z' }] })
    if (path === REVOKE_ALL) return options.revokeAll?.() ?? new Response(null, { status: 204 })
    if (path === '/v1/account/auth/logout') return options.logout?.() ?? new Response(null, { status: 204 })
    return json({ error: 'not_found' }, 404)
  }))
}
const revokeCalls = () => calls.filter(call => call.path === REVOKE_ALL)
const twitchMe = { accountId: ACCOUNT_A, signInMethods: ['twitch'] }

async function openConfirm() {
  const section = await screen.findByTestId('sign-out-everywhere')
  fireEvent.click(within(section).getByRole('button', { name: 'Sign out everywhere' }))
  return section
}

beforeEach(() => {
  resetAccountSessionForTests()
  cookie = `__Host-pulse_csrf=${CSRF}`
  vi.spyOn(document, 'cookie', 'get').mockImplementation(() => cookie)
  vi.mocked(beginTwitchFlow).mockReset().mockResolvedValue(undefined)
  sessionStorage.clear()
  localStorage.clear()
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('Sign out everywhere: flags', () => {
  it('is not offered while Twitch sign-in is off, and nothing calls revoke-all', async () => {
    vi.stubEnv('VITE_TWITCH_SIGNIN', '')
    stubApi({ me: { accountId: ACCOUNT_A } })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    expect(await screen.findByRole('heading', { level: 2, name: 'Linked extensions' })).toBeTruthy()
    expect(screen.queryByTestId('sign-out-everywhere')).toBeNull()
    expect(screen.queryByText(/Sign out everywhere/)).toBeNull()
    expect(revokeCalls()).toHaveLength(0)
  })

  it.each(['1', 'public'] as const)('is offered to a signed-in account with VITE_TWITCH_SIGNIN=%s', async value => {
    vi.stubEnv('VITE_TWITCH_SIGNIN', value)
    stubApi({ me: twitchMe })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    const section = await screen.findByTestId('sign-out-everywhere')
    expect(within(section).getByRole('heading', { level: 2, name: 'Sign out everywhere' })).toBeTruthy()
    expect(section.textContent).toContain('Nothing is deleted')
  })

  it('is not offered to a signed-out visitor', async () => {
    vi.stubEnv('VITE_TWITCH_SIGNIN', 'public')
    cookie = ''
    stubApi({})
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    expect(await screen.findByTestId('settings-signed-out')).toBeTruthy()
    expect(screen.queryByTestId('sign-out-everywhere')).toBeNull()
  })
})

describe('Sign out everywhere: outcomes', () => {
  beforeEach(() => { vi.stubEnv('VITE_TWITCH_SIGNIN', '1') })

  it('asks first, then signs out everywhere and shows the signed-out state', async () => {
    localStorage.setItem('pulse.account.signedInAt.v1', String(Date.now()))
    rememberTwitchIdentity({ displayName: 'PulseTester', via: 'signin' })
    stubApi({ me: twitchMe })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    const section = await openConfirm()
    // The first click only asks.
    expect(revokeCalls()).toHaveLength(0)
    const group = within(section).getByRole('group', { name: 'Confirm sign out everywhere' })
    expect(group.textContent).toContain('Every browser and extension signed in to this account will need to sign in again')
    fireEvent.click(within(group).getByRole('button', { name: 'Confirm sign out everywhere' }))
    expect((await screen.findByTestId('revoke-all-done')).textContent).toContain('You’re signed out everywhere.')
    expect(revokeCalls()).toEqual([{ method: 'POST', path: REVOKE_ALL, body: '{}', csrf: CSRF }])
    // Signed out here too: no account facts, the sign-in entry instead.
    expect(screen.getByTestId('settings-signed-out')).toBeTruthy()
    expect(screen.queryByText('You’re signed in to StreamPulse.')).toBeNull()
    expect(screen.queryByText('Chrome on Windows')).toBeNull()
    expect(screen.queryByTestId('sign-out-everywhere')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    // Other tabs are told, and this tab forgets the Twitch name it kept.
    expect(localStorage.getItem('pulse.account.signedInAt.v1')).toBeNull()
    expect(sessionStorage.getItem('pulse.account.twitch.v1')).toBeNull()
    expect(knownTwitchIdentity()).toBeNull()
  })

  it('Cancel closes the question without a request', async () => {
    stubApi({ me: twitchMe })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    const section = await openConfirm()
    fireEvent.click(within(section).getByRole('button', { name: 'Cancel' }))
    expect(within(section).queryByRole('group', { name: 'Confirm sign out everywhere' })).toBeNull()
    expect(within(section).getByRole('button', { name: 'Sign out everywhere' })).toBeTruthy()
    expect(revokeCalls()).toHaveLength(0)
  })

  it('asks a Twitch account to Confirm it’s you on recent_auth_required and remembers which account asked', async () => {
    stubApi({ me: twitchMe, revokeAll: () => json({ error: 'recent_auth_required' }, 403) })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    const section = await openConfirm()
    fireEvent.click(within(section).getByRole('button', { name: 'Confirm sign out everywhere' }))
    const prompt = await screen.findByTestId('revoke-all-confirm-twitch')
    expect(prompt.textContent).toContain('Confirm it’s you')
    expect(prompt.textContent).toContain('signing out everywhere needs a Twitch check from the last 10 minutes. Nothing was signed out.')
    // Nothing ended: still signed in, with the extension list.
    expect(screen.getByText('You’re signed in to StreamPulse.')).toBeTruthy()
    expect(screen.queryByTestId('revoke-all-done')).toBeNull()
    vi.mocked(beginTwitchFlow).mockImplementation(async options => { options.beforeLeave?.(FLOW) })
    fireEvent.click(within(prompt).getByRole('button', { name: 'Continue with Twitch' }))
    await waitFor(() => expect(beginTwitchFlow).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'signin', returnTo: '/account/settings' })))
    expect(JSON.parse(sessionStorage.getItem(STEP_UP_KEY)!)).toMatchObject({ flowId: FLOW, completed: false, purpose: 'revoke-all' })
    // The billing page never reads this record as its own.
    completeBillingStepUp(FLOW)
    expect(takeBillingStepUp(ACCOUNT_A)).toBe('none')
    expect(sessionStorage.getItem(STEP_UP_KEY)).not.toBeNull()
    expect(takeBillingStepUp(ACCOUNT_A, 'revoke-all')).toBe('same')
  })

  it('leaves no record when the Twitch check cannot start', async () => {
    stubApi({ me: twitchMe, revokeAll: () => json({ error: 'recent_auth_required' }, 403) })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    const section = await openConfirm()
    fireEvent.click(within(section).getByRole('button', { name: 'Confirm sign out everywhere' }))
    const prompt = await screen.findByTestId('revoke-all-confirm-twitch')
    vi.mocked(beginTwitchFlow).mockImplementation(async options => { options.beforeLeave?.(FLOW); throw new Error('offline') })
    fireEvent.click(within(prompt).getByRole('button', { name: 'Continue with Twitch' }))
    await waitFor(() => expect(sessionStorage.getItem(STEP_UP_KEY)).toBeNull())
  })

  it('asks an email account to sign out and sign in again on recent_auth_required', async () => {
    stubApi({ me: { accountId: ACCOUNT_A, email: 'tester@example.com' }, revokeAll: () => json({ error: 'recent_auth_required' }, 403) })
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    const section = await openConfirm()
    fireEvent.click(within(section).getByRole('button', { name: 'Confirm sign out everywhere' }))
    const prompt = await screen.findByTestId('revoke-all-sign-in-again')
    expect(prompt.textContent).toContain('needs a sign-in from the last 10 minutes. Nothing was signed out yet.')
    expect(prompt.textContent).toContain('To confirm, sign out of this browser and sign in again with your email.')
    // A plain link to /account/sign-in would show this still-signed-in browser
    // "You're signed in" and no email form (AccountSignInGate).
    expect(within(prompt).queryByRole('link')).toBeNull()
    expect(screen.queryByTestId('revoke-all-confirm-twitch')).toBeNull()
    expect(beginTwitchFlow).not.toHaveBeenCalled()
    expect(calls.some(call => call.path === '/v1/account/auth/logout')).toBe(false)
    fireEvent.click(within(prompt).getByRole('button', { name: 'Sign out and sign in again' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/account/sign-in?method=email'))
    const logout = calls.filter(call => call.path === '/v1/account/auth/logout')
    expect(logout).toEqual([{ method: 'POST', path: '/v1/account/auth/logout', body: '{}', csrf: CSRF }])
    // Only this browser signed out; nothing asked for revoke-all again.
    expect(revokeCalls()).toHaveLength(1)
    expect(screen.queryByTestId('revoke-all-done')).toBeNull()
  })

  it('keeps the email account signed in and says so when signing out here fails', async () => {
    stubApi({ me: { accountId: ACCOUNT_A, email: 'tester@example.com' }, revokeAll: () => json({ error: 'recent_auth_required' }, 403), logout: () => json({ error: 'request_unavailable' }, 503) })
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    const section = await openConfirm()
    fireEvent.click(within(section).getByRole('button', { name: 'Confirm sign out everywhere' }))
    const prompt = await screen.findByTestId('revoke-all-sign-in-again')
    fireEvent.click(within(prompt).getByRole('button', { name: 'Sign out and sign in again' }))
    expect(await screen.findByText('Account services are unavailable right now. Please try again later.')).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
    expect(screen.getByText('You’re signed in to StreamPulse.')).toBeTruthy()
  })

  it.each([404, 405])('says it is not available yet when the route answers %i', async status => {
    stubApi({ me: twitchMe, revokeAll: () => json({ error: 'not_found' }, status) })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    const section = await openConfirm()
    fireEvent.click(within(section).getByRole('button', { name: 'Confirm sign out everywhere' }))
    expect((await screen.findByTestId('revoke-all-unavailable')).textContent).toBe('Sign out everywhere isn’t available yet. Nothing was signed out. You can still sign out here and revoke each extension above.')
    expect(screen.getByText('You’re signed in to StreamPulse.')).toBeTruthy()
    expect(screen.queryByTestId('revoke-all-done')).toBeNull()
    expect(screen.getByText('Chrome on Windows')).toBeTruthy()
  })

  it('reports a server failure without claiming success or blaming the connection, and can be tried again', async () => {
    let answer = () => json({ error: 'request_unavailable' }, 503)
    stubApi({ me: twitchMe, revokeAll: () => answer() })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    const section = await openConfirm()
    fireEvent.click(within(section).getByRole('button', { name: 'Confirm sign out everywhere' }))
    expect((await screen.findByTestId('revoke-all-failed')).textContent).toBe('Sign out everywhere couldn’t be confirmed. Account services are unavailable right now. Please try again later.')
    expect(screen.queryByTestId('revoke-all-done')).toBeNull()
    expect(screen.getByText('You’re signed in to StreamPulse.')).toBeTruthy()
    answer = () => new Response(null, { status: 204 })
    const retry = within(section).getByRole('button', { name: 'Confirm sign out everywhere' }) as HTMLButtonElement
    expect(retry.disabled).toBe(false)
    fireEvent.click(retry)
    expect(await screen.findByTestId('revoke-all-done')).toBeTruthy()
    expect(revokeCalls()).toHaveLength(2)
  })

  it.each([500, 502])('gives a %i the server wording, not the connection wording', async status => {
    stubApi({ me: twitchMe, revokeAll: () => new Response('upstream', { status }) })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    const section = await openConfirm()
    fireEvent.click(within(section).getByRole('button', { name: 'Confirm sign out everywhere' }))
    expect((await screen.findByTestId('revoke-all-failed')).textContent).toBe('Sign out everywhere couldn’t be confirmed. Account services are unavailable right now. Please try again later.')
    expect(screen.queryByTestId('revoke-all-done')).toBeNull()
  })

  it('treats a network failure as unconfirmed and points at the connection', async () => {
    stubApi({ me: twitchMe, revokeAll: () => { throw new TypeError('Failed to fetch') } })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    const section = await openConfirm()
    fireEvent.click(within(section).getByRole('button', { name: 'Confirm sign out everywhere' }))
    expect((await screen.findByTestId('revoke-all-failed')).textContent).toBe('Sign out everywhere couldn’t be confirmed. Check your connection and try again.')
    expect(screen.queryByTestId('revoke-all-done')).toBeNull()
  })

  it('shows the rate-limit message on 429', async () => {
    stubApi({ me: twitchMe, revokeAll: () => json({ error: 'try_later' }, 429) })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    const section = await openConfirm()
    fireEvent.click(within(section).getByRole('button', { name: 'Confirm sign out everywhere' }))
    expect((await within(section).findByRole('alert')).textContent).toBe('Too many attempts. Wait a few minutes, then try again.')
    expect(screen.queryByTestId('revoke-all-done')).toBeNull()
  })

  it('shows the session as ended on 401, without claiming everything was signed out', async () => {
    stubApi({ me: twitchMe, revokeAll: () => json({ error: 'sign_in_required' }, 401) })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    const section = await openConfirm()
    fireEvent.click(within(section).getByRole('button', { name: 'Confirm sign out everywhere' }))
    expect((await screen.findByRole('alert')).textContent).toBe('This session or link has expired. Sign in again to continue.')
    expect(screen.getByTestId('settings-signed-out')).toBeTruthy()
    expect(screen.queryByTestId('revoke-all-done')).toBeNull()
    expect(screen.queryByTestId('sign-out-everywhere')).toBeNull()
  })
})

describe('Sign out everywhere: back from Confirm it’s you', () => {
  beforeEach(() => { vi.stubEnv('VITE_TWITCH_SIGNIN', '1') })

  it('reopens the question for the same account, which then signs out everywhere', async () => {
    rememberBillingStepUp(ACCOUNT_A, FLOW, 'revoke-all')
    completeBillingStepUp(FLOW)
    stubApi({ me: twitchMe })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    expect((await screen.findByTestId('revoke-all-confirmed')).textContent).toContain('Thanks, that’s confirmed.')
    expect(sessionStorage.getItem(STEP_UP_KEY)).toBeNull()
    expect(revokeCalls()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sign out everywhere' }))
    expect(await screen.findByTestId('revoke-all-done')).toBeTruthy()
  })

  it('never signs out a different account that Twitch returned; the person chooses', async () => {
    rememberBillingStepUp(ACCOUNT_A, FLOW, 'revoke-all')
    completeBillingStepUp(FLOW)
    stubApi({ me: { accountId: ACCOUNT_B, signInMethods: ['twitch'] } })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    const wrong = await screen.findByTestId('revoke-all-wrong-account')
    expect(wrong.textContent).toContain('Twitch signed you in to a different StreamPulse account than the one that asked to sign out everywhere. Nothing was signed out.')
    expect(screen.queryByRole('button', { name: 'Confirm sign out everywhere' })).toBeNull()
    expect(screen.queryByTestId('revoke-all-confirmed')).toBeNull()
    expect(revokeCalls()).toHaveLength(0)
    fireEvent.click(within(wrong).getByRole('button', { name: 'Stay with this account' }))
    expect(screen.queryByTestId('revoke-all-wrong-account')).toBeNull()
    expect(within(screen.getByTestId('sign-out-everywhere')).getByRole('button', { name: 'Sign out everywhere' })).toBeTruthy()
    expect(revokeCalls()).toHaveLength(0)
  })

  it('leaves a billing check for the billing page', async () => {
    rememberBillingStepUp(ACCOUNT_A, FLOW)
    completeBillingStepUp(FLOW)
    stubApi({ me: twitchMe })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    expect(await screen.findByTestId('sign-out-everywhere')).toBeTruthy()
    expect(screen.queryByTestId('revoke-all-confirmed')).toBeNull()
    expect(takeBillingStepUp(ACCOUNT_A)).toBe('same')
  })

  it('ignores an unfinished round trip', async () => {
    rememberBillingStepUp(ACCOUNT_A, FLOW, 'revoke-all')
    stubApi({ me: { accountId: ACCOUNT_B, signInMethods: ['twitch'] } })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    expect(await screen.findByTestId('sign-out-everywhere')).toBeTruthy()
    expect(screen.queryByTestId('revoke-all-wrong-account')).toBeNull()
    expect(screen.queryByTestId('revoke-all-confirmed')).toBeNull()
    expect(sessionStorage.getItem(STEP_UP_KEY)).toBeNull()
  })
})
