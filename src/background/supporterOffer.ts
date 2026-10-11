import {
  parseSupporterOffer,
  supporterOfferFromReply,
  type SupporterOffer,
  type SupporterOfferEnvironment,
} from '../shared/supporterOffer.ts'

/**
 * The worker's copy of the public sales switch (GET /v1/billing/offer,
 * supporter launch spec §2.3). Anonymous: the request carries no cookie and no
 * bearer, and the answer carries no per-user data. The worker is the only
 * reader; settings asks it with SUPPORTER_OFFER, so the content script never
 * carries any of this.
 *
 * Cache (chrome.storage.session, memory-backed and closed to content scripts):
 *
 *   - a known answer (open or closed) is reused for 5 minutes;
 *   - opening settings asks with `refresh`, which re-reads anything older than
 *     60 seconds, so a flip shows within a minute there;
 *   - a failed read (`unknown`) is reused for 30 seconds so open pages do not
 *     each retry it; a failed refresh keeps a known answer that is still
 *     inside its 5 minutes rather than replacing it with "couldn't check".
 *
 * Closing sales needs no client cache at all to be safe: the server refuses
 * Checkout at once with 403 `checkout_disabled`, which settings shows as closed.
 */
export const OFFER_CACHE_TTL_MS = 5 * 60_000
export const OFFER_SETTINGS_REFRESH_MS = 60_000
export const OFFER_UNKNOWN_CACHE_MS = 30_000
export const SUPPORTER_OFFER_SESSION_KEY = 'pulseSupporterOffer'
export const SUPPORTER_OFFER_PATH = '/v1/billing/offer'

export type CachedSupporterOffer = { value: SupporterOffer; fetchedAt: number }

type Ports = {
  /** GET /v1/billing/offer without credentials; throws when nothing came back. */
  fetch: () => Promise<{ status: number; body: unknown }>
  read: () => Promise<unknown>
  write: (value: CachedSupporterOffer) => Promise<void>
  /** Billing environments this build honours: live only in store builds. */
  environments: readonly SupporterOfferEnvironment[]
  now?: () => number
}

function cached(value: unknown): CachedSupporterOffer | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.fetchedAt !== 'number' || !Number.isFinite(record.fetchedAt)) return null
  const offer = record.value && typeof record.value === 'object' ? record.value as Record<string, unknown> : null
  if (!offer) return null
  // Re-validated like any reply: a stored value never opens sales by its shape alone.
  const parsed = offer.state === 'unknown' ? { state: 'unknown' } as const : supporterOfferFromReply({ type: 'SUPPORTER_OFFER', offer })
  if (parsed.state === 'unknown' && offer.state !== 'unknown') return null
  return { value: parsed, fetchedAt: record.fetchedAt }
}

export class SupporterOfferCache {
  private inflight: Promise<SupporterOffer> | null = null

  constructor(private readonly ports: Ports) {}

  private now(): number { return this.ports.now?.() ?? Date.now() }

  /** The current offer; `refresh` (settings opening) re-reads anything older than a minute. */
  async get(refresh = false): Promise<SupporterOffer> {
    const now = this.now()
    const previous = cached(await this.ports.read().catch(() => null))
    if (previous) {
      const age = now - previous.fetchedAt
      const ttl = previous.value.state === 'unknown' ? OFFER_UNKNOWN_CACHE_MS : OFFER_CACHE_TTL_MS
      const maxAge = refresh ? Math.min(ttl, OFFER_SETTINGS_REFRESH_MS) : ttl
      if (age >= 0 && age < maxAge) return previous.value
    }
    if (!this.inflight) {
      this.inflight = this.load(previous).finally(() => { this.inflight = null })
    }
    return this.inflight
  }

  private async load(previous: CachedSupporterOffer | null): Promise<SupporterOffer> {
    let value: SupporterOffer
    try {
      const result = await this.ports.fetch()
      value = parseSupporterOffer(result.status, result.body, this.ports.environments)
    } catch {
      value = { state: 'unknown' }
    }
    const fetchedAt = this.now()
    if (value.state === 'unknown' && previous && previous.value.state !== 'unknown' && fetchedAt - previous.fetchedAt < OFFER_CACHE_TTL_MS) {
      return previous.value
    }
    await this.ports.write({ value, fetchedAt }).catch(() => undefined)
    return value
  }
}

/**
 * Whether the worker may start a new Checkout for a SUPPORTER_BILLING action.
 * Only `checkout` is gated: it needs the switch open (re-read when older than a
 * minute), so the account's checkoutEnabled flag alone never opens a session
 * at a price this build does not state. Status, resume and the portal are
 * never blocked, so members can always manage or cancel.
 */
export async function checkoutAllowedByOffer(action: string, offers: Pick<SupporterOfferCache, 'get'>): Promise<boolean> {
  if (action !== 'checkout') return true
  try { return (await offers.get(true)).state === 'open' } catch { return false }
}

/** One anonymous GET; at most 4 KiB is read. */
export async function fetchSupporterOffer(origin: string, fetchImpl: typeof fetch = fetch): Promise<{ status: number; body: unknown }> {
  const response = await fetchImpl(`${origin}${SUPPORTER_OFFER_PATH}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  })
  const text = await response.text()
  if (text.length > 4_096) throw new Error('offer_response_invalid')
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { /* the status still says enough */ }
  return { status: response.status, body }
}
