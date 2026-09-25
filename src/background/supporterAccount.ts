import type { SupporterAccountAction, SupporterAccountState, SupporterEntitlement, SupporterStatus, SupporterCosmetics } from '../shared/supporterAccount.ts'
import { supporterAccess, SUPPORTER_FEATURES, type SupporterScope } from '../shared/supporterAccess.ts'

type Environment = SupporterScope['environment']
type Pending = { kind: 'pending'; secret: string; code: string; expiresAt: string; nextPoll: number }
type Linked = { kind: 'linked'; token: string; refreshToken: string; accountId: string; deviceId: string; expiresAt: string; refreshExpiresAt: string }
type PrivateState = Pending | Linked | { kind: 'refreshing' } | { kind: 'revoking'; token: string } | null
type Ports = {
  read: () => Promise<unknown>
  write: (value: PrivateState) => Promise<void>
  request: (path: string, body?: Record<string, unknown>, bearer?: string) => Promise<{ status: number; body: unknown }>
  now?: () => number
  /** Billing environments whose entitlements this build honours; live only unless stated. */
  environments?: readonly Environment[]
  identityChanged?: () => Promise<void>
}
const secret =(value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function linked(value: unknown): Linked | null {
  const r = object(value)
  return secret(r.token) && secret(r.refreshToken) && id(r.accountId) && id(r.deviceId) && date(r.expiresAt) && date(r.refreshExpiresAt)
    ? { kind: 'linked', token: r.token, refreshToken: r.refreshToken, accountId: r.accountId, deviceId: r.deviceId, expiresAt: r.expiresAt, refreshExpiresAt: r.refreshExpiresAt } : null
}

/** Thrown by a request port that refused before any network I/O. */
export class AccountRequestNotSent extends Error {}

/**
 * How long to wait before renewing again when the refresh response proves the
 * server rotated nothing, so the stored credentials are still the valid ones.
 * Zero means the refresh may have rotated them, which is never replayed.
 */
function unattemptedRefreshRetryMs(result: { status: number; body: unknown }): number {
  // Only the peer limiter answers 429 on this route, before the store is read.
  if (result.status === 429) return 60_000
  // No refresh route is deployed.
  if (result.status === 404) return 30_000
  if (result.status === 503 && object(result.body).error === 'refresh_not_attempted') return 30_000
  return 0
}

const renewalWaiting = (): SupporterAccountState => ({ state: 'unavailable', reason: 'temporarily_unavailable', linked: true })

const STATUSES: ReadonlySet<string> = new Set(['none', 'active', 'grace', 'pending', 'expired', 'review'])

/** Accept only a well-formed snapshot; an unrecognised shape is not access. */
function projectEntitlement(result: { status: number; body: unknown }, accountId: string, environments: readonly Environment[], elapsedMs: number): SupporterEntitlement {
  if (result.status === 404) return { state: 'unavailable', reason: 'not_deployed' }
  if (result.status === 503) return { state: 'unavailable', reason: 'temporarily_unavailable' }
  if (result.status === 401) return { state: 'not_linked' }
  if (result.status !== 200) return { state: 'error' }
  const body = object(result.body)
  if (!STATUSES.has(String(body.status)) || body.schemaVersion !== 1 || body.accountId !== accountId || (body.environment !== 'sandbox' && body.environment !== 'live') || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0) return { state: 'error' }
  // A sandbox server behind a store build is expected, not a fault, and never access.
  if (!environments.includes(body.environment)) return { state: 'unavailable', reason: 'environment_mismatch' }
  const scope: SupporterScope = { accountId, environment: body.environment }
  const features = SUPPORTER_FEATURES.filter(feature => supporterAccess(body, scope, feature, elapsedMs, feature !== 'supporter.chat_badge.v1') === 'allowed')
  const remaining = Math.min(Date.parse(String(body.cacheUntil)), Date.parse(String(body.accessUntil))) - Date.parse(String(body.serverTime)) - elapsedMs
  const preferences = object(body.cosmetics)
  const finish = preferences.finish === 'etched' || preferences.finish === 'halo' ? preferences.finish : 'glass'
  return {
    state: 'ready',
    status: body.status as SupporterStatus,
    accessUntil: date(body.accessUntil) ? body.accessUntil as string : undefined,
    supportPeriods: Number.isSafeInteger(body.supportPeriods) && Number(body.supportPeriods) >= 0 ? Number(body.supportPeriods) : 0,
    features,
    validForMs: features.length && Number.isFinite(remaining) ? Math.max(0, Math.min(60_000, remaining)) : 0,
    cosmetics: { enabled: preferences.enabled === true, finish },
  }
}

/** One coordinator per worker; serialize rotation and never replay uncertain refreshes. */
export class SupporterAccountCoordinator {
  private queue: Promise<unknown> = Promise.resolve()
  private generation = 0
  private revocationUnconfirmed = false
  /** Worker-memory pause after a refresh the server did not attempt; not persisted. */
  private renewalPause: { deviceId: string; until: number } | null = null
  private now: () => number
  constructor(private ports: Ports) { this.now = ports.now ?? Date.now }

  run(action: SupporterAccountAction): Promise<SupporterAccountState> {
    if (action === 'cancel' || action === 'disconnect') this.generation++
    const generation = this.generation
    const task = this.queue.then(() => this.perform(action, generation)).catch((): SupporterAccountState => ({ state: 'error' }))
    this.queue = task
    return task
  }

  /** Worker-only operation: serialize the complete request with rotation and disconnect. */
  withCredential<T extends { status: number }>(operation: (token: string) => Promise<T>, accountId?: string): Promise<T> {
    const generation = this.generation
    const task = this.queue.then(async () => {
      const account = await this.perform('status', generation)
      if (generation !== this.generation) throw new Error('account_identity_changed')
      // Still connected, so callers must not ask the user to link again.
      if (account.state === 'unavailable') throw new Error('account_temporarily_unavailable')
      if (account.state !== 'linked') throw new Error('account_authorization_required')
      if (accountId !== undefined && account.accountId !== accountId) throw new Error('account_identity_changed')
      const credentials = linked(await this.ports.read())
      if (!credentials || credentials.accountId !== account.accountId || generation !== this.generation) throw new Error('account_identity_changed')
      const result = await operation(credentials.token)
      if (generation !== this.generation) throw new Error('account_identity_changed')
      if (result.status === 401) {
        await this.clear('relink_required')
        throw new Error('account_authorization_required')
      }
      return result
    })
    this.queue = task.catch(() => undefined)
    return task
  }

  /**
   * Read the server-reconciled entitlement.
   *
   * Runs status first so a stale access credential is rotated by the existing
   * serialized refresh path, then makes the authenticated read. The credential
   * never leaves this coordinator.
   */
  entitlement(): Promise<SupporterEntitlement> {
    const generation = this.generation
    const task = this.queue
      .then(async (): Promise<SupporterEntitlement> => {
        const account = await this.perform('status', generation)
        if (generation !== this.generation) return { state: 'not_linked' }
        if (account.state !== 'linked') {
          return account.state === 'unavailable' ? { state: 'unavailable', reason: account.reason } : { state: 'not_linked' }
        }
        const raw = object(await this.ports.read())
        const credentials = raw.kind === 'linked' ? linked(raw) : null
        if (!credentials || generation !== this.generation) return { state: 'not_linked' }
        const started = performance.now()
        const result = await this.ports.request('/v1/billing/supporter', undefined, credentials.token)
        if (generation !== this.generation) return { state: 'not_linked' }
        if (result.status === 401) {
          await this.clear('relink_required')
          return { state: 'not_linked' }
        }
        return projectEntitlement(result, credentials.accountId, this.ports.environments ?? ['live'], performance.now() - started)
      })
      .catch((): SupporterEntitlement => ({ state: 'error' }))
    this.queue = task
    return task
  }

  private async clear(state: SupporterAccountState['state']): Promise<SupporterAccountState> {
    await this.ports.write(null)
    await this.ports.identityChanged?.()
    return { state } as SupporterAccountState
  }

  private async discardCredential(credentials: Linked): Promise<SupporterAccountState> {
    return this.revoke(credentials.token)
  }

  private async revoke(token: string): Promise<SupporterAccountState> {
    // This tombstone cannot authorize account operations, but survives restart
    // so a lost response never destroys the authority needed to retry revocation.
    await this.ports.write({ kind: 'revoking', token })
    await this.ports.identityChanged?.()
    try {
      const result = await this.ports.request('/v1/account/devices/disconnect', { token })
      if (result.status !== 204 && result.status !== 401) return { state: 'error', revocationPending: true }
    } catch { return { state: 'error', revocationPending: true } }
    this.revocationUnconfirmed = false
    return this.clear('signed_out')
  }

  saveCosmetics(value: SupporterCosmetics): Promise<boolean> {
    const generation = this.generation
    const task = this.queue.then(async () => {
      const account = await this.perform('status', generation)
      if (account.state !== 'linked' || generation !== this.generation) return false
      const credentials = linked(await this.ports.read())
      if (!credentials || generation !== this.generation) return false
      const result = await this.ports.request('/v1/billing/cosmetics', value, credentials.token)
      if (generation !== this.generation) return false
      if (result.status === 401) await this.clear('relink_required')
      return result.status === 200
    }).catch(() => false)
    this.queue = task
    return task
  }

  private async perform(action: SupporterAccountAction, generation: number): Promise<SupporterAccountState> {
    if (generation !== this.generation) return { state: 'signed_out' }
    const raw = object(await this.ports.read())
    const credentials = raw.kind === 'linked' ? linked(raw) : null
    if (raw.kind === 'revoking') {
      if (action === 'disconnect' && secret(raw.token)) return this.revoke(raw.token)
      return { state: 'error', revocationPending: true }
    }
    if (action === 'disconnect') {
      if (credentials) return this.revoke(credentials.token)
      if (raw.kind === 'refreshing') this.revocationUnconfirmed = true
      // Clear before network I/O so a failed request cannot keep local access.
      await this.ports.write(null)
      await this.ports.identityChanged?.()
      if (this.revocationUnconfirmed) return { state: 'error' }
      return { state: 'signed_out' }
    }
    if (action === 'cancel') {
      if (credentials) return this.project(credentials)
      return this.clear('signed_out')
    }
    if (raw.kind === 'refreshing') return this.clear('relink_required')
    if (credentials) {
      if (Date.parse(credentials.refreshExpiresAt) <= this.now()) return this.clear('relink_required')
      if (Date.parse(credentials.expiresAt) > this.now() + 60_000) return this.project(credentials)
      if (this.renewalPause?.deviceId === credentials.deviceId && this.now() < this.renewalPause.until) return renewalWaiting()
      await this.ports.write({ kind: 'refreshing' })
      let result
      try { result = await this.ports.request('/v1/account/devices/refresh', { refreshToken: credentials.refreshToken }) }
      catch (error) {
        if (error instanceof AccountRequestNotSent) return this.keepUnrenewed(credentials, 30_000)
        if (generation !== this.generation) this.revocationUnconfirmed = true
        return this.clear('relink_required')
      }
      const retryMs = unattemptedRefreshRetryMs(result)
      if (retryMs) return this.keepUnrenewed(credentials, retryMs)
      const next = linked(result.body)
      if (result.status !== 200 || !next || next.accountId !== credentials.accountId || next.deviceId !== credentials.deviceId) return this.clear('relink_required')
      this.renewalPause = null
      if (generation !== this.generation) return this.discardCredential(next)
      await this.ports.write(next)
      return this.project(next)
    }
    if (raw.kind === 'pending' && secret(raw.secret) && typeof raw.code === 'string' && /^[A-F0-9]{5}-[A-F0-9]{5}$/.test(raw.code) && date(raw.expiresAt) && typeof raw.nextPoll === 'number') {
      const pending: Pending = { kind: 'pending', secret: raw.secret, code: raw.code, expiresAt: raw.expiresAt, nextPoll: raw.nextPoll }
      if (Date.parse(pending.expiresAt) <= this.now()) return this.clear('expired')
      if (action !== 'poll' || pending.nextPoll > this.now()) return this.projectPending(pending)
      pending.nextPoll = this.now() + 5000
      await this.ports.write(pending)
      const result = await this.ports.request('/v1/account/device-links/poll', { pollingSecret: pending.secret })
      if (generation !== this.generation) {
        const approved = object(result.body).state === 'approved' ? linked(result.body) : null
        return approved ? this.discardCredential(approved) : this.clear('signed_out')
      }
      if (result.status === 429) return this.projectPending(pending)
      if (result.status === 401) return this.clear('relink_required')
      if (result.status !== 200) return { state: 'error' }
      const body = object(result.body)
      if (body.state === 'pending') return this.projectPending(pending)
      if (body.state === 'denied' || body.state === 'expired') return this.clear(body.state)
      const next = body.state === 'approved' ? linked(body) : null
      if (!next) return this.clear('relink_required')
      this.revocationUnconfirmed = false
      await this.ports.write(next)
      await this.ports.identityChanged?.()
      return this.project(next)
    }
    if (action === 'start') {
      const result = await this.ports.request('/v1/account/device-links', { label: 'StreamPulse extension' })
      if (generation !== this.generation) return this.clear('signed_out')
      if (result.status === 404) return { state: 'unavailable', reason: 'not_deployed' }
      if (result.status === 503) return { state: 'unavailable', reason: 'temporarily_unavailable' }
      const body = object(result.body)
      if (result.status !== 201 || !secret(body.pollingSecret) || typeof body.code !== 'string' || !/^[A-F0-9]{5}-[A-F0-9]{5}$/.test(body.code) || !date(body.expiresAt) || Date.parse(body.expiresAt) <= this.now() || Date.parse(body.expiresAt) > this.now() + 11 * 60_000) return { state: 'error' }
      const pending: Pending = { kind: 'pending', secret: body.pollingSecret, code: body.code, expiresAt: body.expiresAt, nextPoll: this.now() + 5000 }
      await this.ports.write(pending)
      return this.projectPending(pending)
    }
    return { state: 'signed_out' }
  }

  /**
   * Restore the credentials a refresh left untouched. The refreshing marker
   * would otherwise force a relink on the next read; a disconnect queued
   * meanwhile finds these and revokes them. The access token may already be
   * expired, so report the connection as waiting rather than linked.
   */
  private async keepUnrenewed(credentials: Linked, retryMs: number): Promise<SupporterAccountState> {
    this.renewalPause = { deviceId: credentials.deviceId, until: this.now() + retryMs }
    await this.ports.write(credentials)
    return renewalWaiting()
  }

  private project(value: Linked): SupporterAccountState { return { state: 'linked', accountId: value.accountId, expiresAt: value.expiresAt } }
  private projectPending(value: Pending): SupporterAccountState { return { state: 'pending', code: value.code, expiresAt: value.expiresAt, retryAfterSeconds: Math.max(5, Math.ceil((value.nextPoll - this.now()) / 1000)) } }
}
