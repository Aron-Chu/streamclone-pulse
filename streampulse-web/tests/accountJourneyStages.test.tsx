import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountPage from '../src/routes/account/AccountPage'
import AccountSettings from '../src/routes/account/AccountSettings'
import BillingPage from '../src/routes/account/BillingPage'
import Supporter from '../src/routes/public/Supporter'
import Terms from '../src/routes/public/Terms'
import { rememberTwitchIdentity, resetAccountSessionForTests } from '../src/lib/accountSession'
import { completeBillingStepUp, rememberBillingStepUp, takeBillingStepUp, BILLING_STEP_UP_MAX_AGE_MS } from '../src/lib/accountStepUp'
import { AnalyticsTopNav } from '../src/ui/components/analytics/AnalyticsTopNav'
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
const FLOW = 'a'.repeat(32)
/** The Twitch round trip for a billing check came back finished for `accountId`'s flow. */
function finishedStepUp(accountId: string) {
  rememberBillingStepUp(accountId, FLOW)
  completeBillingStepUp(FLOW)
}
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
] as const)('/supporter with VITE_TWITCH_SIGNIN=%s (%s)', (value, _stage) => {
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

  it('lists every signed-in extension as a normal section; only connection codes are the tester bridge', async () => {
    vi.stubEnv('VITE_TWITCH_SIGNIN', '1')
    cookie = `__Host-pulse_csrf=${'d'.repeat(64)}`
    stubApi({ me: () => json({ accountId: ACCOUNT_A, signInMethods: ['twitch'] }) })
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/v1/account/me') return json({ accountId: ACCOUNT_A, signInMethods: ['twitch'] })
      if (path === '/v1/account/devices') return json({ devices: [{ id: 'dev-1', label: 'Chrome on Windows', expiresAt: '2026-11-08T00:00:00Z' }] })
      return json({ error: 'not_found' }, 404)
    })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    expect(await screen.findByRole('heading', { level: 2, name: 'Linked extensions' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Revoke Chrome on Windows' })).toBeTruthy()
    const testers = screen.getByTestId('other-ways-to-connect')
    expect(within(testers).getByRole('heading', { level: 2, name: 'Other ways to connect (testers)' })).toBeTruthy()
    expect(within(testers).getByRole('link', { name: 'Link extension with a code' }).getAttribute('href')).toBe('/account/link-device')
    expect(within(testers).queryByText('Chrome on Windows')).toBeNull()
    expect(screen.getAllByRole('link').filter(link => link.getAttribute('href') === '/account/link-device')).toHaveLength(1)
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
    vi.mocked(beginTwitchFlow).mockImplementation(async options => { options.beforeLeave?.(FLOW) })
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Twitch' }))
    await waitFor(() => expect(beginTwitchFlow).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'signin', returnTo: '/account/billing' })))
    // Remembered for this flow, but it counts only once that flow's callback finishes.
    expect(JSON.parse(sessionStorage.getItem('pulse.account.billingStepUp.v1')!)).toMatchObject({ flowId: FLOW, completed: false })
    completeBillingStepUp(FLOW)
    expect(takeBillingStepUp(ACCOUNT_A)).toBe('same')
  })

  it('never says “confirmed” after a Twitch round trip that did not finish', async () => {
    let portalCalls = 0
    stubApi({
      me: () => json({ accountId: ACCOUNT_A, signInMethods: ['twitch'] }),
      supporter: () => json({ schemaVersion: 1, status: 'active', accountId: ACCOUNT_A }),
      portal: () => { portalCalls++; return json({ error: 'sign_in_required' }, 401) },
    })
    vi.mocked(beginTwitchFlow).mockImplementation(async options => { options.beforeLeave?.(FLOW) })
    const first = render(<MemoryRouter initialEntries={['/account/billing']}><BillingPage /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Manage subscription' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Twitch' }))
    await waitFor(() => expect(beginTwitchFlow).toHaveBeenCalled())
    // The person cancels on Twitch or presses Back: no callback finishes.
    first.unmount()
    render(<MemoryRouter initialEntries={['/account/billing']}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Supporter active' })).toBeTruthy()
    expect(screen.queryByTestId('billing-step-up-confirmed')).toBeNull()
    expect(screen.queryByTestId('billing-wrong-account')).toBeNull()
    expect(sessionStorage.getItem('pulse.account.billingStepUp.v1')).toBeNull()
    expect(portalCalls).toBe(1)
  })

  it('leaves no record behind when the Twitch flow cannot start, so a later account switch is not blocked', async () => {
    stubApi({
      me: () => json({ accountId: ACCOUNT_A, signInMethods: ['twitch'] }),
      supporter: () => json({ schemaVersion: 1, status: 'active', accountId: ACCOUNT_A }),
      portal: () => json({ error: 'sign_in_required' }, 401),
    })
    // The flow is saved, then leaving for Twitch fails.
    vi.mocked(beginTwitchFlow).mockImplementation(async options => { options.beforeLeave?.(FLOW); throw new TypeError('Failed to fetch') })
    const first = render(<MemoryRouter initialEntries={['/account/billing']}><BillingPage /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Manage subscription' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Twitch' }))
    expect(await screen.findByText('Twitch sign-in is unavailable')).toBeTruthy()
    expect(sessionStorage.getItem('pulse.account.billingStepUp.v1')).toBeNull()
    first.unmount()
    // Signed in to another account in this tab afterwards: an ordinary visit.
    stubApi({ supporter: () => json({ schemaVersion: 1, status: 'active', accountId: ACCOUNT_B }) })
    render(<MemoryRouter initialEntries={['/account/billing']}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: 'Manage subscription' })).toBeTruthy()
    expect(screen.queryByTestId('billing-wrong-account')).toBeNull()
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
    finishedStepUp(ACCOUNT_A)
    stubApi({ supporter: () => json({ schemaVersion: 1, status: 'active', accountId: ACCOUNT_B }) })
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    render(<MemoryRouter initialEntries={['/account/billing']}><BillingPage /></MemoryRouter>)
    expect((await screen.findByTestId('billing-wrong-account')).textContent).toContain('This subscription belongs to a different Twitch account. Sign out, then Continue with Twitch with the account you subscribed with.')
    expect(screen.queryByRole('button', { name: 'Manage subscription' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(calls.filter(call => call.includes('/v1/billing/portal'))).toEqual([])
    expect(assign).not.toHaveBeenCalled()
    // The other account's own membership is not shown as the one being managed.
    expect(screen.getByRole('heading', { name: 'You came back as a different account' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Supporter active' })).toBeNull()
    expect(document.querySelector('.pulse-membership-facts')).toBeNull()
  })

  it('lets the person keep the account Twitch returned, and then manage that account', async () => {
    finishedStepUp(ACCOUNT_A)
    stubApi({ supporter: () => json({ schemaVersion: 1, status: 'active', accountId: ACCOUNT_B }) })
    render(<MemoryRouter initialEntries={['/account/billing']}><BillingPage /></MemoryRouter>)
    fireEvent.click(within(await screen.findByTestId('billing-wrong-account')).getByRole('button', { name: 'Stay with this account' }))
    expect(screen.queryByTestId('billing-wrong-account')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Supporter active' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeTruthy()
  })

  it('lets the same account continue after the check', async () => {
    finishedStepUp(ACCOUNT_A)
    stubApi({ supporter: () => json({ schemaVersion: 1, status: 'active', accountId: ACCOUNT_A }) })
    render(<MemoryRouter initialEntries={['/account/billing']}><BillingPage /></MemoryRouter>)
    expect((await screen.findByTestId('billing-step-up-confirmed')).textContent).toBe('Thanks, that’s confirmed. Choose Manage subscription to continue.')
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeTruthy()
    expect(screen.queryByTestId('billing-wrong-account')).toBeNull()
  })
})

describe('step-up record', () => {
  it('is single-use, expires, needs a finished flow and ignores malformed IDs', () => {
    expect(takeBillingStepUp(ACCOUNT_A)).toBe('none')
    expect(rememberBillingStepUp('not-an-account', FLOW)).toBe(false)
    expect(rememberBillingStepUp(ACCOUNT_A, 'not-a-flow')).toBe(false)
    expect(takeBillingStepUp(ACCOUNT_A)).toBe('none')
    expect(rememberBillingStepUp(ACCOUNT_A, FLOW)).toBe(true)
    expect(sessionStorage.getItem('pulse.account.billingStepUp.v1')).not.toContain(ACCOUNT_A)
    // Unfinished: neither "same" nor "different", and the read drops it.
    expect(takeBillingStepUp(ACCOUNT_B)).toBe('none')
    expect(sessionStorage.getItem('pulse.account.billingStepUp.v1')).toBeNull()
    finishedStepUp(ACCOUNT_A)
    expect(takeBillingStepUp(ACCOUNT_B)).toBe('different')
    expect(takeBillingStepUp(ACCOUNT_A)).toBe('none')
    // Another flow's sign-in does not finish this record.
    rememberBillingStepUp(ACCOUNT_A, FLOW)
    completeBillingStepUp('b'.repeat(32))
    expect(takeBillingStepUp(ACCOUNT_A)).toBe('none')
    vi.useFakeTimers()
    try {
      finishedStepUp(ACCOUNT_A)
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

describe('/analytics support menu by stage (header flag off)', () => {
  const menuItems = () => Array.from(screen.getByRole('navigation', { name: 'Analytics navigation' }).querySelectorAll('.analytics-topnav__more-links a')).map(link => [link.textContent, link.getAttribute('href')])

  it.each(['', '1'] as const)('links no tester sign-in, billing action or connection code with VITE_TWITCH_SIGNIN=%s', value => {
    vi.stubEnv('VITE_TWITCH_SIGNIN', value)
    stubApi({})
    render(<MemoryRouter initialEntries={['/analytics']}><AnalyticsTopNav items={[{ label: 'Overview', to: '/analytics', end: true }]} /></MemoryRouter>)
    expect(menuItems().map(([, href]) => href)).toEqual(['/docs', '/support', '/status', '/supporter', '/privacy', '/terms', '/refunds'])
    expect(calls).toEqual([])
  })

  it('offers Sign in and Manage subscription in the public stage, never a connection code', () => {
    vi.stubEnv('VITE_TWITCH_SIGNIN', 'public')
    stubApi({})
    render(<MemoryRouter initialEntries={['/analytics']}><AnalyticsTopNav items={[{ label: 'Overview', to: '/analytics', end: true }]} /></MemoryRouter>)
    const items = menuItems()
    expect(items).toContainEqual(['Sign in', '/account/sign-in'])
    expect(items).toContainEqual(['Manage subscription', '/account/billing'])
    expect(items.some(([, href]) => href === '/account/link-device')).toBe(false)
    expect(calls).toEqual([])
  })
})
