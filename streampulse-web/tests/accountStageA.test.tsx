import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AccountPage from '../src/routes/account/AccountPage'
import BillingPage from '../src/routes/account/BillingPage'
import Supporter from '../src/routes/public/Supporter'
import Terms from '../src/routes/public/Terms'
import { AnalyticsTopNav } from '../src/ui/components/analytics/AnalyticsTopNav'

/**
 * Stage A of the account journey (closeout 2026-10-08 spec §3, P1): what the
 * public site says while Continue with Twitch is not open. No flags are read.
 * Public pages offer no website-account, email-restore or tester-bridge choice,
 * and every button shown works today.
 */
vi.mock('../src/ui/components/PublicLayout', () => ({ PublicLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

const calls: string[] = []
function stubSignedOut() {
  calls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(input)}`)
    return new Response(JSON.stringify({ error: 'sign_in_required' }), { status: 401 })
  }))
}
afterEach(() => { vi.unstubAllGlobals() })

describe('/supporter', () => {
  it('offers no website-account or restore choice and says how sign-ups will work', () => {
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
    for (const link of screen.getAllByRole('link')) expect(link.getAttribute('href')).not.toMatch(/^\/account(\/|$)/)
    expect(screen.queryByRole('button', { name: 'Continue with Twitch' })).toBeNull()
  })
})

describe('/account/sign-in', () => {
  it('is the tester sign-in: Twitch coming soon, the pilot email form, no Twitch call', () => {
    stubSignedOut()
    render(<MemoryRouter initialEntries={['/account/sign-in']}><AccountPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Tester sign-in' })).toBeTruthy()
    expect(screen.getByTestId('twitch-coming-soon').textContent).toBe('Twitch sign-in is coming soon. Free tools work without an account.')
    expect(screen.getByTestId('pilot-sign-in-note')).toBeTruthy()
    expect(screen.getByLabelText('Email address')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Twitch/ })).toBeNull()
    expect(calls.some(call => call.includes('/twitch/'))).toBe(false)
  })
})

describe('/account/billing, signed out', () => {
  it('points to the tester sign-in and offers no extension-link step', async () => {
    stubSignedOut()
    render(<MemoryRouter initialEntries={['/account/billing']}><BillingPage /></MemoryRouter>)
    expect((await screen.findByRole('link', { name: 'Tester sign-in' })).getAttribute('href')).toBe('/account/sign-in?returnTo=%2Faccount%2Fbilling')
    expect(screen.getByText(/Supporter sign-ups are not open yet\. Invited testers can sign in/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Connect your extension' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue with Twitch' })).toBeNull()
  })
})

describe('/analytics support menu', () => {
  it('links no tester sign-in, closed billing action or connection-code bridge', () => {
    render(<MemoryRouter initialEntries={['/analytics']}><AnalyticsTopNav items={[{ label: 'Overview', to: '/analytics', end: true }]} /></MemoryRouter>)
    const menu = screen.getByRole('navigation', { name: 'Analytics navigation' }).querySelector('.analytics-topnav__more-links')!
    const hrefs = Array.from(menu.querySelectorAll('a')).map(link => link.getAttribute('href'))
    expect(hrefs).toEqual(['/docs', '/support', '/status', '/supporter', '/privacy', '/terms', '/refunds'])
    expect(hrefs.some(href => href?.startsWith('/account'))).toBe(false)
    expect(menu.textContent).not.toMatch(/Manage membership|Manage subscription|Link extension/)
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
