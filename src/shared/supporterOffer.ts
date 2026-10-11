import OFFER from './supporter-offer.json'

/**
 * Whether paid Supporter sign-ups are open, and on what terms: the one sales
 * switch every surface reads (supporter launch spec §2).
 *
 * The server derives `salesOpen` from the flag that already gates Checkout and
 * serves it anonymously at GET /v1/billing/offer. The worker reads it (no
 * cookie, no bearer), caches it, and answers SUPPORTER_OFFER with the result of
 * {@link parseSupporterOffer}. Clients fail closed: only a literal
 * `salesOpen: true` in a schema this build understands, for a billing
 * environment this build honours, at the price this build was compiled with,
 * is `open`. Everything else is `closed`, and a read that failed is `unknown`,
 * which no surface treats as open.
 *
 * Legal and tax copy come from src/shared/supporter-offer.json, the same file
 * the website renders, so the owner's answers drop in without code edits.
 * Worker and options only: never import this from the content script.
 */

export type SupporterOfferEnvironment = 'live' | 'sandbox'
export type SupporterTaxCollection = 'automatic' | 'none'
export type SupporterTaxBehavior = 'exclusive' | 'inclusive' | 'unspecified'

export interface SupporterOfferTax {
  collection: SupporterTaxCollection
  behavior: SupporterTaxBehavior
}

export interface SupporterOfferPrice {
  unitAmount: number
  currency: string
  interval: string
}

/** The worker's answer to SUPPORTER_OFFER. Carries no per-user data. */
export type SupporterOffer =
  | { state: 'open'; price: SupporterOfferPrice; tax?: SupporterOfferTax; termsConsent: boolean }
  | { state: 'closed' }
  | { state: 'unknown' }

/** The shared offer config (src/shared/supporter-offer.json). */
export const SUPPORTER_OFFER_CONFIG = OFFER

/** "US$4.99 / month", from the shared config. */
export const OFFER_PRICE_SHORT: string = OFFER.price.short

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** True when the server's price is the one this build states (amount, currency, monthly). */
export function offerPriceMatches(price: unknown): price is SupporterOfferPrice {
  const p = object(price)
  return p.unitAmount === OFFER.price.unitAmount && p.currency === OFFER.price.currency && p.interval === OFFER.price.interval
}

function parseTax(value: unknown): SupporterOfferTax | undefined {
  const tax = object(value)
  const collection = tax.collection === 'automatic' || tax.collection === 'none' ? tax.collection : null
  const behavior = tax.behavior === 'exclusive' || tax.behavior === 'inclusive' || tax.behavior === 'unspecified' ? tax.behavior : null
  return collection && behavior ? { collection, behavior } : undefined
}

/**
 * Turn a GET /v1/billing/offer answer into an offer state.
 *
 *   - 404 (billing not mounted) and every well-formed "not open" answer: closed.
 *   - An answer this build does not understand (schema, environment it does not
 *     honour, a price other than the compiled one): closed. Store builds honour
 *     live only, so a sandbox server never opens sales there.
 *   - Any other status: unknown (a failed read is not a "no").
 */
export function parseSupporterOffer(
  status: number,
  body: unknown,
  environments: readonly SupporterOfferEnvironment[],
): SupporterOffer {
  if (status === 404) return { state: 'closed' }
  if (status !== 200) return { state: 'unknown' }
  const r = object(body)
  if (r.schemaVersion !== 1) return { state: 'closed' }
  if (r.salesOpen !== true) return { state: 'closed' }
  if (r.environment !== 'live' && r.environment !== 'sandbox') return { state: 'closed' }
  if (!environments.includes(r.environment)) return { state: 'closed' }
  if (!offerPriceMatches(r.price)) return { state: 'closed' }
  const price = object(r.price)
  const tax = parseTax(r.tax)
  return {
    state: 'open',
    price: { unitAmount: Number(price.unitAmount), currency: String(price.currency), interval: String(price.interval) },
    ...(tax ? { tax } : {}),
    termsConsent: r.termsConsent === true,
  }
}

/** Accept only a well-formed worker reply; anything else reads as unknown. */
export function supporterOfferFromReply(reply: unknown): SupporterOffer {
  const r = object(reply)
  if (r.type !== 'SUPPORTER_OFFER') return { state: 'unknown' }
  const offer = object(r.offer)
  if (offer.state === 'closed') return { state: 'closed' }
  if (offer.state !== 'open' || !offerPriceMatches(offer.price)) return { state: 'unknown' }
  const tax = parseTax(offer.tax)
  return { state: 'open', price: offer.price as SupporterOfferPrice, ...(tax ? { tax } : {}), termsConsent: offer.termsConsent === true }
}

/**
 * The tax sentence, chosen from what Checkout actually does (spec §7):
 * automatic tax on an exclusive price adds tax; on an inclusive price it is
 * included; no collection uses the owner-approved `none` sentence when one
 * exists. Everything else (closed, unknown, unspecified behaviour) uses the
 * fallback, which is true in every mode.
 */
export function supporterTaxLine(offer: SupporterOffer | null | undefined, form: 'long' | 'short' = 'long'): string {
  const strings = form === 'short' ? OFFER.tax.short : OFFER.tax
  const tax = offer?.state === 'open' ? offer.tax : undefined
  if (tax?.collection === 'automatic' && tax.behavior === 'exclusive') return strings.exclusive
  if (tax?.collection === 'automatic' && tax.behavior === 'inclusive') return strings.inclusive
  if (tax?.collection === 'none' && typeof strings.none === 'string' && strings.none) return strings.none
  return strings.fallback
}

/**
 * One month from `from`, in local time, with the day clamped to the target
 * month's length (Jan 31 gives Feb 28 or 29). A display estimate of Stripe's
 * billing anchor; Stripe's own date is shown once the subscription exists.
 */
export function addOneMonthClamped(from: Date): Date {
  const year = from.getFullYear()
  const month = from.getMonth() + 1
  const lastDay = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(from.getDate(), lastDay), from.getHours(), from.getMinutes())
}

/**
 * Stripe's no-code customer portal login (PULSE_EXTENSION_STRIPE_PORTAL_LOGIN_URL),
 * where Stripe emails a one-time code to the billing email. Only
 * https://billing.stripe.com/p/login/<id> is accepted (no credentials, port,
 * query or fragment); anything else, including unset, gives null and the
 * "Lost Twitch access" row says to email us instead. Same rule as the
 * website's VITE_STRIPE_PORTAL_LOGIN_URL and scripts/extension-target.mjs.
 */
export function parseStripePortalLoginUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    const ok = url.protocol === 'https:'
      && url.hostname === 'billing.stripe.com'
      && !url.username && !url.password && !url.port && !url.search && !url.hash
      && /^\/p\/login\/[A-Za-z0-9_]+$/.test(url.pathname)
    return ok ? url.href : null
  } catch { return null }
}

/** The build's portal login link, validated again at runtime. */
export const STRIPE_PORTAL_LOGIN_URL: string | null = parseStripePortalLoginUrl(
  typeof __STRIPE_PORTAL_LOGIN_URL__ !== 'undefined' ? __STRIPE_PORTAL_LOGIN_URL__ : '',
)

/** Where billing questions go, from the shared config. */
export const BILLING_CONTACT_EMAIL: string = OFFER.billingContact.email
