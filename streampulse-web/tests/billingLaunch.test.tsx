import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BillingPage, { addOneMonthClamped, renewalOf } from '../src/routes/account/BillingPage'
import { resetSupporterOfferForTests } from '../src/lib/supporterOffer'

const twitch = vi.hoisted(() => ({ begin: vi.fn() }))
const sentry = vi.hoisted(() => ({ capture: vi.fn() }))
vi.mock('../src/lib/twitchSignIn', async importOriginal => ({ ...(await importOriginal<typeof import('../src/lib/twitchSignIn')>()), beginTwitchFlow: twitch.begin }))
vi.mock('../src/lib/sentry', async importOriginal => ({ ...(await importOriginal<typeof import('../src/lib/sentry')>()), captureAccountIssue: sentry.capture }))

const OPEN = { schemaVersion: 1, salesOpen: true, environment: 'live', price: { unitAmount: 499, currency: 'usd', interval: 'month' }, tax: { collection: 'automatic', behavior: 'exclusive' }, termsConsent: true }
const ATTEMPT = '12345678-1234-4234-8234-123456789abc'
const longDate = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })

/** Routes the offer read and the membership read separately, like the real API. */
function serve(snapshot: Record<string, unknown> | number, offer: unknown = OPEN, attempt: Record<string, unknown> = { state: 'open' }) {
  const fetch = vi.fn(async (path: string) => {
    if (String(path).includes('/v1/billing/offer')) return new Response(JSON.stringify(offer))
    if (String(path).includes('/v1/billing/checkout/')) return new Response(JSON.stringify(attempt))
    if (typeof snapshot === 'number') return new Response('{}', { status: snapshot })
    return new Response(JSON.stringify({ schemaVersion: 1, ...snapshot }))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

beforeEach(() => {
  resetSupporterOfferForTests(); sessionStorage.clear()
  vi.stubEnv('VITE_TWITCH_SIGNIN', 'public')
  twitch.begin.mockReset().mockResolvedValue(undefined)
  sentry.capture.mockReset()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('renewal facts (spec §3.5)', () => {
  it('derives auto, ends, none and an older server', () => {
    expect(renewalOf({ renewal: 'auto', renewsOn: '2026-11-10T00:00:00Z' })).toEqual({ kind: 'auto', date: longDate('2026-11-10T00:00:00Z') })
    expect(renewalOf({ renewal: 'ends', endsOn: '2026-11-10T00:00:00Z' })).toEqual({ kind: 'ends', date: longDate('2026-11-10T00:00:00Z') })
    expect(renewalOf({ renewal: 'none' })).toEqual({ kind: 'none', date: null })
    expect(renewalOf({})).toEqual({ kind: 'unknown', date: null })
  })
  it('clamps one month ahead to the end of a shorter month', () => {
    expect(addOneMonthClamped(new Date(2026, 0, 31))).toEqual(new Date(2026, 1, 28))
    expect(addOneMonthClamped(new Date(2028, 0, 31))).toEqual(new Date(2028, 1, 29))
    expect(addOneMonthClamped(new Date(2026, 11, 15))).toEqual(new Date(2027, 0, 15))
  })
  it('shows "Renews {date}" instead of "Access through" for a renewing membership', async () => {
    serve({ status: 'active', accessUntil: '2026-11-10T00:00:00Z', renewal: 'auto', renewsOn: '2026-11-10T00:00:00Z' })
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Supporter active' })).toBeTruthy()
    expect(screen.getByText('Renews')).toBeTruthy()
    expect(screen.getByText(longDate('2026-11-10T00:00:00Z'))).toBeTruthy()
    expect(screen.queryByText('Access through')).toBeNull()
  })
  it('shows "Supporter ends {date}" with Resume for a membership cancelled at period end', async () => {
    serve({ status: 'active', accessUntil: '2026-11-10T00:00:00Z', renewal: 'ends', endsOn: '2026-11-10T00:00:00Z' })
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: `Supporter ends ${longDate('2026-11-10T00:00:00Z')}` })).toBeTruthy()
    expect(screen.getByText(/You cancelled, so it won’t renew\. You keep Supporter until then, and your crest keeps its months\./)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resume' }).classList.contains('pulse-account-primary')).toBe(true)
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeTruthy()
    expect(screen.getByText('Resume opens Stripe, where you choose Renew.')).toBeTruthy()
  })
  it('keeps "Access through" for a server that does not send renewal state yet', async () => {
    serve({ status: 'active', accessUntil: '2026-11-10T00:00:00Z' })
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByText('Access through')).toBeTruthy()
  })
})

describe('the remembered intent and the review (spec §3.1-§3.2)', () => {
  it('signed out with ?intent=subscribe: Continue with Twitch keeps the intent', async () => {
    serve(401)
    render(<MemoryRouter initialEntries={['/account/billing?intent=subscribe']}><BillingPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Continue with Twitch to become a Supporter or see your membership.')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Continue with Twitch/ }))
    await waitFor(() => expect(twitch.begin).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'signin', returnTo: '/account/billing?intent=subscribe' })))
  })
  it('already a Supporter with the intent: Manage subscription, never a second checkout', async () => {
    serve({ status: 'active', renewal: 'auto', renewsOn: '2026-11-10T00:00:00Z' })
    render(<MemoryRouter initialEntries={['/account/billing?intent=subscribe']}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'You’re already a Supporter on this Twitch account' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Manage subscription' }).classList.contains('pulse-account-primary')).toBe(true)
    expect(screen.queryByRole('button', { name: /Continue to payment|checkout/i })).toBeNull()
  })
  it('shows who pays, and the tax line Checkout will use once the offer is open', async () => {
    serve({ status: 'none', checkoutEnabled: true, salesOpen: true, accountId: 'acct-0000-abc123' })
    render(<MemoryRouter initialEntries={['/account/billing?intent=subscribe']}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Become a Pulse Supporter' })).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('billing-review-rows').textContent).toContain('First chargeToday, plus sales tax or VAT where it applies.'))
    expect(screen.getByTestId('billing-review-identity').textContent).toMatch(/Signed in with Twitch/)
    expect(screen.getByTestId('billing-review-footnote').textContent).toMatch(/^You’ll accept the Supporter terms on Stripe\./)
    fireEvent.click(screen.getByRole('button', { name: 'Use a different Twitch account' }))
    await waitFor(() => expect(twitch.begin).toHaveBeenCalledWith({ purpose: 'signin', forceVerify: true, returnTo: '/account/billing?intent=subscribe' }))
  })
  it('sales open but this account cannot buy: says so, with no checkout button', async () => {
    serve({ status: 'none', checkoutEnabled: false, salesOpen: true })
    render(<MemoryRouter><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Checkout isn’t available for this account right now' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Contact support' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Continue to payment|checkout/i })).toBeNull()
  })
  it('closed: no review and no checkout button', async () => {
    serve({ status: 'none', checkoutEnabled: false, salesOpen: false }, { ...OPEN, salesOpen: false })
    render(<MemoryRouter initialEntries={['/account/billing?intent=subscribe']}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Supporter sign-ups are not open yet' })).toBeTruthy()
    expect(screen.queryByTestId('billing-review-rows')).toBeNull()
    expect(screen.queryByRole('button', { name: /Continue to payment|checkout/i })).toBeNull()
  })
})

describe('activation and the welcome (spec §3.4)', () => {
  const returnPath = `/account/billing/return?attempt=${ATTEMPT}`
  it('ticks "Stripe confirmed your payment" once the attempt is paid, before Supporter is on', async () => {
    serve({ status: 'none', checkoutEnabled: true }, OPEN, { state: 'pending' })
    render(<MemoryRouter initialEntries={[returnPath]}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Activating your membership' })).toBeTruthy()
    const steps = screen.getByTestId('billing-activation-steps').textContent ?? ''
    expect(steps).toMatch(/✓ Stripe confirmed your payment/)
    expect(steps).toMatch(/◌ Supporter turned on for this account \(waiting\)/)
  })
  it('reports a slow confirmation to Sentry once, with only the fixed code', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    serve({ status: 'none', checkoutEnabled: true }, OPEN, { state: 'open' })
    render(<MemoryRouter initialEntries={[returnPath]}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Activating your membership' })).toBeTruthy()
    for (let i = 0; i < 40 && !screen.queryByRole('heading', { name: 'Still activating your membership' }); i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })
    }
    expect(screen.getByRole('heading', { name: 'Still activating your membership' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Contact support' }).classList.contains('pulse-account-primary')).toBe(true)
    expect(sentry.capture.mock.calls.filter(([code]) => code === 'checkout_confirm_slow')).toHaveLength(1)
  })
  it('welcomes with the look, Open Twitch and Get the extension, and survives a reload', async () => {
    serve({ status: 'active', renewal: 'auto', renewsOn: '2026-11-10T00:00:00Z' }, OPEN, { state: 'active' })
    const first = render(<MemoryRouter initialEntries={[returnPath]}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'You’re a Supporter. Thank you.' })).toBeTruthy()
    expect(screen.getByText(/Here’s your look: title paint, a tenure crest that starts today, emote rain and your Supporter card/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Twitch' }).getAttribute('href')).toBe('https://www.twitch.tv/')
    expect(screen.getByText('Renews')).toBeTruthy()
    first.unmount()
    render(<MemoryRouter initialEntries={[returnPath]}><BillingPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'You’re a Supporter. Thank you.' })).toBeTruthy()
  })
})
