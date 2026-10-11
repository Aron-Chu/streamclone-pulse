import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { resolveStripePortalLoginUrl } from '../scripts/extension-target.mjs'
import {
  OFFER_CACHE_TTL_MS,
  OFFER_SETTINGS_REFRESH_MS,
  OFFER_UNKNOWN_CACHE_MS,
  SupporterOfferCache,
  checkoutAllowedByOffer,
  fetchSupporterOffer,
  type CachedSupporterOffer,
} from '../src/background/supporterOffer.ts'
import { MESSAGE_SENDER_SCOPE } from '../src/background/pulseBroadcastTargets.ts'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'
import OFFER_CONFIG from '../src/shared/supporter-offer.json'
import {
  STRIPE_PORTAL_LOGIN_URL,
  addOneMonthClamped,
  parseStripePortalLoginUrl,
  parseSupporterOffer,
  supporterOfferFromReply,
  supporterTaxLine,
  type SupporterOffer,
} from '../src/shared/supporterOffer.ts'

const OPEN_BODY = {
  schemaVersion: 1,
  salesOpen: true,
  environment: 'live',
  price: { unitAmount: 499, currency: 'usd', interval: 'month' },
  tax: { collection: 'automatic', behavior: 'exclusive' },
  termsConsent: true,
  serverTime: '2026-10-10T18:00:00Z',
}
const LIVE = ['live'] as const
const BOTH = ['live', 'sandbox'] as const

describe('the public sales switch (GET /v1/billing/offer)', () => {
  it('is open only for a literal salesOpen true, schema 1, an honoured environment and the compiled price', () => {
    expect(parseSupporterOffer(200, OPEN_BODY, LIVE)).toEqual({
      state: 'open',
      price: { unitAmount: 499, currency: 'usd', interval: 'month' },
      tax: { collection: 'automatic', behavior: 'exclusive' },
      termsConsent: true,
    })
    const closed: Array<[string, Record<string, unknown>]> = [
      ['sales closed', { salesOpen: false }],
      ['salesOpen as a string', { salesOpen: 'true' }],
      ['salesOpen missing', { salesOpen: undefined }],
      ['an unknown schema', { schemaVersion: 2 }],
      ['no schema', { schemaVersion: undefined }],
      ['an unknown environment', { environment: 'test' }],
      ['no price yet', { price: undefined }],
      ['a different amount', { price: { unitAmount: 599, currency: 'usd', interval: 'month' } }],
      ['another currency', { price: { unitAmount: 499, currency: 'eur', interval: 'month' } }],
      ['a yearly price', { price: { unitAmount: 499, currency: 'usd', interval: 'year' } }],
    ]
    for (const [label, change] of closed) {
      expect(parseSupporterOffer(200, { ...OPEN_BODY, ...change }, LIVE), label).toEqual({ state: 'closed' })
    }
  })

  it('never opens sales from a sandbox server in a build that honours live only', () => {
    expect(parseSupporterOffer(200, { ...OPEN_BODY, environment: 'sandbox' }, LIVE)).toEqual({ state: 'closed' })
    expect(parseSupporterOffer(200, { ...OPEN_BODY, environment: 'sandbox' }, BOTH).state).toBe('open')
  })

  it('reads an unmounted billing route as closed and any other failure as unknown', () => {
    expect(parseSupporterOffer(404, { error: 'not_found' }, LIVE)).toEqual({ state: 'closed' })
    for (const status of [0, 401, 403, 429, 500, 502, 503]) expect(parseSupporterOffer(status, OPEN_BODY, LIVE)).toEqual({ state: 'unknown' })
    expect(parseSupporterOffer(200, null, LIVE)).toEqual({ state: 'closed' })
    expect(parseSupporterOffer(200, [OPEN_BODY], LIVE)).toEqual({ state: 'closed' })
  })

  it('drops a tax block it does not understand rather than guessing a sentence', () => {
    expect(parseSupporterOffer(200, { ...OPEN_BODY, tax: { collection: 'maybe', behavior: 'exclusive' } }, LIVE)).not.toHaveProperty('tax')
    expect(parseSupporterOffer(200, { ...OPEN_BODY, tax: undefined }, LIVE)).not.toHaveProperty('tax')
    expect(parseSupporterOffer(200, { ...OPEN_BODY, termsConsent: 'yes' }, LIVE)).toMatchObject({ state: 'open', termsConsent: false })
  })

  it('treats a worker reply as open only when it is well formed and states the compiled price', () => {
    const open = parseSupporterOffer(200, OPEN_BODY, LIVE)
    expect(supporterOfferFromReply({ type: 'SUPPORTER_OFFER', offer: open })).toEqual(open)
    expect(supporterOfferFromReply({ type: 'SUPPORTER_OFFER', offer: { state: 'closed' } })).toEqual({ state: 'closed' })
    for (const reply of [undefined, null, { error: 'unauthorized_sender' }, { type: 'SUPPORTER_ENTITLEMENT' }, { type: 'SUPPORTER_OFFER' },
      { type: 'SUPPORTER_OFFER', offer: { state: 'open' } },
      { type: 'SUPPORTER_OFFER', offer: { state: 'open', price: { unitAmount: 1, currency: 'usd', interval: 'month' } } },
      { type: 'SUPPORTER_OFFER', offer: { state: 'unknown' } }]) {
      expect(supporterOfferFromReply(reply)).toEqual({ state: 'unknown' })
    }
  })
})

describe('tax line, chosen from what Checkout does (spec §7)', () => {
  const open = (tax?: unknown): SupporterOffer => parseSupporterOffer(200, { ...OPEN_BODY, tax }, LIVE)
  it('says tax is added, included, or shown by Stripe, and never guesses', () => {
    expect(supporterTaxLine(open({ collection: 'automatic', behavior: 'exclusive' }))).toBe(OFFER_CONFIG.tax.exclusive)
    expect(supporterTaxLine(open({ collection: 'automatic', behavior: 'inclusive' }))).toBe(OFFER_CONFIG.tax.inclusive)
    expect(supporterTaxLine(open({ collection: 'automatic', behavior: 'unspecified' }))).toBe(OFFER_CONFIG.tax.fallback)
    // No owner-approved "none" sentence yet: the fallback, which is true in every mode.
    expect(OFFER_CONFIG.tax.none).toBeNull()
    expect(supporterTaxLine(open({ collection: 'none', behavior: 'exclusive' }))).toBe(OFFER_CONFIG.tax.fallback)
    expect(supporterTaxLine(open(undefined))).toBe(OFFER_CONFIG.tax.fallback)
    for (const offer of [{ state: 'closed' }, { state: 'unknown' }, null, undefined] as const) expect(supporterTaxLine(offer)).toBe(OFFER_CONFIG.tax.fallback)
    expect(supporterTaxLine(open({ collection: 'automatic', behavior: 'exclusive' }), 'short')).toBe('plus sales tax or VAT where it applies')
    expect(supporterTaxLine({ state: 'closed' }, 'short')).toBe('Stripe shows the total before you pay')
  })
})

describe('renewal date estimate', () => {
  it('adds one month and clamps the day to the target month', () => {
    const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0)
    const ymd = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    expect(ymd(addOneMonthClamped(at(2026, 10, 10)))).toEqual([2026, 11, 10])
    expect(ymd(addOneMonthClamped(at(2027, 1, 31)))).toEqual([2027, 2, 28])
    expect(ymd(addOneMonthClamped(at(2028, 1, 31)))).toEqual([2028, 2, 29])
    expect(ymd(addOneMonthClamped(at(2026, 8, 31)))).toEqual([2026, 9, 30])
    expect(ymd(addOneMonthClamped(at(2026, 12, 15)))).toEqual([2027, 1, 15])
    expect(ymd(addOneMonthClamped(at(2026, 12, 31)))).toEqual([2027, 1, 31])
  })
})

describe('Stripe portal login link (PULSE_EXTENSION_STRIPE_PORTAL_LOGIN_URL)', () => {
  // The website's fixture list (streampulse-web/tests/accountStripePortalLogin.test.tsx), kept in parity.
  const BAD = [
    undefined, null, 42, '', '   ',
    'http://billing.stripe.com/p/login/abc',
    'https://checkout.stripe.com/p/login/abc',
    'https://billing.stripe.com.example.com/p/login/abc',
    'https://evil.example/p/login/abc',
    'https://user:pw@billing.stripe.com/p/login/abc',
    'https://billing.stripe.com:444/p/login/abc',
    'https://billing.stripe.com/p/login/',
    'https://billing.stripe.com/p/session/abc',
    'https://billing.stripe.com/p/login/abc?prefilled_email=a%40b.c',
    'https://billing.stripe.com/p/login/abc#x',
    'javascript:alert(1)',
  ]
  it('accepts only an https billing.stripe.com /p/login/ address, at runtime and at build time alike', () => {
    expect(parseStripePortalLoginUrl('https://billing.stripe.com/p/login/test_abc123')).toBe('https://billing.stripe.com/p/login/test_abc123')
    expect(parseStripePortalLoginUrl('  https://billing.stripe.com/p/login/aBc_9  ')).toBe('https://billing.stripe.com/p/login/aBc_9')
    expect(resolveStripePortalLoginUrl('https://billing.stripe.com/p/login/test_abc123')).toBe('https://billing.stripe.com/p/login/test_abc123')
    for (const bad of BAD) {
      expect(parseStripePortalLoginUrl(bad), String(bad)).toBeNull()
      if (typeof bad === 'string' && bad.trim()) expect(() => resolveStripePortalLoginUrl(bad), bad).toThrow('billing.stripe.com/p/login')
    }
    // Unset is allowed: the "Lost Twitch access" row then says to email us.
    for (const empty of [undefined, '', '   ']) expect(resolveStripePortalLoginUrl(empty)).toBe('')
  })
  it('is unset in tests and in every build that does not pass it', () => {
    expect(STRIPE_PORTAL_LOGIN_URL).toBeNull()
  })
})

describe('the offer config (src/shared/supporter-offer.json)', () => {
  it('is byte-identical with the copy the website branch carries', () => {
    // The website and extension branches each add this file; both pin the same
    // digest, so the owner's legal and tax answers land once for both.
    const digest = createHash('sha256').update(readFileSync('src/shared/supporter-offer.json')).digest('hex')
    expect(digest).toBe('9e1d26a850e42bdc31b6b66abdc5e72c39ed3c6917e9c8b823db941f8f6681b2')
  })
  it('keeps unanswered legal facts visibly pending and Stripe-dependent promises off', () => {
    expect(OFFER_CONFIG.schemaVersion).toBe(1)
    expect(OFFER_CONFIG.price).toMatchObject({ unitAmount: 499, currency: 'usd', interval: 'month', short: 'US$4.99 / month' })
    expect(OFFER_CONFIG.pending).toBe('Pending — not yet stated.')
    expect(OFFER_CONFIG.seller).toEqual({ name: null, address: null })
    expect(OFFER_CONFIG.governingLaw).toBeNull()
    expect(OFFER_CONFIG.consumerRights).toBeNull()
    expect(OFFER_CONFIG.billingContact.confirmed).toBe(false)
    expect(OFFER_CONFIG.stripeReceipts).toBe(false)
    const descriptor: unknown = OFFER_CONFIG.statementDescriptor
    if (descriptor !== null) expect(descriptor).toMatch(/^[^<>\\'"*]{5,22}$/)
  })
})

describe('worker offer cache', () => {
  const OPEN = parseSupporterOffer(200, OPEN_BODY, LIVE)
  function harness(answers: Array<{ status: number; body: unknown } | Error>) {
    let clock = Date.parse('2026-10-10T18:00:00Z')
    let stored: unknown = null
    const fetch = vi.fn(async () => {
      const next = answers.length > 1 ? answers.shift()! : answers[0]
      if (next instanceof Error) throw next
      return next
    })
    const writes: CachedSupporterOffer[] = []
    const cache = new SupporterOfferCache({
      fetch,
      read: async () => stored,
      write: async value => { stored = value; writes.push(value) },
      environments: LIVE,
      now: () => clock,
    })
    return { cache, fetch, writes, advance: (ms: number) => { clock += ms }, store: (value: unknown) => { stored = value } }
  }

  it('reuses an answer for five minutes, and settings re-reads one older than a minute', async () => {
    const h = harness([{ status: 200, body: OPEN_BODY }])
    expect(await h.cache.get()).toEqual(OPEN)
    h.advance(OFFER_SETTINGS_REFRESH_MS - 1)
    expect(await h.cache.get(true)).toEqual(OPEN)
    expect(h.fetch).toHaveBeenCalledTimes(1)
    h.advance(2)
    expect(await h.cache.get()).toEqual(OPEN)
    expect(h.fetch).toHaveBeenCalledTimes(1)
    expect(await h.cache.get(true)).toEqual(OPEN)
    expect(h.fetch).toHaveBeenCalledTimes(2)
    h.advance(OFFER_CACHE_TTL_MS)
    await h.cache.get()
    expect(h.fetch).toHaveBeenCalledTimes(3)
  })

  it('shows a flip to closed within the cache window, without a client release', async () => {
    const h = harness([{ status: 200, body: OPEN_BODY }, { status: 200, body: { ...OPEN_BODY, salesOpen: false } }])
    expect((await h.cache.get()).state).toBe('open')
    h.advance(OFFER_SETTINGS_REFRESH_MS)
    expect(await h.cache.get(true)).toEqual({ state: 'closed' })
  })

  it('shares one request between callers', async () => {
    const h = harness([{ status: 200, body: OPEN_BODY }])
    const [a, b] = await Promise.all([h.cache.get(), h.cache.get(true)])
    expect(a).toEqual(OPEN)
    expect(b).toEqual(OPEN)
    expect(h.fetch).toHaveBeenCalledTimes(1)
  })

  it('reads a failure as unknown, retries it after 30 seconds, and keeps a known answer through a failed refresh', async () => {
    const h = harness([new Error('offline'), { status: 503, body: null }, { status: 200, body: OPEN_BODY }, new Error('offline')])
    expect(await h.cache.get()).toEqual({ state: 'unknown' })
    h.advance(OFFER_UNKNOWN_CACHE_MS - 1)
    expect(await h.cache.get()).toEqual({ state: 'unknown' })
    expect(h.fetch).toHaveBeenCalledTimes(1)
    h.advance(1)
    expect(await h.cache.get()).toEqual({ state: 'unknown' })
    h.advance(OFFER_UNKNOWN_CACHE_MS)
    expect(await h.cache.get()).toEqual(OPEN)
    h.advance(OFFER_SETTINGS_REFRESH_MS)
    // The refresh failed; the open answer is still inside its five minutes.
    expect(await h.cache.get(true)).toEqual(OPEN)
    expect(h.writes.at(-1)?.value).toEqual(OPEN)
  })

  it('never opens sales from a stored value by its shape alone', async () => {
    const h = harness([{ status: 200, body: { ...OPEN_BODY, salesOpen: false } }])
    h.store({ value: { state: 'open', price: { unitAmount: 1, currency: 'usd', interval: 'month' } }, fetchedAt: Date.parse('2026-10-10T18:00:00Z') })
    expect(await h.cache.get()).toEqual({ state: 'closed' })
    expect(h.fetch).toHaveBeenCalledTimes(1)
    h.store({ value: 'open', fetchedAt: Date.parse('2026-10-10T18:00:00Z') })
    expect(await h.cache.get()).toEqual({ state: 'closed' })
  })

  it('asks without credentials, cookies or a bearer, and refuses an oversized answer', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(OPEN_BODY), { status: 200 }))
    expect(await fetchSupporterOffer('https://api.streampulse.stream', fetchImpl as unknown as typeof fetch)).toEqual({ status: 200, body: OPEN_BODY })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.streampulse.stream/v1/billing/offer')
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store' })
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization|cookie/i)
    const big = vi.fn(async () => new Response('x'.repeat(5_000), { status: 200 }))
    await expect(fetchSupporterOffer('https://api.streampulse.stream', big as unknown as typeof fetch)).rejects.toThrow('offer_response_invalid')
  })
})

describe('SUPPORTER_OFFER message', () => {
  it('accepts only the exact shapes and is reachable from extension pages only', () => {
    expect(parseBackgroundRequest({ type: 'SUPPORTER_OFFER' })).toEqual({ type: 'SUPPORTER_OFFER' })
    expect(parseBackgroundRequest({ type: 'SUPPORTER_OFFER', refresh: true })).toEqual({ type: 'SUPPORTER_OFFER', refresh: true })
    expect(parseBackgroundRequest({ type: 'SUPPORTER_OFFER', refresh: false })).toEqual({ type: 'SUPPORTER_OFFER' })
    for (const bad of [{ type: 'SUPPORTER_OFFER', refresh: 'yes' }, { type: 'SUPPORTER_OFFER', url: 'https://evil.example' }, { type: 'SUPPORTER_OFFER', origin: 'x' }]) {
      expect(parseBackgroundRequest(bad)).toBeNull()
    }
    expect(MESSAGE_SENDER_SCOPE.SUPPORTER_OFFER).toBe('extension-page')
  })
})

describe('worker Checkout gate (SUPPORTER_BILLING checkout)', () => {
  const open = { state: 'open', price: { unitAmount: 499, currency: 'usd', interval: 'month' }, termsConsent: true } as const
  it('starts a new Checkout only while the switch reads open, re-reading anything older than a minute', async () => {
    const get = vi.fn(async (_refresh?: boolean) => open as never)
    expect(await checkoutAllowedByOffer('checkout', { get })).toBe(true)
    expect(get).toHaveBeenCalledWith(true)
    for (const offer of [{ state: 'closed' }, { state: 'unknown' }]) {
      expect(await checkoutAllowedByOffer('checkout', { get: async () => offer as never })).toBe(false)
    }
    expect(await checkoutAllowedByOffer('checkout', { get: async () => { throw new Error('gone') } })).toBe(false)
  })
  it('a server price other than the compiled one never opens Checkout from the account flag alone', async () => {
    let body: Record<string, unknown> = { schemaVersion: 1, salesOpen: true, environment: 'live', price: { unitAmount: 599, currency: 'usd', interval: 'month' }, termsConsent: true }
    const store: { value: unknown } = { value: null }
    const cache = new SupporterOfferCache({ fetch: async () => ({ status: 200, body }), read: async () => store.value, write: async value => { store.value = value }, environments: ['live'] })
    expect(await checkoutAllowedByOffer('checkout', cache)).toBe(false)
    body = { ...body, price: { unitAmount: OFFER_CONFIG.price.unitAmount, currency: OFFER_CONFIG.price.currency, interval: OFFER_CONFIG.price.interval } }
    store.value = null
    expect(await checkoutAllowedByOffer('checkout', cache)).toBe(true)
  })
  it.each(['status', 'check', 'resume', 'portal', 'portal_confirm'])('never blocks %s, so members can always manage or cancel', async action => {
    const get = vi.fn(async () => ({ state: 'closed' }) as never)
    expect(await checkoutAllowedByOffer(action, { get })).toBe(true)
    expect(get).not.toHaveBeenCalled()
  })
})

describe('content bundle', () => {
  it('carries none of the sales switch', () => {
    let bundle: string
    try { bundle = readFileSync('dist/content/twitch.js', 'utf8') } catch { return }
    for (const marker of ['SUPPORTER_OFFER', '/v1/billing/offer', 'Pending — not yet stated', 'billing.stripe.com/p/login']) {
      expect(bundle.includes(marker), `content bundle must not contain ${marker}`).toBe(false)
    }
  })
})
