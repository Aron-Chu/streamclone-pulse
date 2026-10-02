import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BillingPage, { CONFIRM_DELAYS_S, stripeDestination } from '../src/routes/account/BillingPage'
import Supporter from '../src/routes/public/Supporter'
import { accountBillingSignInHref } from '../src/lib/accountBillingReturn'

const returnPath = '/account/billing/return?attempt=12345678-1234-4234-8234-123456789abc'
const membership = (status: string, checkoutEnabled = false, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ schemaVersion: 1, status, checkoutEnabled, ...extra }))

function renderNavigableBilling(path: string) {
  render(<MemoryRouter initialEntries={[path]}>
    <Link to="/account/billing">Current billing</Link>
    <Link to={returnPath}>Checkout return</Link>
    <BillingPage />
  </MemoryRouter>)
}

afterEach(() => vi.unstubAllGlobals())

describe('public Supporter handoff', () => {
  it('states that paid sign-ups are closed, starts with the extension and preserves website account billing', () => {
    render(<MemoryRouter><Supporter /></MemoryRouter>)
    const link = screen.getByRole('link', { name: 'Use a StreamPulse website account' })
    expect(link.getAttribute('href')).toBe('/account/billing')
    expect(screen.getByTestId('supporter-availability').textContent).toMatch(/Paid sign-ups are not open yet/)
    expect(screen.getByText('US$4.99 per month, charged in US dollars')).toBeTruthy()
    expect(screen.getByText(/Handled as stated at checkout/)).toBeTruthy()
    const body = screen.getByTestId('supporter-offer').textContent ?? ''
    expect(body).not.toMatch(/including any tax it calculates/i)
    expect(body).not.toMatch(/existing members/i)
  })
})

describe('billing sandbox banner', () => {
  it('shows a test-mode banner only when the billing snapshot says sandbox', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(membership('none', true, { environment: 'sandbox' })))
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Become a Pulse Supporter' })).toBeTruthy()
    const banner = screen.getByTestId('billing-sandbox-banner')
    expect(banner.textContent).toContain('Sandbox — test mode, no real charge.')
    expect(banner.getAttribute('role')).toBe('note')
    expect(screen.getByRole('button', { name: 'Continue to Stripe checkout' })).toBeTruthy()
  })

  it.each([
    ['live', { environment: 'live' }],
    ['missing', {}],
    ['unrecognised', { environment: 'test' }],
  ] as const)('shows no banner when the environment is %s', async (_, extra) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(membership('active', false, extra)))
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Supporter active' })).toBeTruthy()
    expect(screen.queryByTestId('billing-sandbox-banner')).toBeNull()
  })

  it.each([401, 503])('shows no banner when billing returns HTTP %s', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ environment: 'sandbox' }), { status })))
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: status === 401 ? 'Sign in to see your membership' : 'Billing status is unavailable right now' })).toBeTruthy()
    expect(screen.queryByTestId('billing-sandbox-banner')).toBeNull()
  })
})

describe('billing membership copy', () => {
  it('states the USD price and leaves tax to checkout when checkout is enabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(membership('none', true)))
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByText(/US\$4\.99 per month, charged in US dollars/)).toBeTruthy()
    expect(screen.getByText('Handled as stated at checkout')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Taxes, if any/)
  })

  it.each(['none', 'expired'])('says sign-ups are closed for %s without implying existing members', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(membership(status)))
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByText(/New Supporter sign-ups are not open yet\./)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /checkout|Rejoin/i })).toBeNull()
    expect(document.body.textContent).not.toMatch(/existing members/i)
  })

  it('dates a failed renewal from the projection rather than a hardcoded grace period', async () => {
    // During grace the server's accessUntil is the grace end, already bounded
    // by any scheduled cancellation; the page must not add its own seven days.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(membership('grace', false, { accessUntil: '2026-10-19T12:00:00Z' })))
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Payment needs attention' })).toBeTruthy()
    const date = new Date('2026-10-19T12:00:00Z').toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
    expect(screen.getByText(new RegExp(`stays active until ${date} while Stripe retries`))).toBeTruthy()
    expect(screen.getByText('Access until')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/7-day|seven days/i)
    expect(screen.getByRole('button', { name: 'Update payment method' })).toBeTruthy()
  })

  it('says access is suspended while a membership is under review', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(membership('review')))
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Membership needs review' })).toBeTruthy()
    expect(screen.getByText(/access is paused while a payment is reviewed/)).toBeTruthy()
    expect(screen.queryByText('Access through')).toBeNull()
  })

  it('points cancellation at the Customer Portal and the end of the paid period', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(membership('active')))
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByText(/Stripe Customer Portal\. Cancellation takes effect at the end of the paid period/)).toBeTruthy()
  })
})

describe('billing lifecycle view', () => {
  it('never trusts a success query parameter as payment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(membership('pending')))
    render(<MemoryRouter initialEntries={['/account/billing/return?success=true']}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Confirming your payment' })).toBeTruthy()
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
    expect(await screen.findByRole('heading', { name: 'Billing status is unavailable right now' })).toBeTruthy()
    expect(screen.getByText(/your payment is safe and will appear here once confirmed\. Don’t start another checkout/)).toBeTruthy()
    expect(screen.queryByText(/No purchase has been started/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue to Stripe checkout' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Manage membership' })).toBeNull()
    expect(screen.queryByText(/Checkout status:/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByRole('heading', { name: 'You’re a Supporter' })).toBeTruthy()
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
    await waitFor(() => expect(screen.getByText(/Checkout is not open for this account right now/)).toBeTruthy())
    expect(document.body.textContent).not.toMatch(/existing members/i)
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

  it('describes a cancelled Stripe return without implying payment success, and resumes the same checkout', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'open' })))
      .mockResolvedValueOnce(membership('none', true))
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/resumed', attemptId: '12345678-1234-4234-8234-123456789abc' })))
    vi.stubGlobal('fetch', fetch)
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    render(<MemoryRouter initialEntries={[`${returnPath}&cancelled=1`]}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Checkout cancelled' })).toBeTruthy()
    expect(screen.getByText(/Nothing was charged/)).toBeTruthy()
    expect(screen.queryByText(/Confirming your payment/)).toBeNull()
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      '/v1/billing/checkout/12345678-1234-4234-8234-123456789abc', '/v1/billing/supporter',
    ])
    // The server resumes the open session for this attempt; no new purchase.
    fireEvent.click(screen.getByRole('button', { name: 'Return to checkout' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/resumed'))
    expect(fetch.mock.calls[2][0]).toBe('/v1/billing/checkout')
  })

  it('treats a cancelled return whose attempt is pending as uncertain, never as a reason to pay again', async () => {
    // The backend marks an attempt pending only when Stripe reported an
    // outcome it has not settled, so this may already be a payment.
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'pending' })))
      .mockResolvedValue(membership('none', true))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter initialEntries={[`${returnPath}&cancelled=1`]}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Confirming your payment' })).toBeTruthy()
    expect(screen.getByText(/you don’t need to pay again/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /checkout/i })).toBeNull()
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
    // Billing changes need a recent sign-in; reading does not, so the
    // membership stays on screen and only the change asks for sign-in again.
    expect((await screen.findByRole('link', { name: 'Sign in again' })).getAttribute('href')).toBe(accountBillingSignInHref('/account/billing'))
    expect(screen.getByRole('alert').textContent).toMatch(/sign-in from the last 10 minutes\. Nothing was charged/)
    expect(screen.getByRole('heading', { name: status === 'active' ? 'Supporter active' : 'Become a Pulse Supporter' })).toBeTruthy()
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
    expect(await screen.findByRole('heading', { name: status === 401 ? 'Sign in to see your membership' : 'Billing status is unavailable right now' })).toBeTruthy()
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
    expect(await screen.findByRole('heading', { name: 'Confirming your payment' })).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Current billing' }))
    expect(await screen.findByRole('heading', { name: 'Supporter active' })).toBeTruthy()
    expect(screen.queryByText(/Confirming your payment/)).toBeNull()
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
    expect(await screen.findByRole('heading', { name: 'You’re a Supporter' })).toBeTruthy()
    await act(async () => { resolve(new Response('{}', { status: 401 })) })
    expect(screen.getByRole('heading', { name: 'You’re a Supporter' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Sign in to Pulse' })).toBeNull()
    expect(screen.queryByText(/Sign in again/)).toBeNull()
  })
})

describe('automatic payment confirmation', () => {
  const attemptPath = '/v1/billing/checkout/12345678-1234-4234-8234-123456789abc'
  type Reply = () => Response
  function serve(attempt: Reply, supporter: Reply) {
    const fetch = vi.fn((path: string, _options?: RequestInit) => Promise.resolve(path === attemptPath ? attempt() : supporter()))
    vi.stubGlobal('fetch', fetch)
    return fetch
  }
  const reads = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.filter(([path]) => path === '/v1/billing/supporter').length
  afterEach(() => { vi.useRealTimers() })

  it('confirms a delayed webhook on a bounded backoff without blanking the card', async () => {
    vi.useFakeTimers()
    let settled = false
    const fetch = serve(
      () => new Response(JSON.stringify({ state: settled ? 'active' : 'open' })),
      () => membership(settled ? 'active' : 'none', true, { accessUntil: '2026-11-01T00:00:00Z', accountId: '11111111-1111-4111-8111-111111111111' }),
    )
    // Flush the read and its React effects before advancing an exact fake clock.
    // An auto-advancing clock under parallel load can schedule the first timer
    // after findByRole has already observed the confirming heading.
    await act(async () => { render(<MemoryRouter initialEntries={[returnPath]}><BillingPage /></MemoryRouter>) })
    expect(screen.getByRole('heading', { name: 'Confirming your payment' })).toBeTruthy()
    // Uncertain payment never offers another checkout.
    expect(screen.queryByRole('button', { name: /checkout/i })).toBeNull()
    const first = reads(fetch)
    await act(async () => { await vi.advanceTimersByTimeAsync(CONFIRM_DELAYS_S[0] * 1000 - 1) })
    expect(reads(fetch)).toBe(first)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(reads(fetch)).toBe(first + 1)
    // Still unsettled: the heading never disappears between reads.
    expect(screen.getByRole('heading', { name: 'Confirming your payment' })).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(CONFIRM_DELAYS_S[1] * 1000 - 1) })
    expect(reads(fetch)).toBe(first + 1)
    settled = true
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(screen.getByRole('heading', { name: 'You’re a Supporter' })).toBeTruthy()
    expect(screen.getByText('Pulse account')).toBeTruthy()
    expect(screen.getByText('··111111')).toBeTruthy()
    const done = fetch.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
    expect(fetch.mock.calls.length).toBe(done)
    expect(fetch.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true)
  })

  it('stops after its bound with truthful copy and a single recovery action', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetch = serve(() => new Response(JSON.stringify({ state: 'pending' })), () => membership('none', true))
    render(<MemoryRouter initialEntries={[returnPath]}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Confirming your payment' })).toBeTruthy()
    // Each step is scheduled only after the previous read settles, so advance
    // until the bound is reached rather than assuming exact timing.
    for (let i = 0; i < 40 && !screen.queryByRole('heading', { name: 'Still confirming your payment' }); i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })
    }
    expect(screen.getByRole('heading', { name: 'Still confirming your payment' })).toBeTruthy()
    expect(screen.getByText(/Don’t start another checkout/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Stripe checkout|Return to checkout/ })).toBeNull()
    const bounded = reads(fetch)
    expect(bounded).toBe(1 + CONFIRM_DELAYS_S.length)
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
    expect(reads(fetch)).toBe(bounded)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(reads(fetch)).toBe(bounded + 1))
  })

  it('honours Retry-After before its next read', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let limited = false
    const fetch = serve(
      () => new Response(JSON.stringify({ state: 'open' })),
      () => limited ? new Response(JSON.stringify({ error: 'try_later' }), { status: 429, headers: { 'Retry-After': '20' } }) : membership('none', true),
    )
    render(<MemoryRouter initialEntries={[returnPath]}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Confirming your payment' })).toBeTruthy()
    limited = true
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100) })
    const after429 = reads(fetch)
    // The second step would be 3 s; the server asked for 20 s.
    await act(async () => { await vi.advanceTimersByTimeAsync(18_500) })
    expect(reads(fetch)).toBe(after429)
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(reads(fetch)).toBe(after429 + 1)
    // The last state stays on screen, marked stale, not blanked.
    expect(screen.getByRole('heading', { name: 'Confirming your payment' })).toBeTruthy()
    expect(screen.getByTestId('billing-stale')).toBeTruthy()
  })

  it('pauses while hidden, stops on unmount, and never runs for a settled membership', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetch = serve(() => new Response(JSON.stringify({ state: 'open' })), () => membership('none', true))
    const view = render(<MemoryRouter initialEntries={[returnPath]}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Confirming your payment' })).toBeTruthy()
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    const before = reads(fetch)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(reads(fetch)).toBe(before)
    hidden.mockReturnValue(false)
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(reads(fetch)).toBeGreaterThan(before))
    hidden.mockRestore()
    view.unmount()
    const count = fetch.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
    expect(fetch.mock.calls.length).toBe(count)

    const settled = serve(() => new Response(JSON.stringify({ state: 'active' })), () => membership('active'))
    render(<MemoryRouter initialEntries={[returnPath]}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'You’re a Supporter' })).toBeTruthy()
    const once = settled.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(settled.mock.calls.length).toBe(once)
  })

  it('follows a checkout the server reports as pending instead of starting another', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const attempt = '12345678-1234-4234-8234-123456789abc'
    let settled = false
    const fetch = vi.fn((path: string, options?: RequestInit) => {
      if (path === '/v1/billing/checkout' && options?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ error: 'checkout_pending', attemptId: attempt }), { status: 409 }))
      if (path === attemptPath) return Promise.resolve(new Response(JSON.stringify({ state: settled ? 'active' : 'pending' })))
      return Promise.resolve(membership(settled ? 'active' : 'none', true))
    })
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter initialEntries={['/account/billing']}><BillingPage /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to Stripe checkout' }))
    expect(await screen.findByRole('heading', { name: 'Confirming your payment' })).toBeTruthy()
    expect(screen.getByText(/you don’t need to pay again/i)).toBeTruthy()
    expect(fetch.mock.calls.filter(([path, options]) => path === '/v1/billing/checkout' && options?.method === 'POST')).toHaveLength(1)
    settled = true
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100) })
    expect(await screen.findByRole('heading', { name: 'Supporter active' })).toBeTruthy()
  })

  it('continues the extension purchase journey after approval', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(membership('none', true)))
    render(<MemoryRouter initialEntries={[{ pathname: '/account/billing', state: { connected: true } }]}><BillingPage /></MemoryRouter>)
    expect(await screen.findByTestId('billing-connected-note')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Progress' }).querySelector('[aria-current="step"]')?.textContent).toMatch(/Supporter/)
    expect(screen.getByRole('button', { name: 'Continue to Stripe checkout' })).toBeTruthy()
  })
})

describe('no checkout while a payment is uncertain, at any moment', () => {
  afterEach(() => { vi.useRealTimers() })
  function watchForCheckout() {
    const seen: string[] = []
    const observer = new MutationObserver(() => {
      for (const button of document.querySelectorAll('button')) if (/Stripe checkout|Return to checkout|Rejoin/.test(button.textContent ?? '')) seen.push(button.textContent ?? '')
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return { seen, stop: () => observer.disconnect() }
  }

  it('never renders a checkout button on a Stripe return, not even for one frame', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const watcher = watchForCheckout()
    vi.stubGlobal('fetch', vi.fn((path: string) => Promise.resolve(path.includes('/checkout/') ? new Response(JSON.stringify({ state: 'open' })) : membership('none', true))))
    try {
      render(<MemoryRouter initialEntries={[returnPath]}><BillingPage /></MemoryRouter>)
      expect(await screen.findByRole('heading', { name: 'Confirming your payment' })).toBeTruthy()
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
      expect(watcher.seen).toEqual([])
    } finally { watcher.stop() }
  })

  it('re-reads instead of going quiet when the same pending checkout is reported twice', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const attempt = '12345678-1234-4234-8234-123456789abc'
    let attemptReads = 0
    let attemptFails = true
    const fetch = vi.fn((path: string, options?: RequestInit) => {
      if (path === '/v1/billing/checkout' && options?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ error: 'checkout_pending', attemptId: attempt }), { status: 409 }))
      if (path === `/v1/billing/checkout/${attempt}`) {
        attemptReads++
        return Promise.resolve(attemptFails ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ state: 'pending' })))
      }
      return Promise.resolve(membership('none', true))
    })
    vi.stubGlobal('fetch', fetch)
    const watcher = watchForCheckout()
    try {
      render(<MemoryRouter initialEntries={['/account/billing']}><BillingPage /></MemoryRouter>)
      const checkout = await screen.findByRole('button', { name: 'Continue to Stripe checkout' })
      watcher.seen.length = 0
      fireEvent.click(checkout)
      // The attempt read failed, so the page stays honest rather than offering checkout again.
      await waitFor(() => expect(attemptReads).toBeGreaterThan(0))
      expect(screen.queryByRole('button', { name: 'Continue to Stripe checkout' })).toBeNull()
      attemptFails = false
      await act(async () => { await vi.advanceTimersByTimeAsync(2_100) })
      expect(await screen.findByRole('heading', { name: 'Confirming your payment' })).toBeTruthy()
      expect(watcher.seen).toEqual([])
    } finally { watcher.stop() }
  })

  it('shows the approval note once and removes it from history', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(membership('none', true)))
    function Probe() { return <output data-testid="history-state">{JSON.stringify(useLocation().state)}</output> }
    render(<MemoryRouter initialEntries={[{ pathname: '/account/billing', state: { connected: true } }]}><BillingPage /><Probe /></MemoryRouter>)
    expect(await screen.findByTestId('billing-connected-note')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('history-state').textContent).toBe('null'))
    expect(screen.getByTestId('billing-connected-note')).toBeTruthy()
  })

  it('does not claim a payment exists for a cancelled return when signed out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    render(<MemoryRouter initialEntries={[`${returnPath}&cancelled=1`]}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Sign in to see your membership' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/If you just paid|payment is safe/)
  })
})
