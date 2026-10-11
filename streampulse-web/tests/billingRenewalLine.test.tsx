import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BillingPage from '../src/routes/account/BillingPage'
import { resetSupporterOfferForTests } from '../src/lib/supporterOffer'

// Backend #162 snapshot fields: renewal "auto" | "ends" | "none", renewsOn, endsOn.
// #78 adds one "Cancels on" / "Renews on" line; the launch page already shows
// the same facts (spec §3.5), so here that line must never appear on top.
const ON = '2026-11-01T17:00:00Z'
const longDate = (value: string) => new Date(value).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
const serve = (extra: Record<string, unknown>) => vi.stubGlobal('fetch', vi.fn(async (path: string) => String(path).includes('/v1/billing/offer')
  ? new Response('{}', { status: 503 })
  : new Response(JSON.stringify({ schemaVersion: 1, status: 'active', checkoutEnabled: false, accessUntil: ON, supportPeriods: 1, ...extra }))))

afterEach(() => { vi.unstubAllGlobals(); resetSupporterOfferForTests() })

describe('billing renewal on the launch page', () => {
  it('a cancel at period end is the "Supporter ends" view, with no extra line', async () => {
    serve({ renewal: 'ends', endsOn: ON })
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: `Supporter ends ${longDate(ON)}` })).toBeTruthy()
    expect(screen.queryByTestId('billing-renewal')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Cancels on/)
  })

  it('a renewing membership shows the Renews fact, with no extra line', async () => {
    serve({ renewal: 'auto', renewsOn: ON })
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Supporter active' })).toBeTruthy()
    expect(screen.getByText('Renews')).toBeTruthy()
    expect(screen.queryByTestId('billing-renewal')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Renews on/)
  })

  it('an older server without the fields keeps Access through and nothing new', async () => {
    serve({})
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Supporter active' })).toBeTruthy()
    expect(screen.getByText('Access through')).toBeTruthy()
    expect(screen.queryByTestId('billing-renewal')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Cancels on|Renews on/)
  })
})
