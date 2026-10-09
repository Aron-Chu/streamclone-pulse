import { render, screen } from '@testing-library/react'
import SUPPORTER_PERKS from '../../src/shared/supporter-perks.json'
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

// Owner decision 2026-10-09 (Terms option a): /supporter and the Terms list every
// perk the extension gives, from the one list in src/shared/supporter-perks.json
// that the extension renders too. These pin the exact text on both pages.
const PERKS = [
      'Title paint: your Pulse panel title painted in a Glass, Etched or Halo finish, with the wave and sheen you pick.',
      'Tenure crest: a crest beside your painted title that levels up at 3, 6, 12 and 24 months of support.',
      'Emote rain: 7TV emotes behind your Pulse panel header, still or falling: the 7TV header backdrop.',
      'Supporter card: your own crest and paint on the Supporter card in quick settings and in settings, as private recognition for supporting.',
    ]

describe('frozen Supporter benefit lists', () => {
  it('keeps the Supporter page list byte-identical to the shared perk list', () => {
    render(<MemoryRouter><Supporter /></MemoryRouter>)
    const items = Array.from(screen.getByTestId('supporter-perks').querySelectorAll('li')).map(li => li.textContent)
    expect(items).toEqual(PERKS)
    expect(items).toEqual(SUPPORTER_PERKS.names.map(name => `${name}: ${SUPPORTER_PERKS.details[name as keyof typeof SUPPORTER_PERKS.details]}`))
  })

  it('keeps the Terms “What you get” and “What you do not get” bullets byte-identical', () => {
    render(<MemoryRouter><Terms /></MemoryRouter>)
    const benefits = screen.getByTestId('terms-supporter-benefits')
    expect(Array.from(benefits.querySelectorAll('li')).map(li => li.textContent)).toEqual(PERKS)
    expect(benefits.textContent).toMatch(/^What you get: every Supporter perk the extension gives, the same list\s+as on the Supporter page:/)
    expect(benefits.textContent).toContain(`${SUPPORTER_PERKS.onlyYou} ${SUPPORTER_PERKS.moved} Nothing else is promised.`)
    const items = Array.from(screen.getByTestId('terms-of-use').querySelectorAll('li')).map(li => li.textContent)
    expect(items).toContain('What you do not get: no public Twitch chat badge — it is not included — and no analytics, coverage or rate-limit changes of any kind.')
  })

  it('pins the shared perk list itself', () => {
    expect(SUPPORTER_PERKS.names).toEqual(['Title paint', 'Tenure crest', 'Emote rain', 'Supporter card'])
    expect(SUPPORTER_PERKS.onlyYou).toBe('Only you see them, in your own StreamPulse extension. Nothing is added to chat, and nobody else sees them.')
    expect(SUPPORTER_PERKS.moved).toBe('Emote rain, the 7TV header backdrop, was free up to extension 0.2.1. From 0.2.2 it is a Supporter perk, and a backdrop you saved is kept for when you support. No other free feature moved behind Supporter.')
  })
})
