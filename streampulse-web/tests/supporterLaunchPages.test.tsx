import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Supporter from '../src/routes/public/Supporter'
import Terms from '../src/routes/public/Terms'
import Refunds from '../src/routes/public/Refunds'
import Privacy from '../src/routes/public/Privacy'
import { resetSupporterOfferForTests } from '../src/lib/supporterOffer'

const twitch = vi.hoisted(() => ({ begin: vi.fn() }))
const session = vi.hoisted(() => ({ hint: false }))
vi.mock('../src/lib/twitchSignIn', async importOriginal => ({ ...(await importOriginal<typeof import('../src/lib/twitchSignIn')>()), beginTwitchFlow: twitch.begin }))
vi.mock('../src/lib/accountSession', async importOriginal => ({ ...(await importOriginal<typeof import('../src/lib/accountSession')>()), hasAccountSessionHint: () => session.hint }))

const OPEN = { schemaVersion: 1, salesOpen: true, environment: 'live', price: { unitAmount: 499, currency: 'usd', interval: 'month' }, tax: { collection: 'automatic', behavior: 'exclusive' }, termsConsent: true }
const PAGES = [['/supporter', Supporter], ['/terms', Terms], ['/refunds', Refunds], ['/privacy', Privacy]] as const

function serve(offer: unknown, status = 200) {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(offer), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function Where() { const location = useLocation(); return <output data-testid="where">{location.pathname + location.search}</output> }

function renderPage(Page: () => JSX.Element, path = '/supporter') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={<><Page /><Where /></>} /></Routes></MemoryRouter>)
}

beforeEach(() => {
  resetSupporterOfferForTests(); sessionStorage.clear()
  vi.stubEnv('VITE_TWITCH_SIGNIN', 'public')
  twitch.begin.mockReset().mockResolvedValue(undefined)
  session.hint = false
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('closed (or unknown) everywhere', () => {
  it.each([
    ['closed', { ...OPEN, salesOpen: false }, 200],
    ['unknown: 5xx', {}, 503],
    ['billing not mounted: 404', {}, 404],
    ['price mismatch', { ...OPEN, price: { unitAmount: 599, currency: 'usd', interval: 'month' } }, 200],
  ] as const)('%s: the notice stays and no page has a Become a Supporter button', async (_, offer, status) => {
    const fetch = serve(offer, status)
    for (const [path, Page] of PAGES) {
      resetSupporterOfferForTests(); sessionStorage.clear()
      renderPage(Page, path)
      await waitFor(() => expect(fetch).toHaveBeenCalled())
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(screen.getByTestId('prelaunch-notice')).toBeTruthy()
      expect(screen.queryByRole('button', { name: /Become a Supporter|Continue to payment/ })).toBeNull()
      expect(screen.queryByTestId('supporter-continue-with-twitch')).toBeNull()
      cleanup()
    }
  })

  it('keeps every closed string on /supporter and the always-true tax fallback', async () => {
    serve({ ...OPEN, salesOpen: false })
    renderPage(Supporter)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'The offer, once sign-ups open' })).toBeTruthy())
    expect(screen.getByTestId('supporter-availability').textContent).toMatch(/Supporter sign-ups are not open yet/)
    expect(screen.getByTestId('supporter-tax-line').textContent).toBe('Stripe shows the total before you pay.')
    expect(screen.queryByTestId('supporter-offer-strip')).toBeNull()
  })

  it('renders closed before the server answers (the prerendered state)', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    for (const [path, Page] of PAGES) {
      renderPage(Page, path)
      expect(screen.getByTestId('prelaunch-notice')).toBeTruthy()
      cleanup()
    }
  })

  it('stays closed when Continue with Twitch is not public, even if the server is open', async () => {
    vi.stubEnv('VITE_TWITCH_SIGNIN', '')
    serve(OPEN)
    renderPage(Supporter)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(screen.getByTestId('prelaunch-notice')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Become a Supporter' })).toBeNull()
  })
})

describe('open', () => {
  it('removes the notice and the "once sign-ups open" qualifiers on all four pages', async () => {
    serve(OPEN)
    for (const [path, Page] of PAGES) {
      renderPage(Page, path)
      await waitFor(() => expect(screen.queryByTestId('prelaunch-notice')).toBeNull())
      expect(document.body.textContent).not.toMatch(/sign-ups are not open yet|once sign-ups open|Once sign-ups open/i)
      cleanup()
    }
  })

  it('shows the offer strip with price, renewal, the server-selected tax line and Become a Supporter', async () => {
    serve(OPEN)
    renderPage(Supporter)
    const strip = await screen.findByTestId('supporter-offer-strip')
    expect(strip.textContent).toContain('US$4.99 per month. Renews monthly until you cancel. Plus sales tax or VAT where it applies. Stripe shows the total before you pay.')
    expect(strip.textContent).toContain('Continue with Twitch, check the details, then pay on Stripe. About a minute.')
    expect(screen.getByRole('heading', { name: 'The offer' })).toBeTruthy()
    expect(screen.getByTestId('supporter-availability').textContent).toMatch(/Supporter is open\./)
    expect(screen.getAllByRole('button', { name: 'Become a Supporter' })).toHaveLength(2)
  })

  it('signed out: one click goes to Twitch and remembers the subscribe intent', async () => {
    serve(OPEN)
    renderPage(Supporter)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Become a Supporter' }))[0]!)
    await waitFor(() => expect(twitch.begin).toHaveBeenCalledWith({ purpose: 'signin', returnTo: '/account/billing?intent=subscribe' }))
    expect(screen.getByTestId('where').textContent).toBe('/supporter')
  })

  it('signed in: goes straight to the review, without Twitch', async () => {
    session.hint = true
    serve(OPEN)
    renderPage(Supporter)
    expect((await screen.findByTestId('supporter-offer-strip')).textContent).toContain('Check the details, then pay on Stripe.')
    fireEvent.click(screen.getAllByRole('button', { name: 'Become a Supporter' })[0]!)
    expect(screen.getByTestId('where').textContent).toBe('/account/billing?intent=subscribe')
    expect(twitch.begin).not.toHaveBeenCalled()
  })

  it('shows a Twitch failure in place instead of a dead button', async () => {
    twitch.begin.mockRejectedValue(new Error('offline'))
    serve(OPEN)
    renderPage(Supporter)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Become a Supporter' }))[0]!)
    expect(await screen.findByTestId('supporter-become-error')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Become a Supporter' })[0]!.hasAttribute('disabled')).toBe(false)
  })

  it('states the tax line on Terms from what Checkout does', async () => {
    serve({ ...OPEN, tax: { collection: 'automatic', behavior: 'inclusive' } })
    renderPage(Terms, '/terms')
    await waitFor(() => expect(screen.getByTestId('terms-tax-line').textContent).toBe('Taxes: Includes sales tax or VAT where it applies. Stripe shows the total before you pay.'))
    expect(screen.queryByTestId('terms-seller-prelaunch')).toBeNull()
  })
})

describe('legal facts and contacts from one config', () => {
  it('shows Pending for every legal fact until Aron fills the config', () => {
    serve({ ...OPEN, salesOpen: false })
    renderPage(Terms, '/terms')
    const facts = screen.getByTestId('terms-pending-owner-input').textContent ?? ''
    expect(facts.match(/Pending — not yet stated\./g)).toHaveLength(4)
    expect(screen.getByTestId('terms-seller-prelaunch')).toBeTruthy()
    expect(screen.getByTestId('terms-contact').textContent).toContain('privacy@streampulse.stream')
  })
})

describe('lost Twitch access: the portal login link or "email us"', () => {
  const LOGIN = 'https://billing.stripe.com/p/login/test_abc123'
  it('without a login link, every page says to email the billing contact and promises no link', () => {
    serve({ ...OPEN, salesOpen: false })
    renderPage(Supporter)
    expect(screen.getByTestId('supporter-lost-twitch').textContent).toMatch(/Email privacy@streampulse\.stream from the email you paid with, and we’ll cancel or update billing for you\./)
    expect(screen.queryByTestId('supporter-stripe-portal-login')).toBeNull()
    expect(document.body.textContent).not.toMatch(/customer portal\s+with the email you paid with/)
    cleanup()
    renderPage(Refunds, '/refunds')
    expect(screen.getByTestId('refunds-lost-twitch-cancel').textContent).toMatch(/Email privacy@streampulse\.stream/)
    expect(screen.getByTestId('refunds-lost-twitch-ask').textContent).toMatch(/Email privacy@streampulse\.stream/)
    cleanup()
    renderPage(Terms, '/terms')
    expect(screen.getByTestId('terms-billing-email').textContent).toMatch(/email privacy@streampulse\.stream from the email you paid with and we’ll cancel billing for you/)
  })
  it('with a valid login link, links Stripe’s portal login on /supporter, /refunds and Terms', () => {
    vi.stubEnv('VITE_STRIPE_PORTAL_LOGIN_URL', LOGIN)
    serve({ ...OPEN, salesOpen: false })
    renderPage(Supporter)
    expect(screen.getByTestId('supporter-stripe-portal-login').getAttribute('href')).toBe(LOGIN)
    expect(screen.getByTestId('supporter-lost-twitch').textContent).toMatch(/Moving Supporter to another Twitch account goes through us: privacy@streampulse\.stream\./)
    cleanup()
    renderPage(Refunds, '/refunds')
    expect(screen.getAllByRole('link', { name: 'Manage billing with your email' }).map(link => link.getAttribute('href'))).toEqual([LOGIN, LOGIN])
    cleanup()
    renderPage(Terms, '/terms')
    expect(screen.getByTestId('terms-stripe-portal-login').getAttribute('href')).toBe(LOGIN)
  })
  it('ignores an invalid login link', () => {
    vi.stubEnv('VITE_STRIPE_PORTAL_LOGIN_URL', 'https://evil.example/p/login/x')
    serve({ ...OPEN, salesOpen: false })
    renderPage(Supporter)
    expect(screen.queryByTestId('supporter-stripe-portal-login')).toBeNull()
  })
})
