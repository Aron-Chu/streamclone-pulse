import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import offerConfig from '../../src/shared/supporter-offer.json'
import {
  SUPPORTER_OFFER_CACHE_KEY,
  evaluateOffer,
  fetchSupporterOffer,
  legalFact,
  offerPriceMatches,
  parseServerOffer,
  pendingLegalFields,
  refreshSupporterOffer,
  resetSupporterOfferForTests,
  supporterSeller,
  taxKeyFor,
  taxLines,
  validStatementDescriptor,
} from '../src/lib/supporterOffer'

const OPEN = { schemaVersion: 1, salesOpen: true, environment: 'live', price: { unitAmount: 499, currency: 'usd', interval: 'month' }, tax: { collection: 'automatic', behavior: 'exclusive' }, termsConsent: true, serverTime: '2026-10-10T18:00:00Z' }

beforeEach(() => { resetSupporterOfferForTests(); sessionStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('the server offer contract', () => {
  it('accepts only schemaVersion 1 with a boolean salesOpen', () => {
    expect(parseServerOffer(OPEN)).toMatchObject({ schemaVersion: 1, salesOpen: true, price: OPEN.price, tax: OPEN.tax, termsConsent: true })
    for (const value of [null, [], 'open', { ...OPEN, schemaVersion: 2 }, { ...OPEN, salesOpen: 'true' }, { salesOpen: true }]) {
      expect(parseServerOffer(value)).toBeNull()
    }
  })
  it('drops a malformed price or tax block instead of trusting it', () => {
    expect(parseServerOffer({ ...OPEN, price: { unitAmount: 4.99, currency: 'usd', interval: 'month' } })?.price).toBeUndefined()
    expect(parseServerOffer({ ...OPEN, price: { unitAmount: 0, currency: 'usd', interval: 'month' } })?.price).toBeUndefined()
    expect(parseServerOffer({ ...OPEN, tax: { collection: 'sometimes', behavior: 'exclusive' } })?.tax).toBeUndefined()
  })
})

describe('the client interlocks (fail closed)', () => {
  it('opens only when the server says open, the stage is public and the price matches this build', () => {
    const offer = parseServerOffer(OPEN)
    expect(evaluateOffer(offer, true)).toEqual({ state: 'open' })
    expect(evaluateOffer(parseServerOffer({ ...OPEN, salesOpen: false }), true)).toEqual({ state: 'closed' })
    expect(evaluateOffer(null, true)).toEqual({ state: 'closed' })
    expect(evaluateOffer(offer, false)).toEqual({ state: 'closed', reason: 'offer_stage_mismatch' })
    for (const price of [{ unitAmount: 599, currency: 'usd', interval: 'month' }, { unitAmount: 499, currency: 'eur', interval: 'month' }, { unitAmount: 499, currency: 'usd', interval: 'year' }]) {
      const mismatched = parseServerOffer({ ...OPEN, price })
      expect(offerPriceMatches(mismatched)).toBe(false)
      expect(evaluateOffer(mismatched, true)).toEqual({ state: 'closed', reason: 'offer_price_mismatch' })
    }
    expect(evaluateOffer(parseServerOffer({ ...OPEN, price: undefined }), true)).toEqual({ state: 'closed', reason: 'offer_price_mismatch' })
  })
})

describe('the tax line follows what Checkout does', () => {
  const open = (tax: unknown) => parseServerOffer({ ...OPEN, tax })
  it.each([
    [{ collection: 'automatic', behavior: 'exclusive' }, 'exclusive'],
    [{ collection: 'automatic', behavior: 'inclusive' }, 'inclusive'],
    [{ collection: 'automatic', behavior: 'unspecified' }, 'fallback'],
    [{ collection: 'none', behavior: 'exclusive' }, 'none'],
  ] as const)('%j gives %s', (tax, key) => {
    expect(taxKeyFor(open(tax), 'open')).toBe(key)
  })
  it('uses the always-true fallback while closed or unknown, and while the none sentence is unapproved', () => {
    expect(taxKeyFor(open(OPEN.tax), 'closed')).toBe('fallback')
    expect(taxKeyFor(open(OPEN.tax), 'unknown')).toBe('fallback')
    expect(taxLines(open({ collection: 'none', behavior: 'exclusive' }), 'open')).toEqual({ long: offerConfig.tax.fallback, short: offerConfig.tax.short.fallback })
    expect(taxLines(open(OPEN.tax), 'open')).toEqual({ long: offerConfig.tax.exclusive, short: offerConfig.tax.short.exclusive })
  })
})

describe('legal facts from one config', () => {
  it('renders Pending for every null fact', () => {
    expect(legalFact(null)).toBe('Pending — not yet stated.')
    expect(legalFact('  ')).toBe('Pending — not yet stated.')
    expect(legalFact('Example LLC')).toBe('Example LLC')
    expect(supporterSeller()).toEqual({ name: 'Pending — not yet stated.', address: 'Pending — not yet stated.', governingLaw: 'Pending — not yet stated.', consumerRights: 'Pending — not yet stated.' })
    expect(pendingLegalFields()).toEqual(['seller.name', 'seller.address', 'governingLaw', 'consumerRights', 'billingContact.confirmed', 'statementDescriptor', 'stripeReceipts'])
  })
  it('accepts only a statement descriptor Stripe would accept', () => {
    expect(validStatementDescriptor('STREAMPULSE')).toBe(true)
    for (const value of ['SP', 'A'.repeat(23), 'PULSE*SUPPORT', "PULSE'S", '12345', null]) expect(validStatementDescriptor(value)).toBe(false)
  })
  it('keeps the config schema the extension copy shares', () => {
    const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../src/shared/supporter-offer.json'), 'utf8'))
    expect(Object.keys(raw).sort()).toEqual(['billingContact', 'consumerRights', 'governingLaw', 'pending', 'price', 'schemaVersion', 'seller', 'statementDescriptor', 'stripeReceipts', 'tax'])
    expect(raw.schemaVersion).toBe(1)
    expect(raw.price).toMatchObject({ unitAmount: 499, currency: 'usd', interval: 'month' })
    expect(raw.tax.fallback).toBeTruthy()
    expect(raw.tax.short.fallback).toBeTruthy()
  })
})

describe('reading GET /v1/billing/offer', () => {
  it('sends no credentials and no beta key', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(OPEN)))
    vi.stubGlobal('fetch', fetch)
    expect(await fetchSupporterOffer()).toMatchObject({ salesOpen: true })
    const [url, init] = fetch.mock.calls[0]!
    expect(String(url)).toMatch(/\/v1\/billing\/offer$/)
    expect(init.credentials).toBe('omit')
    expect(new Headers(init.headers).has('X-Streamclone-Beta-Key')).toBe(false)
    expect(new Headers(init.headers).has('Authorization')).toBe(false)
  })
  it('reads 404 (billing not mounted) as no offer, and throws for a 5xx or a malformed body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))
    expect(await fetchSupporterOffer()).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ salesOpen: true }))))
    await expect(fetchSupporterOffer()).rejects.toBeTruthy()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503, headers: { 'Retry-After': '1' } })))
    await expect(fetchSupporterOffer()).rejects.toBeTruthy()
  })
  it('caches one answer for 60 seconds in sessionStorage and shares a concurrent read', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(OPEN)))
    vi.stubGlobal('fetch', fetch)
    await Promise.all([refreshSupporterOffer(), refreshSupporterOffer()])
    expect(fetch).toHaveBeenCalledTimes(1)
    await refreshSupporterOffer()
    expect(fetch).toHaveBeenCalledTimes(1)
    const cached = JSON.parse(sessionStorage.getItem(SUPPORTER_OFFER_CACHE_KEY)!)
    expect(cached.offer.salesOpen).toBe(true)
    // An expired entry is read again.
    sessionStorage.setItem(SUPPORTER_OFFER_CACHE_KEY, JSON.stringify({ offer: cached.offer, fetchedAt: Date.now() - 61_000 }))
    resetSupporterOfferForTests()
    fetch.mockResolvedValue(new Response(JSON.stringify({ ...OPEN, salesOpen: false })))
    await refreshSupporterOffer()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('does not cache an unreadable answer, so the next read retries', async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response('{}', { status: 400 }))
    vi.stubGlobal('fetch', fetch)
    await refreshSupporterOffer()
    await refreshSupporterOffer()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
