import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BillingPage, { renewalLine } from '../src/routes/account/BillingPage'

// Backend #162 snapshot fields: renewal "auto" | "ends" | "none", renewsOn, endsOn.
const ON = '2026-11-01T17:00:00Z'
const shortDate = (value: string) => new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
const serve = (extra: Record<string, unknown>) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ schemaVersion: 1, status: 'active', checkoutEnabled: false, accessUntil: ON, supportPeriods: 1, ...extra }))))

afterEach(() => vi.unstubAllGlobals())

describe('renewalLine', () => {
  it('says when a cancelled membership ends, otherwise when it renews', () => {
    expect(renewalLine({ status: 'active', renewal: 'ends', endsOn: ON })).toBe(`Cancels on ${shortDate(ON)}`)
    expect(renewalLine({ status: 'active', renewal: 'auto', renewsOn: ON })).toBe(`Renews on ${shortDate(ON)}`)
  })

  it('shows nothing without a usable renewal fact', () => {
    expect(renewalLine({ status: 'active' })).toBeNull()
    expect(renewalLine({ status: 'active', renewal: 'none' })).toBeNull()
    expect(renewalLine({ status: 'active', renewal: 'ends' })).toBeNull()
    expect(renewalLine({ status: 'active', renewal: 'auto', renewsOn: 'soon' })).toBeNull()
    expect(renewalLine({ status: 'active', renewal: 'ends', renewsOn: ON })).toBeNull()
    expect(renewalLine(null)).toBeNull()
  })

  it.each(['grace', 'review', 'pending', 'expired', 'none'])('shows nothing for a %s membership', status => {
    expect(renewalLine({ status, renewal: 'auto', renewsOn: ON })).toBeNull()
    expect(renewalLine({ status, renewal: 'ends', endsOn: ON })).toBeNull()
  })
})

describe('billing renewal line', () => {
  it('shows "Cancels on" after a cancel at period end', async () => {
    serve({ renewal: 'ends', endsOn: ON })
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Supporter active' })).toBeTruthy()
    expect(screen.getByTestId('billing-renewal').textContent).toBe(`Cancels on ${shortDate(ON)}`)
    expect(screen.getByText('Access through')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeTruthy()
  })

  it('shows "Renews on" for a renewing membership', async () => {
    serve({ renewal: 'auto', renewsOn: ON })
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Supporter active' })).toBeTruthy()
    expect(screen.getByTestId('billing-renewal').textContent).toBe(`Renews on ${shortDate(ON)}`)
    expect(document.body.textContent).not.toMatch(/Cancels on/)
  })

  it('shows nothing new when the server sends no renewal fields', async () => {
    serve({})
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Supporter active' })).toBeTruthy()
    expect(screen.queryByTestId('billing-renewal')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Cancels on|Renews on/)
    expect(screen.getByText('Access through')).toBeTruthy()
  })
})
