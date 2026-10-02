import type { SupporterBillingState, SupporterRestoreState } from '../shared/supporterAccount.ts'
import type { SupporterAccountCoordinator } from './supporterAccount.ts'

export const PAY_FIRST_WATCH_MS = 15 * 60_000
const POLL_MS = 5_000
type Billing = { accountId: string; attemptId?: string; phase: 'waiting' | 'confirming'; until: number; nextPoll: number; url?: string }
type Restore = { accountId: string; restoreId: string; secret: string; expiresAt: string; nextPoll: number; interval: number }
type PrivateJourney = { billing?: Billing; restore?: Restore; restoreResult?: 'restored' | 'expired' | 'conflict' }
type Result = { status: number; body: unknown }
type Ports = {
  account: SupporterAccountCoordinator
  request: (path: string, body?: Record<string, unknown>, bearer?: string) => Promise<Result>
  read: () => Promise<unknown>
  write: (value: PrivateJourney | null) => Promise<void>
  open: (url: string) => Promise<void>
  changed?: () => Promise<void>
  now?: () => number
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)
const secret = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

/** Provider navigation is performed by the worker only, never by a content page. */
export function validatedStripeUrl(value: unknown, action: 'checkout' | 'portal'): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null
  try {
    const url = new URL(value)
    // Stripe's hosted Checkout URLs carry an opaque #fidkdWx… fragment. Keep
    // the provider URL intact after exact-host validation; it stays private.
    if (url.protocol !== 'https:' || url.hostname !== (action === 'checkout' ? 'checkout.stripe.com' : 'billing.stripe.com') || url.username || url.password || url.port || action === 'portal' && url.hash) return null
    return url.href
  } catch { return null }
}

/** A single serialized worker owns payment/restore waits, including when settings closes. */
export class SupporterPayFirstCoordinator {
  private queue: Promise<unknown> = Promise.resolve()
  private now: () => number
  constructor(private ports: Ports) { this.now = ports.now ?? Date.now }
  private serialize<T>(operation: () => Promise<T>, error: T): Promise<T> {
    const task = this.queue.then(operation).catch(() => error)
    this.queue = task
    return task
  }
  private async read(): Promise<PrivateJourney> {
    const raw = object(await this.ports.read())
    const b = object(raw.billing), r = object(raw.restore)
    const value: PrivateJourney = {}
    if (id(b.accountId) && (b.attemptId === undefined || id(b.attemptId)) && (b.phase === 'waiting' || b.phase === 'confirming') && typeof b.until === 'number' && Number.isFinite(b.until) && typeof b.nextPoll === 'number' && Number.isFinite(b.nextPoll)) value.billing = { ...b, url: validatedStripeUrl(b.url, 'checkout') ?? undefined } as Billing
    if (id(r.accountId) && id(r.restoreId) && secret(r.secret) && typeof r.expiresAt === 'string' && Number.isFinite(Date.parse(r.expiresAt)) && typeof r.nextPoll === 'number' && Number.isFinite(r.nextPoll) && typeof r.interval === 'number' && r.interval >= POLL_MS && r.interval <= 60_000) value.restore = r as unknown as Restore
    if (raw.restoreResult === 'restored' || raw.restoreResult === 'expired' || raw.restoreResult === 'conflict') value.restoreResult = raw.restoreResult
    return value
  }
  async hasPending(): Promise<boolean> {
    const value = await this.read()
    const current = await this.ports.account.localAccountId()
    return Boolean(value.billing && value.billing.accountId === current && value.billing.until > this.now() || value.restore && value.restore.accountId === current && Date.parse(value.restore.expiresAt) > this.now())
  }
  billing(action: 'status' | 'checkout' | 'resume' | 'portal'): Promise<SupporterBillingState> {
    return this.serialize(() => this.performBilling(action), { state: 'unavailable' })
  }
  restore(action: 'status' | 'start' | 'cancel', email?: string): Promise<SupporterRestoreState> {
    return this.serialize(() => this.performRestore(action, email), { state: 'unavailable' })
  }
  /** Watch scheduling is private and resumes from IndexedDB after worker restart. */
  async tick(): Promise<void> { await this.restore('status'); await this.billing('status') }
  private async identity(): Promise<string | null> {
    const state = await this.ports.account.run('status')
    return state.state === 'linked' ? state.accountId : null
  }
  private async performBilling(action: 'status' | 'checkout' | 'resume' | 'portal'): Promise<SupporterBillingState> {
    const value = await this.read()
    if (action === 'status' && !value.billing) return { state: 'idle' }
    if (value.billing) {
      if (await this.identity() !== value.billing.accountId && action !== 'portal') return { state: 'still_confirming', ...(value.billing.attemptId ? { attemptId: value.billing.attemptId } : {}) }
      if (action === 'resume' && value.billing.phase === 'waiting' && value.billing.url && value.billing.until > this.now()) {
        await this.ports.open(value.billing.url)
        return { state: 'waiting', ...(value.billing.attemptId ? { attemptId: value.billing.attemptId } : {}) }
      }
      // A new click while a payment is unresolved is a status read, never a second POST.
      if (action !== 'portal') return this.pollBilling(value)
    }
    if (action === 'resume') return { state: 'idle' }
    const installation = await this.ports.account.ensureInstallation()
    if (installation.state === 'fallback') return { state: 'fallback' }
    if (installation.state !== 'linked') return { state: 'unavailable' }
    if (action === 'portal') {
      const result = await this.ports.account.withCredential(token => this.ports.request('/v1/billing/portal', {}, token), installation.accountId)
      if (result.status === 404) return { state: 'fallback' }
      const url = result.status === 200 ? validatedStripeUrl(object(result.body).url, 'portal') : null
      if (!url) return { state: result.status === 503 || result.status === 429 ? 'unavailable' : 'error' }
      if (await this.identity() !== installation.accountId) return { state: 'error' }
      await this.ports.open(url)
      return { state: 'idle' }
    }
    const beforePayment = await this.ports.account.entitlement()
    // A store build refuses sandbox projections and an unknown capability is
    // the legacy website flow. Neither a missing field nor a failed read opens
    // Checkout. The server still authoritatively rechecks every POST.
    if (beforePayment.state !== 'ready') return { state: 'unavailable' }
    if (beforePayment.installationAccountsEnabled !== true) return { state: 'fallback' }
    if (beforePayment.status === 'active' || beforePayment.status === 'grace') return { state: 'active' }
    if (beforePayment.status === 'review') return { state: 'review' }
    if (beforePayment.status === 'pending') return { state: 'confirming' }
    if (beforePayment.checkoutEnabled !== true) return { state: 'closed' }
    // Persist uncertainty before POST: a lost response or worker restart cannot
    // invite another payment. Only an owned terminal attempt clears this barrier.
    value.billing = { accountId: installation.accountId, phase: 'confirming', until: this.now() + PAY_FIRST_WATCH_MS, nextPoll: this.now() + POLL_MS }
    await this.ports.write(value)
    let result: Result
    try { result = await this.ports.account.withCredential(token => this.ports.request('/v1/billing/checkout', {}, token), installation.accountId) }
    catch { return { state: 'confirming' } }
    const body = object(result.body)
    // Error responses can still name the server's retained owned attempt.
    // Follow it instead of turning a provider timeout into an invitation to pay.
    if (id(body.attemptId)) value.billing.attemptId = body.attemptId
    if (typeof body.expiresAt === 'string' && Number.isFinite(Date.parse(body.expiresAt))) value.billing.until = Math.min(value.billing.until, Date.parse(body.expiresAt))
    await this.ports.write(value)
    if (result.status === 403 && body.error === 'checkout_disabled') { delete value.billing; await this.ports.write(value); return { state: 'closed' } }
    if (result.status === 404) { delete value.billing; await this.ports.write(value); return { state: 'fallback' } }
    if (result.status === 409 && body.error === 'subscription_exists') {
      const membership = await this.ports.account.entitlement()
      if (membership.state === 'ready' && (membership.status === 'active' || membership.status === 'grace')) { delete value.billing; await this.ports.write(value); return { state: 'active' } }
      return { state: 'confirming' }
    }
    if (result.status === 409 && id(body.attemptId) && (body.error === 'checkout_pending' || body.error === 'checkout_expired')) {
      value.billing.attemptId = body.attemptId
      await this.ports.write(value)
      return { state: 'confirming', attemptId: body.attemptId }
    }
    if (result.status !== 200 && result.status !== 201) {
      // Only definitive input/precondition failures prove no payment was opened.
      if (result.status === 400 || result.status === 403 || result.status === 429) { delete value.billing; await this.ports.write(value); return { state: result.status === 429 ? 'unavailable' : 'error' } }
      return { state: 'confirming' }
    }
    const url = validatedStripeUrl(body.url, 'checkout')
    if (!id(body.attemptId) || !url) {
      // A malformed navigation response can still represent an open provider
      // session. Keep uncertainty; never offer another payment because of it.
      if (id(body.attemptId)) value.billing.attemptId = body.attemptId
      await this.ports.write(value)
      return { state: 'error' }
    }
    value.billing.attemptId = body.attemptId
    value.billing.phase = 'waiting'
    value.billing.url = url
    if (typeof body.expiresAt === 'string' && Number.isFinite(Date.parse(body.expiresAt))) value.billing.until = Math.min(value.billing.until, Date.parse(body.expiresAt))
    await this.ports.write(value)
    // Re-check after network I/O: a concurrent disconnect must not open a tab.
    if (await this.identity() !== installation.accountId) return { state: 'error' }
    await this.ports.open(url)
    return { state: 'waiting', attemptId: body.attemptId }
  }
  private async pollBilling(value: PrivateJourney): Promise<SupporterBillingState> {
    const pending = value.billing!
    const projection = (): SupporterBillingState => ({ state: this.now() >= pending.until ? 'still_confirming' : pending.phase, ...(pending.attemptId ? { attemptId: pending.attemptId } : {}) })
    if (pending.nextPoll > this.now()) return projection()
    pending.nextPoll = this.now() + POLL_MS
    await this.ports.write(value)
    if (pending.attemptId) {
      const result = await this.ports.account.withCredential(token => this.ports.request(`/v1/billing/checkout/${pending.attemptId}`, undefined, token), pending.accountId)
      const body = object(result.body)
      if (result.status === 200 && body.attemptId === pending.attemptId) {
        if (body.state === 'expired' || body.state === 'review') { delete value.billing; await this.ports.write(value); return { state: body.state } }
        // No current writer establishes `failed` as proof that Stripe can no
        // longer settle the payment. Preserve its barrier conservatively.
        if (body.state === 'failed') pending.phase = 'confirming'
        if (body.state === 'active' || body.state === 'complete' || body.state === 'completed' || body.state === 'pending') pending.phase = 'confirming'
      }
    }
    const membership = await this.ports.account.entitlement()
    if (membership.state === 'ready' && (membership.status === 'active' || membership.status === 'grace' || membership.status === 'review')) {
      delete value.billing; await this.ports.write(value)
      await this.ports.changed?.().catch(() => undefined)
      return { state: membership.status === 'review' ? 'review' : 'active' }
    }
    await this.ports.write(value)
    return projection()
  }
  private async performRestore(action: 'status' | 'start' | 'cancel', email?: string): Promise<SupporterRestoreState> {
    const value = await this.read()
    if (action === 'cancel') { delete value.restore; delete value.restoreResult; await this.ports.write(value); return { state: 'idle' } }
    if (value.restore) {
      const pending = value.restore
      if (Date.parse(pending.expiresAt) <= this.now()) { delete value.restore; value.restoreResult = 'expired'; await this.ports.write(value); return { state: 'expired' } }
      // A refresh pause preserves the private identity. Only an actual account
      // change or deletion abandons this unexpired, installation-bound request.
      if (await this.ports.account.localAccountId() !== pending.accountId) { delete value.restore; await this.ports.write(value); return { state: 'idle' } }
      if (pending.nextPoll > this.now()) return { state: 'pending', expiresAt: pending.expiresAt }
      pending.nextPoll = this.now() + pending.interval
      await this.ports.write(value)
      let result: Result
      try { result = await this.ports.account.withCredential(token => this.ports.request('/v1/account/restores/poll', { restoreId: pending.restoreId, pollingSecret: pending.secret }, token), pending.accountId, async response => { await this.ports.account.discardRestoredCredentials(response.body) }) }
      catch (error) {
        if (error instanceof Error && error.message === 'account_temporarily_unavailable') return { state: 'pending', expiresAt: pending.expiresAt }
        throw error
      }
      const body = object(result.body)
      if (result.status === 200 && body.state === 'approved') {
        if (!await this.ports.account.adoptRestoredCredentials(body, pending.accountId)) return { state: 'error' }
        delete value.restore; value.restoreResult = 'restored'; await this.ports.write(value)
        await this.ports.changed?.().catch(() => undefined)
        return { state: 'restored' }
      }
      if (result.status === 401 || body.state === 'expired' || body.state === 'restore_conflict') {
        delete value.restore; value.restoreResult = body.state === 'restore_conflict' ? 'conflict' : 'expired'; await this.ports.write(value); return { state: value.restoreResult }
      }
      return { state: 'pending', expiresAt: pending.expiresAt }
    }
    if (action === 'status') return { state: value.restoreResult ?? 'idle' }
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { state: 'error' }
    const installation = await this.ports.account.ensureInstallation('restore')
    if (installation.state === 'fallback') return { state: 'fallback' }
    if (installation.state !== 'linked') return { state: 'unavailable' }
    const result = await this.ports.account.withCredential(token => this.ports.request('/v1/account/restores', { email }, token), installation.accountId)
    const body = object(result.body)
    if (result.status === 404) return { state: 'fallback' }
    if (result.status === 409 && body.error === 'restore_conflict') return { state: 'conflict' }
    if (result.status === 429 || result.status === 503) return { state: 'unavailable' }
    if (result.status !== 201 || !id(body.restoreId) || !secret(body.pollingSecret) || typeof body.expiresAt !== 'string' || !Number.isFinite(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= this.now() || Date.parse(body.expiresAt) > this.now() + PAY_FIRST_WATCH_MS || typeof body.intervalSeconds !== 'number' || body.intervalSeconds < 5 || body.intervalSeconds > 60) return { state: 'error' }
    value.restore = { accountId: installation.accountId, restoreId: body.restoreId, secret: body.pollingSecret, expiresAt: body.expiresAt, nextPoll: this.now() + body.intervalSeconds * 1000, interval: body.intervalSeconds * 1000 }
    delete value.restoreResult
    await this.ports.write(value)
    return { state: 'pending', expiresAt: body.expiresAt }
  }
}
