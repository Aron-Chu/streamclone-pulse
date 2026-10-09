import type { SupporterAccountAction, SupporterAccountState, SupporterEntitlement, SupporterStatus, SupporterCosmetics } from '../shared/supporterAccount.ts'
import { supporterAccess, SUPPORTER_FEATURES, type SupporterScope } from '../shared/supporterAccess.ts'

type Environment = SupporterScope['environment']
type Finish = SupporterCosmetics['finish']
type Pending = { kind: 'pending'; secret: string; code: string; expiresAt: string; nextPoll: number }
type Linked = { kind: 'linked'; token: string; refreshToken: string; accountId: string; deviceId: string; expiresAt: string; refreshExpiresAt: string; installation?: true }
type PrivateState = Pending | Linked | { kind: 'refreshing'; installation?: true; credentials?: Linked; startedAt?: number; retryAt?: number } | { kind: 'revoking'; token: string } | { kind: 'relink_required' } | null
/**
 * A finish the user explicitly chose before their membership was verified.
 * Bound to the account linked when it was chosen, if any, and short-lived, so
 * it never equips an unsolicited cosmetic long after the choice was made.
 */
export type FinishIntent = { finish: Finish; setAt: number; accountId?: string }
export const FINISH_INTENT_TTL_MS = 7 * 86_400_000
export type InstallationBootstrap = { key: string; state: 'pending' | 'claimed'; accountId?: string }
type Ports = {
  read: () => Promise<unknown>
  write: (value: PrivateState) => Promise<void>
  request: (path: string, body?: Record<string, unknown>, bearer?: string) => Promise<{ status: number; body: unknown }>
  now?: () => number
  /** Billing environments whose entitlements this build honours; live only unless stated. */
  environments?: readonly Environment[]
  identityChanged?: () => Promise<void>
  /** A non-secret signal that the verified Supporter projection changed. */
  projectionChanged?: () => Promise<void>
  /** Worker-private storage for the optional pre-purchase finish choice. */
  readIntent?: () => Promise<unknown>
  writeIntent?: (value: FinishIntent | null) => Promise<void>
  readInstallationKey?: () => Promise<unknown>
  writeInstallationKey?: (value: InstallationBootstrap | null) => Promise<void>
  /**
   * This device left `accountId`: an explicit sign-out, Sign out everywhere,
   * or the server rejecting its credential (401). The owner removes its local
   * copy of that account's data. Called, never awaited, inside this queue: the
   * owner serializes the removal with work that itself waits on this queue.
   */
  accountForgotten?: (accountId: string) => void
}
const secret =(value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function linked(value: unknown): Linked | null {
  const r = object(value)
  return secret(r.token) && secret(r.refreshToken) && id(r.accountId) && id(r.deviceId) && date(r.expiresAt) && date(r.refreshExpiresAt)
    ? { kind: 'linked', token: r.token, refreshToken: r.refreshToken, accountId: r.accountId, deviceId: r.deviceId, expiresAt: r.expiresAt, refreshExpiresAt: r.refreshExpiresAt, ...(r.installation === true ? { installation: true } : {}) } : null
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
    // Only a literal true opens a purchase path; anything else is closed.
    checkoutEnabled: body.checkoutEnabled === true,
    installationAccountsEnabled: body.installationAccountsEnabled === true,
    accountKind: body.accountKind === 'email' || body.accountKind === 'installation' || body.accountKind === 'twitch' ? body.accountKind : undefined,
    restoreEligible: body.restoreEligible === true,
  }
}

const FINISHES: ReadonlySet<string> = new Set(['glass', 'etched', 'halo'])
function finishIntent(value: unknown, now: number): FinishIntent | null {
  const r = object(value)
  if (!FINISHES.has(String(r.finish)) || typeof r.setAt !== 'number' || r.setAt > now || now - r.setAt > FINISH_INTENT_TTL_MS) return null
  if (r.accountId !== undefined && !id(r.accountId)) return null
  return { finish: r.finish as Finish, setAt: r.setAt, ...(r.accountId ? { accountId: r.accountId as string } : {}) }
}

/** What a settings or Twitch surface would render differently. Revision alone is not a change. */
function fingerprint(accountId: string, value: SupporterEntitlement): string {
  if (value.state !== 'ready') return `${accountId}:${value.state}`
  return JSON.stringify([accountId, value.status, value.accessUntil ?? null, value.features, value.supportPeriods, value.cosmetics ?? null, value.checkoutEnabled === true])
}

/** One coordinator per worker; installation refresh retries use the server's bounded idempotency window. */
export class SupporterAccountCoordinator {
  private queue: Promise<unknown> = Promise.resolve()
  private generation = 0
  private revocationUnconfirmed = false
  /** Worker-memory pause after a refresh the server did not attempt; not persisted. */
  private renewalPause: { deviceId: string; until: number } | null = null
  private now: () => number
  constructor(private ports: Ports) { this.now = ports.now ?? Date.now }

  /** First explicit Supporter interaction only; never called from appearance reads. */
  ensureInstallation(purpose: 'purchase' | 'restore' = 'purchase'): Promise<SupporterAccountState | { state: 'fallback' }> {
    const generation = this.generation
    const task = this.queue.then(async () => {
      const current = await this.perform('status', generation)
      if (current.state === 'linked' || current.state === 'unavailable' || current.state === 'pending' || current.state === 'error') return current
      if (!this.ports.readInstallationKey || !this.ports.writeInstallationKey) return { state: 'fallback' } as const
      const storedKey = await this.ports.readInstallationKey()
      const bootstrap = object(storedKey)
      let key: unknown = secret(bootstrap.key) && (bootstrap.state === 'pending' || bootstrap.state === 'claimed') ? bootstrap.key : secret(storedKey) ? storedKey : null
      // Restore deliberately bootstraps an empty waiting installation. A key
      // whose credentials were lost/claimed cannot recover a token family by
      // replaying anonymous enrollment, and must not strand recovery forever.
      if (purpose === 'restore' && bootstrap.state !== 'pending') key = null
      if (!secret(key)) {
        key = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
        await this.ports.writeInstallationKey({ key: key as string, state: 'pending' })
      }
      const result = await this.ports.request('/v1/account/installations', { installationKey: key, label: 'StreamPulse extension' })
      if (result.status === 404) return { state: 'fallback' } as const
      if (result.status === 409 && object(result.body).error === 'installation_initialized') return { state: 'error' } as const
      if (result.status === 429 || result.status === 503) return { state: 'unavailable', reason: 'temporarily_unavailable' } as const
      const credentials = linked(result.body)
      if ((result.status !== 200 && result.status !== 201) || !credentials || Date.parse(credentials.expiresAt) <= this.now() || Date.parse(credentials.refreshExpiresAt) <= this.now()) return { state: 'error' } as const
      if (generation !== this.generation) return this.discardCredential(credentials)
      await this.ports.write({ ...credentials, installation: true })
      await this.ports.writeInstallationKey({ key: key as string, state: 'claimed', accountId: credentials.accountId })
      await this.ports.identityChanged?.()
      return this.project(credentials)
    }).catch((): SupporterAccountState => ({ state: 'error' }))
    this.queue = task
    return task
  }

  /** Restore credential adoption is worker-only and bound to the waiting identity. */
  adoptRestoredCredentials(value: unknown, waitingAccountId: string): Promise<boolean> {
    const generation = this.generation
    const task = this.queue.then(async () => {
      const previous = linked(await this.ports.read())
      const next = linked(value)
      if (!previous || previous.accountId !== waitingAccountId || !next || Date.parse(next.expiresAt) <= this.now() || Date.parse(next.refreshExpiresAt) <= this.now() || generation !== this.generation) {
        if (next) await this.discardRestoredCredentials(value)
        return false
      }
      await this.ports.write({ ...next, installation: true })
      await this.ports.writeIntent?.(null)
      this.lastProjection = undefined
      await this.ports.identityChanged?.()
      return true
    }).catch(() => false)
    this.queue = task
    return task
  }

  /** Best-effort disposal of a stale approved response, without touching a newer identity. */
  async discardRestoredCredentials(value: unknown): Promise<void> {
    const next = object(value).state === 'approved' ? linked(value) : null
    if (!next) return
    await this.ports.request('/v1/account/devices/disconnect', { token: next.token }).catch(() => undefined)
  }

  run(action: SupporterAccountAction): Promise<SupporterAccountState> {
    if (action === 'cancel' || action === 'disconnect') this.generation++
    const generation = this.generation
    const task = this.queue.then(() => this.perform(action, generation)).catch((): SupporterAccountState => ({ state: 'error' }))
    this.queue = task
    return task
  }

  /**
   * Sign out everywhere answered 204: the server already revoked every device
   * of `accountId`, this one included. Forget the stored credential as an
   * explicit sign-out does, without another revocation request (it could only
   * answer 401, and a lost reply would leave a tombstone for a credential that
   * is already dead). A different identity stored meanwhile is left alone.
   */
  forgetSignedOutEverywhere(accountId: string): Promise<SupporterAccountState> {
    this.generation++
    const generation = this.generation
    const task = this.queue.then(async (): Promise<SupporterAccountState> => {
      const raw = object(await this.ports.read())
      const credentials = raw.kind === 'linked' ? linked(raw) : raw.kind === 'refreshing' && raw.installation === true ? linked(raw.credentials) : null
      if (credentials?.accountId !== accountId) return this.perform('status', generation)
      this.forgetAccount(accountId)
      await this.ports.writeInstallationKey?.(null)
      await this.ports.writeIntent?.(null)
      this.lastProjection = undefined
      this.revocationUnconfirmed = false
      this.renewalPause = null
      return this.clear('signed_out')
    }).catch((): SupporterAccountState => ({ state: 'error' }))
    this.queue = task
    return task
  }

  /**
   * Identity generation. Work that leaves the queue (an auth window) records
   * it first; a cancel or disconnect since then makes `adopt` refuse.
   */
  get identityGeneration(): number { return this.generation }

  /**
   * Store a device pair issued outside the device-link poll (Sign in with
   * Twitch). Serialized with refresh and disconnect, so every existing path
   * then uses it unchanged. A cancel or disconnect since `generation` revokes
   * the new pair instead, and a connection that appeared meanwhile is kept.
   */
  adopt(body: unknown, generation: number): Promise<{ adopted: boolean; account: SupporterAccountState }> {
    const task = this.queue.then(async (): Promise<{ adopted: boolean; account: SupporterAccountState }> => {
      const next = object(body).state === 'approved' ? linked(body) : null
      if (!next) return { adopted: false, account: { state: 'error' } }
      const raw = object(await this.ports.read())
      const current = raw.kind === 'linked' ? linked(raw) : null
      if (current) {
        await this.revokeUnstored(next.token)
        return { adopted: false, account: generation === this.generation ? this.project(current) : { state: 'signed_out' } }
      }
      if (raw.kind === 'revoking') {
        // Never overwrite a tombstone whose revocation is still unconfirmed.
        if (generation !== this.generation || !secret(raw.token) || !await this.revokeUnstored(raw.token)) {
          await this.revokeUnstored(next.token)
          return { adopted: false, account: { state: 'error', revocationPending: true } }
        }
      } else if (generation !== this.generation) {
        // Signed out while the window was open: the tombstone retries revocation.
        return { adopted: false, account: await this.discardCredential(next) }
      }
      this.revocationUnconfirmed = false
      this.renewalPause = null
      await this.ports.write(next)
      await this.ports.identityChanged?.()
      return { adopted: true, account: this.project(next) }
    }).catch(() => ({ adopted: false, account: { state: 'error' } as SupporterAccountState }))
    this.queue = task
    return task
  }

  /** Best-effort server revocation of a credential that is not stored. */
  private async revokeUnstored(token: string): Promise<boolean> {
    try {
      const result = await this.ports.request('/v1/account/devices/disconnect', { token })
      return result.status === 204 || result.status === 401
    } catch { return false }
  }

  /** Worker-only operation: serialize the complete request with rotation and disconnect. */
  withCredential<T extends { status: number }>(operation: (token: string) => Promise<T>, accountId?: string, discardStale?: (result: T) => Promise<void>): Promise<T> {
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
      if (generation !== this.generation) { await discardStale?.(result).catch(() => undefined); throw new Error('account_identity_changed') }
      if (result.status === 401) {
        await this.rejected(credentials.accountId)
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
          await this.rejected(credentials.accountId)
          return { state: 'not_linked' }
        }
        const projected = projectEntitlement(result, credentials.accountId, this.ports.environments ?? ['live'], performance.now() - started)
        const value = await this.applyFinishIntent(projected, credentials, generation)
        await this.noteProjection(credentials.accountId, value)
        return value
      })
      .catch((): SupporterEntitlement => ({ state: 'error' }))
    this.queue = task
    return task
  }

  /**
   * Signal open surfaces when what they would render changed, so a verified
   * purchase, cosmetic save or revocation reaches settings and Twitch without a
   * reload. Failed reads are not a change: they must not clear a live accent
   * before its own bounded validity ends.
   */
  private lastProjection: string | undefined
  private async noteProjection(accountId: string, value: SupporterEntitlement): Promise<void> {
    if (value.state === 'error' || value.state === 'unavailable') return
    const next = fingerprint(accountId, value)
    const previous = this.lastProjection
    this.lastProjection = next
    if (previous !== undefined && previous !== next) await this.ports.projectionChanged?.().catch(() => undefined)
  }

  /** The optional finish chosen before purchase, or null. Never a credential. */
  async finishIntent(): Promise<Finish | null> {
    return finishIntent(await this.ports.readIntent?.().catch(() => null), this.now())?.finish ?? null
  }

  /** Record or clear the explicit pre-purchase finish choice for this installation. */
  setFinishIntent(finish: Finish | null): Promise<Finish | null> {
    const generation = this.generation
    const task = this.queue.then(async () => {
      if (!this.ports.writeIntent) return null
      if (finish === null) { await this.ports.writeIntent(null); return null }
      const credentials = linked(await this.ports.read())
      if (generation !== this.generation) return null
      await this.ports.writeIntent({ finish, setAt: this.now(), ...(credentials ? { accountId: credentials.accountId } : {}) })
      return finish
    }).catch(() => null)
    this.queue = task
    return task
  }

  /**
   * Apply an explicit pre-purchase finish once paid access is verified for this
   * account. The server re-checks ownership; a refused save keeps the choice
   * for the next verified read rather than equipping anything locally.
   */
  /** Worker-memory pause after a failed apply, so a refused save is not retried on every read. */
  private intentRetry: { failures: number; until: number } = { failures: 0, until: 0 }
  private async applyFinishIntent(value: SupporterEntitlement, credentials: Linked, generation: number): Promise<SupporterEntitlement> {
    if (value.state !== 'ready' || !value.features.includes('supporter.banner.v1') || !value.features.includes('supporter.finish.v1') || !this.ports.readIntent || !this.ports.writeIntent) return value
    // Applying is an extra; whatever goes wrong, the verified read still stands.
    try {
      const raw = await this.ports.readIntent().catch(() => null)
      const intent = finishIntent(raw, this.now())
      // An account that already has a finish equipped keeps it: a later
      // explicit choice (perhaps on another browser) outranks this earlier one.
      if (!intent || (intent.accountId && intent.accountId !== credentials.accountId) || value.cosmetics?.enabled) {
        if (raw) await this.ports.writeIntent(null)
        return value
      }
      if (this.now() < this.intentRetry.until) return value
      const cosmetics: SupporterCosmetics = { enabled: true, finish: intent.finish }
      const result = await this.ports.request('/v1/billing/cosmetics', cosmetics, credentials.token)
      if (generation !== this.generation) return { state: 'not_linked' }
      if (result.status === 401) {
        await this.rejected(credentials.accountId)
        return { state: 'not_linked' }
      }
      if (result.status !== 200) throw new Error('finish_intent_refused')
      this.intentRetry = { failures: 0, until: 0 }
      await this.ports.writeIntent(null)
      return { ...value, cosmetics }
    } catch {
      // Back off 1, 2, 4… minutes (capped at an hour) and give up after five tries.
      const failures = this.intentRetry.failures + 1
      this.intentRetry = { failures, until: this.now() + Math.min(60, 2 ** (failures - 1)) * 60_000 }
      if (failures >= 5) {
        this.intentRetry = { failures: 0, until: 0 }
        await this.ports.writeIntent?.(null).catch(() => undefined)
      }
      return value
    }
  }

  /** Whether a link request is waiting, without touching credentials or the network. */
  async hasPendingLink(): Promise<boolean> {
    return object(await this.ports.read().catch(() => null)).kind === 'pending'
  }
  /** Worker lifecycle hint only; never rotates a token or sends a request. */
  async localAccountId(): Promise<string | null> {
    const raw = object(await this.ports.read().catch(() => null))
    return linked(raw.kind === 'refreshing' && raw.installation === true ? raw.credentials : raw)?.accountId ?? null
  }
  async localDeviceId(): Promise<string | null> {
    const raw = object(await this.ports.read().catch(() => null))
    return linked(raw.kind === 'refreshing' && raw.installation === true ? raw.credentials : raw)?.deviceId ?? null
  }
  /** Distinguish a bootstrap-created identity from an older email-linked account. */
  async isInstallationIdentity(): Promise<boolean> {
    const raw = object(await this.ports.read().catch(() => null))
    if (raw.installation === true && linked(raw.kind === 'refreshing' ? raw.credentials : raw)) return true
    const bootstrap = object(await this.ports.readInstallationKey?.().catch(() => null))
    const current = await this.localAccountId()
    return Boolean(current && bootstrap.state === 'claimed' && secret(bootstrap.key) && (bootstrap.accountId === undefined || bootstrap.accountId === current))
  }

  private async clear(state: SupporterAccountState['state']): Promise<SupporterAccountState> {
    await this.ports.write(state === 'relink_required' ? { kind: 'relink_required' } : null)
    // An authoritative credential rejection cannot erase the durable installation
    // identity. Explicit Disconnect is the only action that discards its key.
    await this.ports.identityChanged?.()
    return { state } as SupporterAccountState
  }

  /** Best effort; a failure here never blocks signing out. */
  private forgetAccount(accountId: string): void {
    try { this.ports.accountForgotten?.(accountId) } catch { /* the credential is still cleared */ }
  }

  /** The server rejected this device's credential (401): signed out here, and its local copy goes. */
  private async rejected(accountId: string): Promise<SupporterAccountState> {
    this.forgetAccount(accountId)
    return this.clear('relink_required')
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
      if (result.status === 401) await this.rejected(credentials.accountId)
      if (result.status !== 200) return false
      // An explicit choice supersedes any earlier pre-purchase choice, and open
      // Twitch tabs apply it now instead of at their next scheduled check.
      await this.ports.writeIntent?.(null)
      // Surfaces re-read on this signal; the next read sets a fresh baseline
      // rather than announcing the same change a second time.
      this.lastProjection = undefined
      await this.ports.projectionChanged?.().catch(() => undefined)
      return true
    }).catch(() => false)
    this.queue = task
    return task
  }

  private async perform(action: SupporterAccountAction, generation: number): Promise<SupporterAccountState> {
    if (generation !== this.generation) return { state: 'signed_out' }
    const raw = object(await this.ports.read())
    const credentials = raw.kind === 'linked' ? linked(raw) : raw.kind === 'refreshing' && raw.installation === true ? linked(raw.credentials) : null
    if (raw.kind === 'revoking') {
      if (action === 'disconnect' && secret(raw.token)) return this.revoke(raw.token)
      return { state: 'error', revocationPending: true }
    }
    if (action === 'disconnect') {
      await this.ports.writeInstallationKey?.(null)
      // Deliberately leaving an account also abandons a pending finish choice.
      await this.ports.writeIntent?.(null)
      this.lastProjection = undefined
      if (credentials) {
        // Before any network I/O: a failed revocation must not keep the copy.
        this.forgetAccount(credentials.accountId)
        return this.revoke(credentials.token)
      }
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
    if (raw.kind === 'refreshing' && !credentials) return this.clear('relink_required')
    if (raw.kind === 'relink_required' && (action === 'status' || action === 'poll')) return { state: 'relink_required' }
    if (credentials) {
      if (Date.parse(credentials.refreshExpiresAt) <= this.now()) return this.clear('relink_required')
      if (raw.kind !== 'refreshing' && Date.parse(credentials.expiresAt) > this.now() + 60_000) return this.project(credentials)
      if (raw.kind === 'refreshing' && typeof raw.retryAt === 'number' && raw.retryAt > this.now()) return renewalWaiting()
      if (this.renewalPause?.deviceId === credentials.deviceId && this.now() < this.renewalPause.until) return renewalWaiting()
      const bootstrap = object(await this.ports.readInstallationKey?.())
      const installation = raw.installation === true || bootstrap.state === 'claimed' && secret(bootstrap.key) && (bootstrap.accountId === undefined || bootstrap.accountId === credentials.accountId)
      const refreshing: PrivateState = installation ? { kind: 'refreshing', installation: true, credentials, startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : this.now(), retryAt: this.now() + 30_000 } : { kind: 'refreshing' }
      await this.ports.write(refreshing)
      let result
      try { result = await this.ports.request('/v1/account/devices/refresh', { refreshToken: credentials.refreshToken }) }
      catch (error) {
        if (error instanceof AccountRequestNotSent) return this.keepUnrenewed(credentials, 30_000)
        if (generation !== this.generation) this.revocationUnconfirmed = true
        if (installation) return renewalWaiting()
        return this.clear('relink_required')
      }
      const retryMs = unattemptedRefreshRetryMs(result)
      if (retryMs) return this.keepUnrenewed(credentials, retryMs)
      if (installation && (result.status >= 500 || result.status === 408)) return renewalWaiting()
      // A refresh the server rejects outright: the session was revoked.
      if (result.status === 401) return this.rejected(credentials.accountId)
      const next = linked(result.body)
      if (result.status !== 200 || !next || next.accountId !== credentials.accountId || next.deviceId !== credentials.deviceId) return this.clear('relink_required')
      this.renewalPause = null
      if (generation !== this.generation) return this.discardCredential(next)
      await this.ports.write(installation ? { ...next, installation: true } : next)
      return this.project(next)
    }
    if (raw.kind === 'pending' && secret(raw.secret) && typeof raw.code === 'string' && /^[A-F0-9]{5}-[A-F0-9]{5}$/.test(raw.code) && date(raw.expiresAt) && typeof raw.nextPoll === 'number') {
      const pending: Pending = { kind: 'pending', secret: raw.secret, code: raw.code, expiresAt: raw.expiresAt, nextPoll: raw.nextPoll }
      if (Date.parse(pending.expiresAt) <= this.now()) return this.clear('expired')
      // Any status read may consume a due approval, so the worker finishes the
      // link even after settings closed: a Twitch tab's routine appearance check
      // or reopening settings completes it. The stored schedule keeps this at
      // the server's interval however many surfaces ask.
      if ((action !== 'poll' && action !== 'status') || pending.nextPoll > this.now()) return this.projectPending(pending)
      pending.nextPoll = this.now() + 5000
      await this.ports.write(pending)
      let result
      try { result = await this.ports.request('/v1/account/device-links/poll', { pollingSecret: pending.secret }) }
      catch (error) {
        // A background status read keeps the request waiting; the next due read retries.
        if (action === 'status' && generation === this.generation) return this.projectPending(pending)
        throw error
      }
      if (generation !== this.generation) {
        const approved = object(result.body).state === 'approved' ? linked(result.body) : null
        return approved ? this.discardCredential(approved) : this.clear('signed_out')
      }
      if (result.status === 429) return this.projectPending(pending)
      if (result.status === 401) return this.clear('relink_required')
      if (result.status !== 200) return action === 'status' ? this.projectPending(pending) : { state: 'error' }
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
