import { useEffect, useSyncExternalStore } from 'react'
import offerConfig from '../../../src/shared/supporter-offer.json'
import { apiClient, isApiError } from './apiClient'
import { captureAccountIssue } from './sentry'
import { twitchSignInPublic } from './twitchSignInFlag'

/**
 * The one sales switch (Supporter launch spec 2026-10-10, section 2).
 *
 * The server decides whether Supporter is on sale: GET /v1/billing/offer
 * (backend docs/billing-offer.md) is anonymous, sends no cookie, and answers
 * `salesOpen`. Every website surface reads it through useSupporterOffer() and
 * fails closed: the page shows "open" copy and a Become a Supporter button only
 * when the server says `salesOpen: true` AND this build's own checks agree:
 *
 * - the schema is the one this build understands (schemaVersion 1),
 * - Continue with Twitch is the public account path (VITE_TWITCH_SIGNIN=public),
 * - the server's price is the price this build states
 *   (src/shared/supporter-offer.json).
 *
 * Anything else, including a 404 (billing not mounted), a 5xx, a timeout, a
 * malformed body, the prerender and the moment before the first answer, renders
 * exactly like closed. Opening or closing sales is a server change only; no
 * site release is needed to flip it. A stale "open" page that tries Checkout
 * after a close gets 403 checkout_disabled from the server and shows closed.
 *
 * The answer is kept in memory and in sessionStorage for 60 seconds, and read
 * again when the tab becomes visible after that.
 */

export const SUPPORTER_OFFER_CONFIG = offerConfig
export const SUPPORTER_OFFER_PATH = '/v1/billing/offer'
export const SUPPORTER_OFFER_CACHE_KEY = 'pulse.supporterOffer.v1'
export const SUPPORTER_OFFER_TTL_MS = 60_000
const OFFER_TIMEOUT_MS = 6_000

export type SupporterOfferState = 'closed' | 'open' | 'unknown'
export type TaxCollection = 'automatic' | 'none'
export type TaxBehavior = 'exclusive' | 'inclusive' | 'unspecified'

export type ServerOffer = {
  schemaVersion: 1
  salesOpen: boolean
  environment: string
  price?: { unitAmount: number; currency: string; interval: string }
  tax?: { collection: TaxCollection; behavior: TaxBehavior }
  termsConsent: boolean
}

export type SupporterOfferView = {
  state: SupporterOfferState
  offer: ServerOffer | null
  /** Sentence for the Taxes row, true for what Checkout actually does. */
  taxLine: string
  /** Short form for the review screen ("First charge: Today. …"). */
  taxLineShort: string
  priceOk: boolean
}

/** Only the documented shape is accepted; anything else reads as no answer. */
export function parseServerOffer(value: unknown): ServerOffer | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1 || typeof record.salesOpen !== 'boolean') return null
  const offer: ServerOffer = {
    schemaVersion: 1,
    salesOpen: record.salesOpen,
    environment: typeof record.environment === 'string' ? record.environment : '',
    termsConsent: record.termsConsent === true,
  }
  const price = record.price
  if (price && typeof price === 'object' && !Array.isArray(price)) {
    const { unitAmount, currency, interval } = price as Record<string, unknown>
    if (typeof unitAmount === 'number' && Number.isInteger(unitAmount) && unitAmount > 0 && typeof currency === 'string' && typeof interval === 'string') {
      offer.price = { unitAmount, currency, interval }
    }
  }
  const tax = record.tax
  if (tax && typeof tax === 'object' && !Array.isArray(tax)) {
    const { collection, behavior } = tax as Record<string, unknown>
    if ((collection === 'automatic' || collection === 'none') && (behavior === 'exclusive' || behavior === 'inclusive' || behavior === 'unspecified')) {
      offer.tax = { collection, behavior }
    }
  }
  return offer
}

/** The server's price is the one this build states (amount, currency and interval). */
export function offerPriceMatches(offer: ServerOffer | null): boolean {
  const price = offer?.price
  return Boolean(price)
    && price!.unitAmount === offerConfig.price.unitAmount
    && price!.currency === offerConfig.price.currency
    && price!.interval === offerConfig.price.interval
}

/**
 * Open only when every interlock agrees. `reason` names the first client check
 * that kept an open server offer closed, for one Sentry code.
 */
export function evaluateOffer(offer: ServerOffer | null, stagePublic: boolean = twitchSignInPublic()): { state: 'open' | 'closed'; reason?: 'offer_stage_mismatch' | 'offer_price_mismatch' } {
  if (!offer || offer.salesOpen !== true) return { state: 'closed' }
  if (!stagePublic) return { state: 'closed', reason: 'offer_stage_mismatch' }
  if (!offerPriceMatches(offer)) return { state: 'closed', reason: 'offer_price_mismatch' }
  return { state: 'open' }
}

type TaxKey = 'exclusive' | 'inclusive' | 'none' | 'fallback'

/** Picks the tax sentence from what Checkout actually does; the fallback is true in every mode. */
export function taxKeyFor(offer: ServerOffer | null, state: SupporterOfferState): TaxKey {
  if (state !== 'open' || !offer?.tax) return 'fallback'
  if (offer.tax.collection === 'automatic' && offer.tax.behavior === 'exclusive') return 'exclusive'
  if (offer.tax.collection === 'automatic' && offer.tax.behavior === 'inclusive') return 'inclusive'
  if (offer.tax.collection === 'none') return 'none'
  return 'fallback'
}

export function taxLines(offer: ServerOffer | null, state: SupporterOfferState): { long: string; short: string } {
  const key = taxKeyFor(offer, state)
  const tax = offerConfig.tax as unknown as { [k in TaxKey]: string | null } & { short: { [k in TaxKey]: string | null } }
  return { long: tax[key] ?? tax.fallback!, short: tax.short[key] ?? tax.short.fallback! }
}

// ---------------------------------------------------------------------------
// Legal and billing facts (spec section 7): one config, "Pending" until filled.

/** A legal fact from the config, or the visible "Pending — not yet stated." */
export function legalFact(value: string | null | undefined): string {
  return typeof value === 'string' && value.trim() ? value.trim() : offerConfig.pending
}

export function supporterSeller(): { name: string; address: string; governingLaw: string; consumerRights: string } {
  const config = offerConfig as unknown as { seller: { name: string | null; address: string | null }; governingLaw: string | null; consumerRights: string | null }
  return {
    name: legalFact(config.seller.name),
    address: legalFact(config.seller.address),
    governingLaw: legalFact(config.governingLaw),
    consumerRights: legalFact(config.consumerRights),
  }
}

/** The consumer-rights statement once stated, or null while pending. */
export function statedConsumerRights(): string | null {
  const value = (offerConfig as unknown as { consumerRights: string | null }).consumerRights
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Billing and refund mailbox (MERGE GATE memo T1-6: `confirmed` records the owner's check). */
export function billingContactEmail(): string {
  return offerConfig.billingContact.email
}

/** Stripe's statement descriptor rules: 5-22 characters, none of < > \ ' " *. */
export function validStatementDescriptor(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 5 && value.length <= 22 && !/[<>\\'"*]/.test(value) && /[A-Za-z]/.test(value)
}

/** The "On your statement" row renders only once the config states the Dashboard value. */
export function statementDescriptor(): string | null {
  const value = (offerConfig as unknown as { statementDescriptor: unknown }).statementDescriptor
  return validStatementDescriptor(value) ? value : null
}

/** "Stripe emailed your receipt" is promised only once Dashboard receipts are on. */
export function stripeReceiptsOn(): boolean {
  return (offerConfig as unknown as { stripeReceipts: unknown }).stripeReceipts === true
}

/** Fields still pending, for `npm run supporter:legal-status` and tests. */
export function pendingLegalFields(): string[] {
  const config = offerConfig as unknown as Record<string, unknown> & { seller: Record<string, unknown>; billingContact: { confirmed?: unknown } }
  const missing: string[] = []
  if (!config.seller.name) missing.push('seller.name')
  if (!config.seller.address) missing.push('seller.address')
  if (!config.governingLaw) missing.push('governingLaw')
  if (!config.consumerRights) missing.push('consumerRights')
  if (config.billingContact.confirmed !== true) missing.push('billingContact.confirmed')
  if (!statementDescriptor()) missing.push('statementDescriptor')
  if (!stripeReceiptsOn()) missing.push('stripeReceipts')
  return missing
}

// ---------------------------------------------------------------------------
// Reading and caching the server answer.

type Store = { offer: ServerOffer | null; answered: boolean; fetchedAt: number }

let store: Store = { offer: null, answered: false, fetchedAt: 0 }
let inFlight: Promise<void> | null = null
let view: SupporterOfferView | null = null
const listeners = new Set<() => void>()

/**
 * Today's production build reads the offer too (so an open server with a
 * closed build can be reported); unit tests and the dev server read it only
 * when Continue with Twitch is public, the one stage that can show "open".
 */
function shouldReadOffer(): boolean {
  return twitchSignInPublic() || import.meta.env.PROD === true
}

function emit(): void {
  view = null
  for (const listener of listeners) listener()
}

function readCache(): void {
  if (store.answered) return
  try {
    const raw = sessionStorage.getItem(SUPPORTER_OFFER_CACHE_KEY)
    if (!raw) return
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return
    const { offer, fetchedAt } = value as { offer?: unknown; fetchedAt?: unknown }
    const now = Date.now()
    if (typeof fetchedAt !== 'number' || fetchedAt > now || now - fetchedAt >= SUPPORTER_OFFER_TTL_MS) return
    store = { offer: offer === null ? null : parseServerOffer(offer), answered: true, fetchedAt }
  } catch { /* Blocked or malformed storage: ask the server. */ }
}

function writeCache(): void {
  try { sessionStorage.setItem(SUPPORTER_OFFER_CACHE_KEY, JSON.stringify({ offer: store.offer, fetchedAt: store.fetchedAt })) }
  catch { /* Storage is a convenience only. */ }
}

/**
 * One read of GET /v1/billing/offer. Resolves to the parsed offer, or null for
 * "billing is not mounted" (404). Throws for anything that is not an answer.
 */
export async function fetchSupporterOffer(): Promise<ServerOffer | null> {
  try {
    // Not gated: no beta key, no cookie, no Authorization header is sent.
    const result = await apiClient<unknown>(SUPPORTER_OFFER_PATH, { timeoutMs: OFFER_TIMEOUT_MS, credentials: 'omit' })
    const offer = parseServerOffer(result.data)
    if (!offer) throw new Error('Invalid offer')
    return offer
  } catch (error) {
    if (isApiError(error) && error.status === 404) return null
    throw error
  }
}

/** Reads the server answer unless a fresh one is cached; concurrent callers share one request. */
export function refreshSupporterOffer(force = false): Promise<void> {
  readCache()
  if (!force && store.answered && Date.now() - store.fetchedAt < SUPPORTER_OFFER_TTL_MS) return Promise.resolve()
  inFlight ??= fetchSupporterOffer().then(
    offer => {
      store = { offer, answered: true, fetchedAt: Date.now() }
      writeCache()
      const verdict = evaluateOffer(offer)
      if (verdict.reason) captureAccountIssue(verdict.reason)
    },
    () => {
      // An unreadable answer is closed, and is not cached, so the next read retries.
      store = { offer: null, answered: true, fetchedAt: 0 }
      captureAccountIssue('offer_read_failed')
    },
  ).finally(() => { inFlight = null; emit() })
  return inFlight
}

function computeView(): SupporterOfferView {
  readCache()
  const offer = store.offer
  const state: SupporterOfferState = !store.answered ? 'unknown' : evaluateOffer(offer).state
  const lines = taxLines(offer, state)
  return { state, offer, taxLine: lines.long, taxLineShort: lines.short, priceOk: offerPriceMatches(offer) }
}

const UNKNOWN_VIEW: SupporterOfferView = (() => {
  const lines = taxLines(null, 'unknown')
  return { state: 'unknown', offer: null, taxLine: lines.long, taxLineShort: lines.short, priceOk: false }
})()

function snapshot(): SupporterOfferView {
  view ??= computeView()
  return view
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * The sales state for a page. 'unknown' and 'closed' render the same closed
 * copy; only 'open' shows the offer and a Become a Supporter button.
 */
export function useSupporterOffer(): SupporterOfferView {
  const current = useSyncExternalStore(subscribe, snapshot, () => UNKNOWN_VIEW)
  useEffect(() => {
    if (!shouldReadOffer()) return
    void refreshSupporterOffer()
    const wake = () => {
      if (!document.hidden && Date.now() - store.fetchedAt >= SUPPORTER_OFFER_TTL_MS) void refreshSupporterOffer()
    }
    document.addEventListener('visibilitychange', wake)
    return () => document.removeEventListener('visibilitychange', wake)
  }, [])
  return shouldReadOffer() ? current : UNKNOWN_VIEW
}

/** True only when the page may show the real offer and a working button. */
export function salesOpen(view: SupporterOfferView): boolean {
  return view.state === 'open'
}

export function resetSupporterOfferForTests(): void {
  store = { offer: null, answered: false, fetchedAt: 0 }
  inFlight = null
  view = null
  listeners.clear()
}
