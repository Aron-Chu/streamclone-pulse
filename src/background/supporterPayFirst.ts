import type { SupporterBillingState, SupporterRestoreState, SupporterDevicesState } from '../shared/supporterAccount.ts'
import type { SupporterAccountCoordinator } from './supporterAccount.ts'

export const PAY_FIRST_WATCH_MS = 30 * 60_000
const RESTORE_WATCH_MS = 15 * 60_000
const POLL_MS = 5_000
const ATTEMPT_MAX_MS = 24 * 60 * 60_000
const RETRY_MAX_MS = 24 * 60 * 60_000
type Billing = { accountId: string; attemptId?: string; phase: 'waiting' | 'confirming'; until: number; watchUntil: number; nextPoll: number; url?: string }
type UnresolvedAccount = { hash: string; until: number }
type Restore = { accountId: string; restoreId: string; secret: string; expiresAt: string; comparisonCode: string; nextPoll: number; interval: number }
type RestoreStart = { accountId: string; key: string; until: number; nextRetry: number }
type PrivateJourney = { billing?: Billing; billingRetryUntil?: number; restoreRetryUntil?: number; restore?: Restore; restoreStart?: RestoreStart; unresolvedAccounts?: UnresolvedAccount[]; restoreResult?: 'restored' | 'expired' | 'conflict' }
type Result = { status: number; body: unknown; retryAfterMs?: number }
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
const code = (value: unknown): value is string => typeof value === 'string' && /^[A-F0-9]{6}$/.test(value)
const emailAddress = (value: unknown): value is string => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const randomKey = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
async function accountHash(accountId: string): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`supporter-payment-account-v1:${accountId}`))), byte => byte.toString(16).padStart(2, '0')).join('') }
const retryMs = (result: Result) => Math.max(POLL_MS, Math.min(RETRY_MAX_MS, Number.isFinite(result.retryAfterMs) ? result.retryAfterMs! : 60_000))

/** Provider navigation is performed by the worker only, never by a content page. */
export function validatedStripeUrl(value: unknown, action: 'checkout' | 'portal'): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null
  try {
    const url = new URL(value)
    // Hosted Checkout's opaque fragment remains private and intact.
    if (url.protocol !== 'https:' || url.hostname !== (action === 'checkout' ? 'checkout.stripe.com' : 'billing.stripe.com') || url.username || url.password || url.port || action === 'portal' && url.hash) return null
    return url.href
  } catch { return null }
}

/** One serialized worker owns waits and explicit recovery across settings restarts. */
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
    const raw = object(await this.ports.read()), b = object(raw.billing), r = object(raw.restore), start = object(raw.restoreStart)
    const value: PrivateJourney = {}
    if (id(b.accountId) && (b.attemptId === undefined || id(b.attemptId)) && (b.phase === 'waiting' || b.phase === 'confirming') && typeof b.until === 'number' && Number.isFinite(b.until) && typeof b.nextPoll === 'number' && Number.isFinite(b.nextPoll)) value.billing = { ...b, watchUntil: typeof b.watchUntil === 'number' && Number.isFinite(b.watchUntil) ? b.watchUntil : Math.min(b.until, this.now() + PAY_FIRST_WATCH_MS), url: validatedStripeUrl(b.url, 'checkout') ?? undefined } as Billing
    if (id(r.accountId) && id(r.restoreId) && secret(r.secret) && code(r.comparisonCode) && typeof r.expiresAt === 'string' && Number.isFinite(Date.parse(r.expiresAt)) && typeof r.nextPoll === 'number' && Number.isFinite(r.nextPoll) && typeof r.interval === 'number' && r.interval >= POLL_MS && r.interval <= 60_000) value.restore = r as unknown as Restore
    if (id(start.accountId) && secret(start.key) && typeof start.until === 'number' && Number.isFinite(start.until) && typeof start.nextRetry === 'number' && Number.isFinite(start.nextRetry)) value.restoreStart = { accountId: start.accountId, key: start.key, until: start.until, nextRetry: start.nextRetry }
    if (Array.isArray(raw.unresolvedAccounts)) {
      // Upgrade old unbounded hashes once; reconcile persists these deadlines.
      const entries = raw.unresolvedAccounts.map(item => secret(item) ? { hash: item, until: this.now() + ATTEMPT_MAX_MS } : object(item))
      value.unresolvedAccounts = entries.filter((item): item is UnresolvedAccount => secret(item.hash) && typeof item.until === 'number' && Number.isFinite(item.until) && item.until > this.now() && item.until <= this.now() + ATTEMPT_MAX_MS).map(item => ({ hash: item.hash, until: item.until }))
      if (!value.unresolvedAccounts.length) delete value.unresolvedAccounts
    }
    if (typeof raw.billingRetryUntil === 'number' && Number.isFinite(raw.billingRetryUntil) && raw.billingRetryUntil > this.now() && raw.billingRetryUntil <= this.now() + RETRY_MAX_MS) value.billingRetryUntil = raw.billingRetryUntil
    if (typeof raw.restoreRetryUntil === 'number' && Number.isFinite(raw.restoreRetryUntil) && raw.restoreRetryUntil > this.now() && raw.restoreRetryUntil <= this.now() + RETRY_MAX_MS) value.restoreRetryUntil = raw.restoreRetryUntil
    if (raw.restoreResult === 'restored' || raw.restoreResult === 'expired' || raw.restoreResult === 'conflict') value.restoreResult = raw.restoreResult
    return value
  }
  /** Called after a worker-owned identity mutation, before its public revision signal. */
  async reconcileIdentity(): Promise<void> {
    const value = await this.read()
    const current = await this.ports.account.localAccountId()
    if (value.billing && value.billing.accountId !== current) {
      const hash = await accountHash(value.billing.accountId)
      value.unresolvedAccounts = [...(value.unresolvedAccounts ?? []).filter(item => item.hash !== hash), { hash, until: value.billing.until }]
      // Disconnect does not prove failure. Bound this non-authorizing purchase
      // precaution by the attempt deadline instead of permanently locking out.
      delete value.billing
    }
    if (value.restore?.accountId !== current) delete value.restore
    if (value.restoreStart?.accountId !== current) delete value.restoreStart
    await this.ports.write(value)
  }
  async hasPending(): Promise<boolean> {
    const value = await this.read(), current = await this.ports.account.localAccountId()
    return Boolean(value.billing && value.billing.accountId === current && Math.min(value.billing.until, value.billing.watchUntil) > this.now() || value.restore && value.restore.accountId === current && Date.parse(value.restore.expiresAt) > this.now())
  }
  billing(action: 'status' | 'check' | 'checkout' | 'resume' | 'portal'): Promise<SupporterBillingState> {
    return this.serialize(() => this.performBilling(action), { state: 'unavailable' })
  }
  restore(action: 'status' | 'start' | 'check' | 'cancel', email?: string): Promise<SupporterRestoreState> {
    return this.serialize(() => this.performRestore(action, email), { state: 'unavailable' })
  }
  devices(action: 'list' | 'revoke', deviceId?: string, cursor?: string): Promise<SupporterDevicesState> {
    return this.serialize(async (): Promise<SupporterDevicesState> => {
      const current = await this.identity()
      if (!current) return { state: 'unavailable' }
      const capability = await this.ports.account.entitlement()
      if (capability.state !== 'ready' || capability.accountKind !== 'installation' || capability.installationAccountsEnabled !== true) return { state: 'unavailable' }
      if (action === 'revoke') {
        if (!id(deviceId) || deviceId === await this.ports.account.localDeviceId()) return { state: 'error' }
        const result = await this.ports.account.withCredential(token => this.ports.request('/v1/account/installations/devices/revoke', { deviceId }, token), current)
        return { state: result.status === 204 ? 'revoked' : 'error' }
      }
      if (cursor !== undefined && !id(cursor)) return { state: 'error' }
      const result = await this.ports.account.withCredential(token => this.ports.request(`/v1/account/installations/devices${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, undefined, token), current)
      const body = object(result.body)
      if (result.status !== 200 || !id(body.currentDeviceId) || !Array.isArray(body.devices) || body.devices.length > 50 || body.nextCursor !== undefined && !id(body.nextCursor)) return { state: 'error' }
      const devices = body.devices.map(item => {
        const value = object(item)
        if (!id(value.id) || typeof value.label !== 'string' || value.label.length > 80 || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) || value.revokedAt !== undefined && (typeof value.revokedAt !== 'string' || !Number.isFinite(Date.parse(value.revokedAt)))) return null
        return { id: value.id, label: value.label, createdAt: value.createdAt, expiresAt: value.expiresAt, ...(typeof value.revokedAt === 'string' ? { revokedAt: value.revokedAt } : {}) }
      })
      if (devices.some(item => !item)) return { state: 'error' }
      return { state: 'ready', devices: devices.filter(item => item !== null), currentDeviceId: body.currentDeviceId, ...(typeof body.nextCursor === 'string' ? { nextCursor: body.nextCursor } : {}) }
    }, { state: 'unavailable' })
  }
  async tick(): Promise<void> { await this.restore('status'); await this.billing('status') }
  private async identity(): Promise<string | null> {
    const state = await this.ports.account.run('status')
    return state.state === 'linked' ? state.accountId : null
  }
  private async performBilling(action: 'status' | 'check' | 'checkout' | 'resume' | 'portal'): Promise<SupporterBillingState> {
    await this.reconcileIdentity()
    const value = await this.read()
    if (action !== 'status' && value.billingRetryUntil && value.billingRetryUntil > this.now()) return value.billing ? { state: 'still_confirming', ...(value.billing.attemptId ? { attemptId: value.billing.attemptId } : {}) } : { state: 'unavailable' }
    if (value.billing) {
      if (await this.identity() !== value.billing.accountId) { await this.reconcileIdentity(); return { state: 'reconnect_required' } }
      if (action === 'resume' && value.billing.phase === 'waiting' && value.billing.url && value.billing.until > this.now()) {
        await this.ports.open(value.billing.url)
        return { state: 'waiting', ...(value.billing.attemptId ? { attemptId: value.billing.attemptId } : {}) }
      }
      if (action !== 'portal') {
        if (action === 'check' && !value.billing.url) {
          const recovered = await this.createOrRecoverCheckout(value, value.billing.accountId, false)
          // A named expired/pending result also has an owned read that may
          // establish terminal proof. An explicit recovery never loops POSTs.
          return recovered.state !== 'waiting' && value.billing?.attemptId && (recovered.state === 'confirming' || recovered.state === 'still_confirming') ? this.pollBilling(value, true) : recovered
        }
        return this.pollBilling(value, action === 'check')
      }
    }
    if (action === 'status' && !value.unresolvedAccounts?.length) return { state: 'idle' }
    if (action === 'resume') return { state: value.unresolvedAccounts?.length ? 'reconnect_required' : 'idle' }
    if (value.unresolvedAccounts?.length) {
      const current = await this.identity()
      if (!current) return { state: 'reconnect_required' }
      const membership = await this.ports.account.entitlement()
      if (membership.state === 'ready' && (membership.status === 'active' || membership.status === 'grace')) {
        // Verified access resolves this account's earlier uncertain payment;
        // unrelated old-account fingerprints remain untouched.
        const currentHash = await accountHash(current)
        if (value.unresolvedAccounts.some(item => item.hash === currentHash)) await this.resolveBilling(value, current)
        if (action !== 'portal') return { state: 'active' }
      } else {
        const currentHash = await accountHash(current)
        if (action !== 'check' || !value.unresolvedAccounts.some(item => item.hash === currentHash)) return { state: 'reconnect_required' }
        value.billing = { accountId: current, phase: 'confirming', until: this.now() + ATTEMPT_MAX_MS, watchUntil: this.now() + PAY_FIRST_WATCH_MS, nextPoll: this.now() }
        await this.ports.write(value)
        return this.createOrRecoverCheckout(value, current, false)
      }
    }
    if (action === 'status' || action === 'check') return { state: 'idle' }
    const installation = await this.ports.account.ensureInstallation()
    if (installation.state === 'fallback') return { state: 'fallback' }
    if (installation.state !== 'linked') return { state: 'unavailable' }
    const capability = await this.ports.account.entitlement()
    if (capability.state !== 'ready') return { state: 'unavailable' }
    // An email account keeps its fresh-signin website journey. Configuration
    // skew on a created installation must never switch to a different cookie account.
    if (capability.accountKind === 'email') return { state: 'fallback' }
    if (capability.accountKind === undefined && capability.installationAccountsEnabled !== true && !await this.ports.account.isInstallationIdentity()) return { state: 'fallback' }
    if (capability.accountKind !== 'installation' || action !== 'portal' && capability.installationAccountsEnabled !== true) return { state: 'unavailable' }
    if (action === 'portal') {
      const result = await this.ports.account.withCredential(token => this.ports.request('/v1/billing/portal', {}, token), installation.accountId)
      if (result.status === 429) { value.billingRetryUntil = this.now() + retryMs(result); await this.ports.write(value) }
      const url = result.status === 200 ? validatedStripeUrl(object(result.body).url, 'portal') : null
      if (!url) return { state: result.status === 404 || result.status === 503 || result.status === 429 ? 'unavailable' : 'error' }
      if (await this.identity() !== installation.accountId) return { state: 'error' }
      await this.ports.open(url)
      return { state: 'idle' }
    }
    if (capability.status === 'active' || capability.status === 'grace') return { state: 'active' }
    if (capability.status === 'review') return { state: 'review' }
    if (capability.status === 'pending') return { state: 'confirming' }
    if (!capability.checkoutEnabled) return { state: 'closed' }
    delete value.restoreResult
    value.billing = { accountId: installation.accountId, phase: 'confirming', until: this.now() + ATTEMPT_MAX_MS, watchUntil: this.now() + PAY_FIRST_WATCH_MS, nextPoll: this.now() + POLL_MS }
    await this.ports.write(value)
    return this.createOrRecoverCheckout(value, installation.accountId, true)
  }
  private async resolveBilling(value: PrivateJourney, accountId: string): Promise<void> {
    delete value.billing
    const hash = await accountHash(accountId)
    value.unresolvedAccounts = value.unresolvedAccounts?.filter(item => item.hash !== hash)
    if (!value.unresolvedAccounts?.length) delete value.unresolvedAccounts
    await this.ports.write(value)
  }
  private async createOrRecoverCheckout(value: PrivateJourney, accountId: string, navigate: boolean): Promise<SupporterBillingState> {
    let result: Result
    try { result = await this.ports.account.withCredential(token => this.ports.request('/v1/billing/checkout', {}, token), accountId) }
    catch { return { state: 'confirming' } }
    if (await this.ports.account.localAccountId() !== accountId) { await this.reconcileIdentity(); return { state: 'reconnect_required' } }
    const body = object(result.body), pending = value.billing!
    if (id(body.attemptId)) pending.attemptId = body.attemptId
    this.updateExpiry(pending, body)
    await this.ports.write(value)
    if (result.status === 403 && body.error === 'checkout_disabled') {
      // During explicit recovery, closure cannot prove an earlier lost payment
      // absent. Keep its barrier until an owned terminal attempt is observed.
      if (!navigate) return { state: 'still_confirming' }
      await this.resolveBilling(value, accountId); return { state: 'closed' }
    }
    if (result.status === 409 && body.error === 'subscription_exists') {
      const membership = await this.ports.account.entitlement()
      if (membership.state === 'ready' && (membership.status === 'active' || membership.status === 'grace')) { await this.resolveBilling(value, accountId); return { state: 'active' } }
      return { state: 'confirming' }
    }
    if (result.status === 409 && id(body.attemptId) && (body.error === 'checkout_pending' || body.error === 'checkout_expired')) return { state: 'confirming', attemptId: body.attemptId }
    if (result.status !== 200 && result.status !== 201) {
      if (result.status === 429) { value.billingRetryUntil = this.now() + retryMs(result); pending.nextPoll = value.billingRetryUntil; await this.ports.write(value) }
      if (navigate && (result.status === 400 || result.status === 403 || result.status === 429)) { await this.resolveBilling(value, accountId); return { state: result.status === 429 ? 'unavailable' : 'error' } }
      return { state: 'confirming', ...(pending.attemptId ? { attemptId: pending.attemptId } : {}) }
    }
    const url = validatedStripeUrl(body.url, 'checkout')
    if (!id(body.attemptId) || !url || typeof body.expiresAt !== 'string' || !Number.isFinite(Date.parse(body.expiresAt))) return { state: 'still_confirming', ...(pending.attemptId ? { attemptId: pending.attemptId } : {}) }
    pending.attemptId = body.attemptId; pending.phase = 'waiting'; pending.url = url
    await this.ports.write(value)
    if (navigate) await this.ports.open(url)
    return { state: 'waiting', attemptId: body.attemptId }
  }
  private updateExpiry(pending: Billing, body: Record<string, unknown>): void {
    const deadline = typeof body.expiresAt === 'string' ? Date.parse(body.expiresAt) : NaN
    // Session lifetime bounds navigation and disconnected-account precautions.
    // Automatic polling has its own shorter lifetime.
    if (Number.isFinite(deadline) && deadline <= this.now() + ATTEMPT_MAX_MS) pending.until = deadline
  }
  private async pollBilling(value: PrivateJourney, explicit = false): Promise<SupporterBillingState> {
    const pending = value.billing!
    const projection = (): SupporterBillingState => ({ state: this.now() >= pending.until || !pending.attemptId || this.now() >= pending.watchUntil && pending.phase === 'confirming' ? 'still_confirming' : pending.phase, ...(pending.attemptId ? { attemptId: pending.attemptId } : {}), ...(this.now() >= pending.watchUntil ? { automaticPolling: false } : {}) })
    if (value.billingRetryUntil && value.billingRetryUntil > this.now() || !explicit && (pending.nextPoll > this.now() || pending.watchUntil <= this.now())) return projection()
    pending.nextPoll = this.now() + POLL_MS
    await this.ports.write(value)
    if (pending.attemptId) {
      const result = await this.ports.account.withCredential(token => this.ports.request(`/v1/billing/checkout/${pending.attemptId}`, undefined, token), pending.accountId)
      const body = object(result.body)
      if (result.status === 429) { value.billingRetryUntil = this.now() + retryMs(result); pending.nextPoll = value.billingRetryUntil; await this.ports.write(value); return projection() }
      if (result.status === 200 && body.attemptId === pending.attemptId) {
        this.updateExpiry(pending, body)
        if (body.state === 'expired' || body.state === 'unpaid' || body.state === 'review') { await this.resolveBilling(value, pending.accountId); return { state: body.state === 'review' ? 'review' : 'expired' } }
        if (body.state === 'paid' || body.state === 'active' || body.state === 'complete' || body.state === 'completed' || body.state === 'pending') pending.phase = 'confirming'
      }
    }
    const membership = await this.ports.account.entitlement()
    if (membership.state === 'ready' && (membership.status === 'active' || membership.status === 'grace' || membership.status === 'review')) {
      await this.resolveBilling(value, pending.accountId)
      await this.ports.changed?.().catch(() => undefined)
      return { state: membership.status === 'review' ? 'review' : 'active' }
    }
    await this.ports.write(value)
    return projection()
  }
  private async performRestore(action: 'status' | 'start' | 'check' | 'cancel', email?: string): Promise<SupporterRestoreState> {
    await this.reconcileIdentity()
    const value = await this.read()
    if (action === 'cancel') { delete value.restore; delete value.restoreStart; delete value.restoreResult; await this.ports.write(value); return { state: 'idle' } }
    if (value.restore) {
      const pending = value.restore
      const projection = (): SupporterRestoreState => ({ state: 'pending', expiresAt: pending.expiresAt, comparisonCode: pending.comparisonCode })
      if (Date.parse(pending.expiresAt) <= this.now()) { delete value.restore; value.restoreResult = 'expired'; await this.ports.write(value); return { state: 'expired' } }
      if (pending.nextPoll > this.now()) return projection()
      pending.nextPoll = this.now() + pending.interval
      await this.ports.write(value)
      let result: Result
      try { result = await this.ports.account.withCredential(token => this.ports.request('/v1/account/restores/poll', { restoreId: pending.restoreId, pollingSecret: pending.secret }, token), pending.accountId, async response => { await this.ports.account.discardRestoredCredentials(response.body) }) }
      catch (error) {
        if (error instanceof Error && error.message === 'account_temporarily_unavailable') return projection()
        throw error
      }
      const body = object(result.body)
      if (result.status === 429) { pending.nextPoll = this.now() + retryMs(result); await this.ports.write(value); return projection() }
      if (result.status === 200 && body.state === 'approved') {
        if (!await this.ports.account.adoptRestoredCredentials(body, pending.accountId)) return { state: 'error' }
        delete value.restore; value.restoreResult = 'restored'; await this.ports.write(value)
        await this.reconcileIdentity()
        await this.ports.changed?.().catch(() => undefined)
        return { state: 'restored' }
      }
      if (result.status === 401 || body.state === 'expired' || body.state === 'restore_conflict') {
        delete value.restore; value.restoreResult = body.state === 'restore_conflict' ? 'conflict' : 'expired'; await this.ports.write(value); return { state: value.restoreResult }
      }
      return projection()
    }
    if (value.restoreStart) {
      if (value.restoreStart.until <= this.now()) { delete value.restoreStart; value.restoreResult = 'expired'; await this.ports.write(value); return { state: 'expired' } }
      if (action !== 'check' || value.restoreStart.nextRetry > this.now()) return { state: 'uncertain' }
      return this.startOrRecoverRestore(value)
    }
    if (action === 'status' || action === 'check') {
      if (value.restoreResult) {
        const capability = await this.ports.account.entitlement()
        if (capability.state === 'ready' && (capability.restoreEligible === false || capability.status === 'active' || capability.status === 'grace')) {
          delete value.restoreResult
          await this.ports.write(value)
        }
      }
      return { state: value.restoreResult ?? 'idle' }
    }
    if (value.restoreRetryUntil && value.restoreRetryUntil > this.now()) return { state: 'unavailable' }
    if (!emailAddress(email)) return { state: 'error' }
    const installation = await this.ports.account.ensureInstallation('restore')
    if (installation.state === 'fallback') return { state: 'fallback' }
    if (installation.state !== 'linked') return { state: 'unavailable', reason: 'connection' }
    const capability = await this.ports.account.entitlement()
    if (capability.state !== 'ready') return { state: 'unavailable', reason: capability.state === 'error' ? 'membership_invalid' : capability.state === 'unavailable' && capability.reason === 'environment_mismatch' ? 'environment_mismatch' : 'membership' }
    if (capability.accountKind !== 'installation' || capability.installationAccountsEnabled !== true || capability.restoreEligible !== true) return { state: 'ineligible' }
    value.restoreStart = { accountId: installation.accountId, key: randomKey(), until: this.now() + RESTORE_WATCH_MS, nextRetry: this.now() }
    delete value.restoreResult
    await this.ports.write(value)
    return this.startOrRecoverRestore(value, email)
  }
  private async startOrRecoverRestore(value: PrivateJourney, email?: string): Promise<SupporterRestoreState> {
    const start = value.restoreStart!
    let result: Result
    try { result = await this.ports.account.withCredential(token => this.ports.request('/v1/account/restores', { restoreKey: start.key, ...(email ? { email } : {}) }, token), start.accountId) }
    catch { return { state: 'uncertain' } }
    if (await this.ports.account.localAccountId() !== start.accountId) { await this.reconcileIdentity(); return { state: 'ineligible' } }
    const body = object(result.body)
    if (result.status === 429 || result.status === 503) { start.nextRetry = this.now() + retryMs(result); value.restoreRetryUntil = start.nextRetry; await this.ports.write(value); return { state: 'uncertain' } }
    if (result.status === 404 && body.error === 'restore_request_not_found') { delete value.restoreStart; await this.ports.write(value); return { state: 'error' } }
    if (result.status === 409 || result.status === 400 || result.status === 401) { delete value.restoreStart; await this.ports.write(value); return { state: result.status === 401 ? 'expired' : 'ineligible' } }
    if (result.status !== 201 || !id(body.restoreId) || !secret(body.pollingSecret) || !code(body.comparisonCode) || typeof body.expiresAt !== 'string' || !Number.isFinite(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= this.now() || Date.parse(body.expiresAt) > this.now() + RESTORE_WATCH_MS || typeof body.intervalSeconds !== 'number' || body.intervalSeconds < 5 || body.intervalSeconds > 60) return { state: 'uncertain' }
    value.restore = { accountId: start.accountId, restoreId: body.restoreId, secret: body.pollingSecret, expiresAt: body.expiresAt, comparisonCode: body.comparisonCode, nextPoll: this.now() + body.intervalSeconds * 1000, interval: body.intervalSeconds * 1000 }
    delete value.restoreStart
    await this.ports.write(value)
    return { state: 'pending', expiresAt: body.expiresAt, comparisonCode: body.comparisonCode }
  }
}
