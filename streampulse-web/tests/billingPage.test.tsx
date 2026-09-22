import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BillingPage, { stripeDestination } from '../src/routes/account/BillingPage'
import Supporter from '../src/routes/public/Supporter'
import { accountBillingSignInHref } from '../src/lib/accountBillingReturn'

const returnPath = '/account/billing/return?attempt=12345678-1234-4234-8234-123456789abc'
const membership = (status: string, checkoutEnabled = false) => new Response(JSON.stringify({ schemaVersion: 1, status, checkoutEnabled }))

function renderNavigableBilling(path: string) {
  render(<MemoryRouter initialEntries={[path]}>
    <Link to="/account/billing">Current billing</Link>
    <Link to={returnPath}>Checkout return</Link>
    <BillingPage />
  </MemoryRouter>)
}

afterEach(() => vi.unstubAllGlobals())

describe('public Supporter handoff', () => {
  it('states that paid sign-ups are closed and links existing members to account billing', () => {
    render(<MemoryRouter><Supporter /></MemoryRouter>)
    const link = screen.getByRole('link', { name: 'Open account billing' })
    expect(link.getAttribute('href')).toBe('/account/billing')
    expect(screen.getByText(/Paid sign-ups are not open yet/)).toBeTruthy()
    expect(screen.getByText(/including any tax it calculates/)).toBeTruthy()
  })
})

describe('billing lifecycle view', () => {
  it('never trusts a success query parameter as payment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(membership('pending')))
    render(<MemoryRouter initialEntries={['/account/billing/return?success=true']}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Payment pending' })).toBeTruthy()
    expect(screen.queryByText('Supporter active')).toBeNull()
    expect(screen.queryByText('Continue to Stripe checkout')).toBeNull()
  })
  it('shows unavailable services without purchase controls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByText(/Billing status is unavailable/)).toBeTruthy()
    expect(screen.queryByText('Continue to Stripe checkout')).toBeNull()
  })
  it.each(['attempt', 'membership'])('does not deny a purchase when the checkout return %s lookup fails', async stage => {
    const fetch = vi.fn()
    if (stage === 'membership') fetch.mockResolvedValueOnce(new Response(JSON.stringify({ state: 'active' })))
    fetch.mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'active' })))
      .mockResolvedValueOnce(membership('active'))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter initialEntries={[returnPath]}><BillingPage /></MemoryRouter>)
    expect(await screen.findByText('Billing status is unavailable right now. Refresh status before trying another checkout.')).toBeTruthy()
    expect(screen.queryByText(/No purchase has been started/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue to Stripe checkout' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Manage membership' })).toBeNull()
    expect(screen.queryByText(/Checkout status:/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
    expect(await screen.findByRole('heading', { name: 'Supporter active' })).toBeTruthy()
    expect(screen.queryByText(/Billing status is unavailable/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Manage membership' }).hasAttribute('disabled')).toBe(false)
    expect(fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true)
  })
  it('posts checkout with session protection and handles duplicate membership', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(membership('none'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'subscription_exists' }), { status: 409 }))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByText(/New Supporter sign-ups are not open yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Continue to Stripe checkout' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Manage membership' })).toBeNull()
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('shows checkout only when the server explicitly enables it', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(membership('none', true))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'checkout_disabled' }), { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to Stripe checkout' }))
    await waitFor(() => expect(screen.getByText(/New purchases are paused/)).toBeTruthy())
    expect(fetch.mock.calls[1][0]).toBe('/v1/billing/checkout')
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', credentials: 'same-origin', redirect: 'error', body: '{}' })
  })
  it('accepts only Stripe-hosted destinations', () => {
    expect(stripeDestination('https://checkout.stripe.com/c/pay/test', 'checkout')).toBeTruthy()
    for (const url of ['javascript:alert(1)', 'https://checkout.stripe.com.evil.test/', 'https://user@checkout.stripe.com/', 'http://checkout.stripe.com/']) expect(stripeDestination(url, 'checkout')).toBeNull()
    expect(stripeDestination('https://billing.stripe.com/p/session/test', 'portal')).toBeTruthy()
  })
  it.each(['/account/billing', returnPath, `${returnPath}&cancelled=1`])('preserves %s when membership requires sign-in', async path => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    render(<MemoryRouter initialEntries={[path]}><BillingPage /></MemoryRouter>)
    expect((await screen.findByRole('link', { name: 'Sign in to Pulse' })).getAttribute('href')).toBe(accountBillingSignInHref(path))
    expect(screen.queryByRole('button', { name: 'Continue to Stripe checkout' })).toBeNull()
  })

  it('describes a cancelled Stripe return without implying payment success', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'pending' })))
      .mockResolvedValueOnce(membership('none', true))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter initialEntries={[`${returnPath}&cancelled=1`]}><BillingPage /></MemoryRouter>)
    expect(await screen.findByText(/left Stripe checkout before it confirmed a payment/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'No subscription' })).toBeTruthy()
    expect(screen.queryByText(/Payment confirmation is pending/)).toBeNull()
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      '/v1/billing/checkout/12345678-1234-4234-8234-123456789abc', '/v1/billing/supporter',
    ])
  })
  it.each([
    ['Continue to Stripe checkout', 'none', true],
    ['Manage membership', 'active', false],
  ] as const)('offers return-aware sign-in when %s loses its session', async (name, status, checkoutEnabled) => {
    const fetch = vi.fn().mockResolvedValueOnce(membership(status, checkoutEnabled))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter initialEntries={['/account/billing']}><BillingPage /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name }))
    expect((await screen.findByRole('link', { name: 'Sign in to Pulse' })).getAttribute('href')).toBe(accountBillingSignInHref('/account/billing'))
    expect(screen.queryByRole('button', { name: 'Continue to Stripe checkout' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Manage membership' })).toBeNull()
  })

  it.each(['expired', 'missing'])('keeps current membership manageable for an %s checkout attempt', async state => {
    const fetch = vi.fn().mockResolvedValueOnce(state === 'missing'
      ? new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })
      : new Response(JSON.stringify({ state })))
      .mockResolvedValueOnce(membership('active'))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter initialEntries={[returnPath]}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Supporter active' })).toBeTruthy()
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      '/v1/billing/checkout/12345678-1234-4234-8234-123456789abc', '/v1/billing/supporter',
    ])
    expect(screen.getByRole('button', { name: 'Manage membership' }).hasAttribute('disabled')).toBe(false)
    expect(screen.queryByRole('button', { name: 'Continue to Stripe checkout' })).toBeNull()
    if (state === 'missing') {
      expect(screen.getByText(/This checkout link is no longer available/)).toBeTruthy()
      expect(screen.queryByText(/Checkout status:/)).toBeNull()
    }
  })

  it.each([
    '/account/billing/return?attempt=invalid',
    '/account/billing/return?attempt=------------------------------------',
    '/account/billing/return?attempt=',
    `${returnPath}&attempt=12345678-1234-4234-8234-123456789abc`,
    `${returnPath}&success=true`,
  ])('loads authenticated membership without resolving a malformed checkout return: %s', async path => {
    const fetch = vi.fn().mockResolvedValue(membership('active'))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter initialEntries={[path]}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Supporter active' })).toBeTruthy()
    expect(screen.getByText(/This checkout link is invalid/)).toBeTruthy()
    expect(fetch.mock.calls.map(call => call[0])).toEqual(['/v1/billing/supporter'])
    expect(screen.getByRole('button', { name: 'Manage membership' }).hasAttribute('disabled')).toBe(false)
    expect(screen.queryByRole('button', { name: 'Continue to Stripe checkout' })).toBeNull()
    expect(screen.queryByText(/Checkout status:/)).toBeNull()
  })

  it.each([401, 503])('keeps malformed checkout returns fail-closed when membership returns HTTP %s', async status => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status }))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter initialEntries={['/account/billing/return?attempt=invalid']}><BillingPage /></MemoryRouter>)
    expect(await screen.findByText(status === 401 ? 'Sign in to view your membership.' : /Billing status is unavailable/)).toBeTruthy()
    expect(fetch.mock.calls.map(call => call[0])).toEqual(['/v1/billing/supporter'])
    expect(screen.queryByRole('button', { name: 'Manage membership' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue to Stripe checkout' })).toBeNull()
    if (status === 401) {
      expect(screen.getByRole('link', { name: 'Sign in to Pulse' }).getAttribute('href')).toBe(accountBillingSignInHref('/account/billing'))
    }
  })

  it('clears checkout state when same-component navigation removes its attempt', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'pending' })))
      .mockResolvedValueOnce(membership('pending'))
      .mockResolvedValueOnce(membership('active'))
    vi.stubGlobal('fetch', fetch)
    renderNavigableBilling(returnPath)
    expect(await screen.findByText(/Payment confirmation is pending/)).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Current billing' }))
    expect(await screen.findByRole('heading', { name: 'Supporter active' })).toBeTruthy()
    expect(screen.queryByText(/Payment confirmation is pending/)).toBeNull()
  })

  it.each([200, 401])('ignores an old attempt response with HTTP %s after navigation', async status => {
    let resolve!: (response: Response) => void
    const oldAttempt = new Promise<Response>(done => { resolve = done })
    const fetch = vi.fn().mockReturnValueOnce(oldAttempt).mockImplementation(() => Promise.resolve(membership('active')))
    vi.stubGlobal('fetch', fetch)
    renderNavigableBilling(returnPath)
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('link', { name: 'Current billing' }))
    expect(await screen.findByRole('heading', { name: 'Supporter active' })).toBeTruthy()
    await act(async () => { resolve(new Response(JSON.stringify({ state: 'pending' }), { status })) })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/Checkout status:/)).toBeNull()
    expect(screen.queryByRole('link', { name: 'Sign in to Pulse' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Supporter active' })).toBeTruthy()
  })

  it('ignores an old membership response after navigation', async () => {
    let resolve!: (response: Response) => void
    const oldMembership = new Promise<Response>(done => { resolve = done })
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'pending' })))
      .mockReturnValueOnce(oldMembership)
      .mockResolvedValueOnce(membership('active'))
    vi.stubGlobal('fetch', fetch)
    renderNavigableBilling(returnPath)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('link', { name: 'Current billing' }))
    expect(await screen.findByRole('heading', { name: 'Supporter active' })).toBeTruthy()
    await act(async () => { resolve(membership('none')) })
    expect(screen.getByRole('heading', { name: 'Supporter active' })).toBeTruthy()
    expect(screen.queryByText(/Checkout status:/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue to Stripe checkout' })).toBeNull()
  })

  it('ignores an old checkout failure after navigating to another billing route', async () => {
    let resolve!: (response: Response) => void
    const oldCheckout = new Promise<Response>(done => { resolve = done })
    const fetch = vi.fn()
      .mockResolvedValueOnce(membership('none', true))
      .mockReturnValueOnce(oldCheckout)
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'active' })))
      .mockResolvedValueOnce(membership('active'))
    vi.stubGlobal('fetch', fetch)
    renderNavigableBilling('/account/billing')
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to Stripe checkout' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('link', { name: 'Checkout return' }))
    expect(await screen.findByRole('heading', { name: 'Supporter active' })).toBeTruthy()
    await act(async () => { resolve(new Response('{}', { status: 401 })) })
    expect(screen.getByRole('heading', { name: 'Supporter active' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Sign in to Pulse' })).toBeNull()
    expect(screen.queryByText(/Sign in again/)).toBeNull()
  })
})
