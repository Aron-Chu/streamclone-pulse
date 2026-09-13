import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BillingPage, { stripeDestination } from '../src/routes/account/BillingPage'

afterEach(() => vi.unstubAllGlobals())
describe('billing lifecycle view', () => {
  it('never trusts a success query parameter as payment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ schemaVersion: 1, status: 'pending' }))))
    render(<MemoryRouter initialEntries={['/account/billing/return?success=true']}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Payment pending' })).toBeTruthy()
    expect(screen.queryByText('Supporter active')).toBeNull()
    expect(screen.queryByText('Continue to Stripe checkout')).toBeNull()
  })
  it('shows unavailable services without purchase controls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByText(/Billing is unavailable/)).toBeTruthy()
    expect(screen.queryByText('Continue to Stripe checkout')).toBeNull()
  })
  it('posts checkout with session protection and handles duplicate membership', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: 1, status: 'none' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'subscription_exists' }), { status: 409 }))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    fireEvent.click(await screen.findByText('Continue to Stripe checkout'))
    await waitFor(() => expect(screen.getByText(/already have a subscription/)).toBeTruthy())
    expect(fetch.mock.calls[1][0]).toBe('/v1/billing/checkout')
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', credentials: 'same-origin', redirect: 'error', body: '{}' })
  })
  it('accepts only Stripe-hosted destinations', () => {
    expect(stripeDestination('https://checkout.stripe.com/c/pay/test', 'checkout')).toBeTruthy()
    for (const url of ['javascript:alert(1)', 'https://checkout.stripe.com.evil.test/', 'https://user@checkout.stripe.com/', 'http://checkout.stripe.com/']) expect(stripeDestination(url, 'checkout')).toBeNull()
    expect(stripeDestination('https://billing.stripe.com/p/session/test', 'portal')).toBeTruthy()
  })
})
