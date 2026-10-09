import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountPage from '../src/routes/account/AccountPage'
import AccountSettings from '../src/routes/account/AccountSettings'
import BillingPage from '../src/routes/account/BillingPage'
import Supporter from '../src/routes/public/Supporter'
import Terms from '../src/routes/public/Terms'
import { rememberTwitchIdentity, resetAccountSessionForTests } from '../src/lib/accountSession'
import { rememberBillingStepUp, takeBillingStepUp, BILLING_STEP_UP_MAX_AGE_MS } from '../src/lib/accountStepUp'
import { beginTwitchFlow } from '../src/lib/twitchSignIn'
import { twitchSignInEnabled, twitchSignInPublic, twitchSignInStage } from '../src/lib/twitchSignInFlag'

/**
 * Account journey stages (closeout 2026-10-08 spec §3): unset = A (today),
 * VITE_TWITCH_SIGNIN=1 = tester, =public = C. Public pages never offer a
 * website-account or email-restore choice, and no stage renders a button that
 * targets a route that is switched off.
 */
vi.mock('../src/lib/twitchSignIn', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/twitchSignIn')>(),
  beginTwitchFlow: vi.fn(),
}))
vi.mock('../src/ui/components/PublicLayout', () => ({ PublicLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111'
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222'
let cookie = ''
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

type Api = { me?: () => Response; supporter?: () => Response; portal?: () => Response }
const calls: string[] = []
function stubApi(api: Api) {
  calls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    calls.push(`${init?.method ?? 'GET'} ${path}`)
    if (path === '/v1/account/me') return api.me?.() ?? json({ error: 'sign_in_required' }, 401)
    if (path === '/v1/billing/supporter') return api.supporter?.() ?? json({ error: 'sign_in_required' }, 401)
    if (path === '/v1/billing/portal') return api.portal?.() ?? json({ url: 'https://billing.stripe.com/p/session/test' })
    if (path === '/v1/account/devices') return json({ devices: [] })
    return json({ error: 'not_found' }, 404)
  }))
}

beforeEach(() => {
  resetAccountSessionForTests()
  cookie = ''
  vi.spyOn(document, 'cookie', 'get').mockImplementation(() => cookie)
  vi.mocked(beginTwitchFlow).mockReset().mockResolvedValue(undefined)
  sessionStorage.clear()
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('stage switch', () => {
  it.each([
    [undefined, 'off', false, false],
    ['', 'off', false, false],
    ['0', 'off', false, false],
    ['true', 'off', false, false],
    ['1', 'tester', true, false],
    ['public', 'public', true, true],
  ] as const)('VITE_TWITCH_SIGNIN=%s is %s', (value, stage, enabled, isPublic) => {
    if (value !== undefined) vi.stubEnv('VITE_TWITCH_SIGNIN', value)
    expect(twitchSignInStage()).toBe(stage)
    expect(twitchSignInEnabled()).toBe(enabled)
    expect(twitchSignInPublic()).toBe(isPublic)
  })
})

describe.each([
  ['', 'A (today)'],
  ['1', 'tester'],
  ['public', 'public'],
] as const)('/supporter with VITE_TWITCH_SIGNIN=%s (%s)', (value) => {
  beforeEach(() => { vi.stubEnv('VITE_TWITCH_SIGNIN', value) })

  it('offers no website-account or restore choice and says sign-ups are not open', () => {
    render(<MemoryRouter><Supporter /></MemoryRouter>)
    const body = screen.getByTestId('supporter-offer').textContent ?? ''
    expect(body).not.toMatch(/website account/i)
    expect(body).not.toMatch(/Restore my Supporter|restore link|installation/i)
    const availability = screen.getByTestId('supporter-availability').textContent ?? ''
    expect(availability).toMatch(/^Supporter sign-ups are not open yet\. When they open, you’ll choose Continue with Twitch, then pay on Stripe\. Free tools work without an account\./)
    expect(availability).toContain('Stripe asks for a billing email at checkout. It can be different from your Twitch email, and you don’t need a separate StreamPulse sign-up.')
    expect(screen.getByTestId('supporter-reinstall').textContent).toMatch(/Continue with Twitch with the same Twitch account/)
    // Access recovery after losing Twitch is separate from Stripe billing.
    expect(screen.getByTestId('supporter-lost-twitch').textContent).toMatch(/That changes billing only\. It doesn’t move your membership to another Twitch account/)
    for (const link of screen.getAllByRole('link')) expect(link.getAttribute('href')).not.toBe('/account')
    const twitch = screen.queryByTestId('supporter-continue-with-twitch')
    if (value === 'public') expect(twitch?.getAttribute('href')).toBe('/account/sign-in?returnTo=%2Faccount%2Fbilling')
    else expect(twitch).toBeNull()
  })
})

describe('sign-in page in the public stage', () => {
  beforeEach(() => { vi.stubEnv('VITE_TWITCH_SIGNIN', 'public') })

  it('leads with Continue with Twitch and keeps email under Tester email sign-in', () => {
    stubApi({})
    render(<MemoryRouter initialEntries={['/account/sign-in']}><AccountPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to StreamPulse' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue with Twitch' })).toBeTruthy()
    expect(screen.queryByTestId('twitch-pilot-note')).toBeNull()
    expect(screen.queryByLabelText('Email address')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tester email sign-in' }))
    expect(screen.getByLabelText('Email address')).toBeTruthy()
  })
})

describe('account settings', () => {
  it('says “Signed in with Twitch as” only for a Twitch sign-in this tab saw', async () => {
    vi.stubEnv('VITE_TWITCH_SIGNIN', '1')
    cookie = `__Host-pulse_csrf=${'d'.repeat(64)}`
    rememberTwitchIdentity({ displayName: 'PulseTester', via: 'signin' })
    stubApi({ me: () => json({ accountId: ACCOUNT_A, signInMethods: ['twitch'] }) })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    expect((await screen.findByTestId('twitch-account-row')).textContent).toContain('Signed in with Twitch as PulseTester')
  })

  it('keeps today’s device section and no tester heading while Twitch is off', async () => {
    vi.stubEnv('VITE_TWITCH_SIGNIN', '')
    cookie = `__Host-pulse_csrf=${'d'.repeat(64)}`
    stubApi({ me: () => json({ accountId: ACCOUNT_A }) })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    expect(await screen.findByRole('heading', { level: 2, name: 'Linked extensions' })).toBeTruthy()
    expect(screen.queryByTestId('other-ways-to-connect')).toBeNull()
    expect(calls.some(call => call.includes('/twitch/'))).toBe(false)
  })
})

describe('billing, signed out', () => {
  it('points to the tester sign-in and offers no extension-link step while Twitch is off', async () => {
    vi.stubEnv('VITE_TWITCH_SIGNIN', '')
    stubApi({})
    render(<MemoryRouter initialEntries={['/account/billing']}><BillingPage /></MemoryRouter>)
    expect((await screen.findByRole('link', { name: 'Tester sign-in' })).getAttribute('href')).toBe('/account/sign-in?returnTo=%2Faccount%2Fbilling')
    expect(screen.getByText(/Supporter sign-ups are not open yet\. Invited testers can sign in/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Connect your extension' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue with Twitch' })).toBeNull()
  })

  it('starts Continue with Twitch back to billing in the public stage', async () => {
    vi.stubEnv('VITE_TWITCH_SIGNIN', 'public')
    stubApi({})
    render(<MemoryRouter initialEntries={['/account/billing']}><BillingPage /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Twitch' }))
    await waitFor(() => expect(beginTwitchFlow).toHaveBeenCalledWith({ purpose: 'signin', returnTo: '/account/billing' }))
    expect(screen.queryByRole('link', { name: 'Connect your extension' })).toBeNull()
  })
})

describe('Manage subscription: Confirm it’s you', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_TWITCH_SIGNIN', '1')
    cookie = `__Host-pulse_csrf=${'d'.repeat(64)}`
  })

  it('asks a Twitch account for a Twitch check and remembers which account asked', async () => {
    stubApi({
      me: () => json({ accountId: ACCOUNT_A, signInMethods: ['twitch'] }),
      supporter: () => json({ schemaVersion: 1, status: 'active', accountId: ACCOUNT_A }),
      portal: () => json({ error: 'sign_in_required' }, 401),
    })
    render(<MemoryRouter initialEntries={['/account/billing']}><BillingPage /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Manage subscription' }))
    const prompt = await screen.findByTestId('billing-confirm-twitch')
    expect(prompt.textContent).toContain('Confirm it’s you')
    expect(prompt.textContent).toContain('For your security, managing your subscription needs a Twitch check from the last 10 minutes.')
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Twitch' }))
    await waitFor(() => expect(beginTwitchFlow).toHaveBeenCalledWith({ purpose: 'signin', returnTo: '/account/billing' }))
    expect(takeBillingStepUp(ACCOUNT_A)).toBe('same')
  })

  it('keeps the email path for an account without Twitch', async () => {
    stubApi({
      me: () => json({ accountId: ACCOUNT_A, signInMethods: ['email'] }),
      supporter: () => json({ schemaVersion: 1, status: 'active', accountId: ACCOUNT_A }),
      portal: () => json({ error: 'sign_in_required' }, 401),
    })
    render(<MemoryRouter initialEntries={['/account/billing']}><BillingPage /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Manage subscription' }))
    expect(await screen.findByRole('link', { name: 'Sign in again' })).toBeTruthy()
    expect(screen.queryByTestId('billing-confirm-twitch')).toBeNull()
  })

  it('shows the wrong-account copy and never opens the portal when Twitch returned another account', async () => {
    rememberBillingStepUp(ACCOUNT_A)
    stubApi({ supporter: () => json({ schemaVersion: 1, status: 'active', accountId: ACCOUNT_B }) })
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    render(<MemoryRouter initialEntries={['/account/billing']}><BillingPage /></MemoryRouter>)
    expect((await screen.findByTestId('billing-wrong-account')).textContent).toContain('This subscription belongs to a different Twitch account. Sign out, then Continue with Twitch with the account you subscribed with.')
    expect(screen.queryByRole('button', { name: 'Manage subscription' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(calls.filter(call => call.includes('/v1/billing/portal'))).toEqual([])
    expect(assign).not.toHaveBeenCalled()
  })

  it('lets the same account continue after the check', async () => {
    rememberBillingStepUp(ACCOUNT_A)
    stubApi({ supporter: () => json({ schemaVersion: 1, status: 'active', accountId: ACCOUNT_A }) })
    render(<MemoryRouter initialEntries={['/account/billing']}><BillingPage /></MemoryRouter>)
    expect((await screen.findByTestId('billing-step-up-confirmed')).textContent).toBe('Thanks, that’s confirmed. Choose Manage subscription to continue.')
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeTruthy()
    expect(screen.queryByTestId('billing-wrong-account')).toBeNull()
  })
})

describe('step-up record', () => {
  it('is single-use, expires and ignores malformed IDs', () => {
    expect(takeBillingStepUp(ACCOUNT_A)).toBe('none')
    expect(rememberBillingStepUp('not-an-account')).toBe(false)
    expect(takeBillingStepUp(ACCOUNT_A)).toBe('none')
    expect(rememberBillingStepUp(ACCOUNT_A)).toBe(true)
    expect(sessionStorage.getItem('pulse.account.billingStepUp.v1')).not.toContain(ACCOUNT_A)
    expect(takeBillingStepUp(ACCOUNT_B)).toBe('different')
    expect(takeBillingStepUp(ACCOUNT_A)).toBe('none')
    vi.useFakeTimers()
    try {
      rememberBillingStepUp(ACCOUNT_A)
      vi.advanceTimersByTime(BILLING_STEP_UP_MAX_AGE_MS + 1)
      expect(takeBillingStepUp(ACCOUNT_A)).toBe('none')
    } finally { vi.useRealTimers() }
  })
})

describe('frozen Supporter benefit lists', () => {
  it('keeps the Supporter page lists byte-identical', () => {
    render(<MemoryRouter><Supporter /></MemoryRouter>)
    const items = Array.from(screen.getByTestId('supporter-offer').querySelectorAll('h2 + ul li')).map(li => li.textContent)
    expect(items).toEqual(['A private Pulse header accent.', 'Three private overlay finishes.', 'Private support recognition in your account.'])
  })

  it('keeps the Terms “What you get” and “What you do not get” bullets byte-identical', () => {
    render(<MemoryRouter><Terms /></MemoryRouter>)
    const items = Array.from(screen.getByTestId('terms-of-use').querySelectorAll('li')).map(li => li.textContent)
    expect(items).toContain('What you get: a private Pulse header accent, three private overlay finishes, and private support recognition. Nothing else is promised.')
    expect(items).toContain('What you do not get: no public Twitch chat badge — it is not included — and no analytics, coverage or rate-limit changes of any kind.')
  })
})
