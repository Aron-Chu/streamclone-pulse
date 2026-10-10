import { AccountRequestNotSent } from './supporterAccount.ts'
import { isChatBadgeEntry, parseChatBadgeSnapshot, type ChatBadgeActionError, type ChatBadgeEntry, type ChatBadgeSnapshot } from '../shared/chatBadges.ts'
import type { SupporterWave } from '../shared/supporterPaint.ts'
import type { SupporterAccountAction, SupporterAccountState } from '../shared/supporterAccount.ts'
import type {
  TwitchProfile,
  TwitchSignInMode,
  TwitchSignInOutcome,
  TwitchSignInResponse,
  TwitchSignInStatus,
  TwitchSignOutEverywhereResult,
  TwitchStepUpError,
  TwitchStepUpResult,
  TwitchSurface,
} from '../shared/twitchSignIn.ts'

/**
 * Sign in with Twitch, worker side.
 *
 * start-device → identity.launchWebAuthFlow → device. The flow secret and the
 * ID token stay in this worker: they go only to the StreamPulse API, never to
 * a page, a URL or storage. The device pair the server returns is the same one
 * the device-link flow issues, so it is stored through the existing account
 * coordinator and refresh, disconnect, bookmarks and entitlement work
 * unchanged.
 *
 * Silent rules (security must-have 2): `interactive:false` is tried once, only
 * on a true first install, and never after a user sign-out or a server
 * `revoked`. Silent never creates an account; the server enforces that too.
 */

/** launchWebAuthFlow details; the two Chromium-only fields are omitted elsewhere. */
export interface WebAuthFlowDetails {
  url: string
  interactive: boolean
  abortOnLoadForNonInteractive?: boolean
  timeoutMsForNonInteractive?: number
}

type Account = {
  run(action: SupporterAccountAction): Promise<SupporterAccountState>
  adopt(body: unknown, generation: number): Promise<{ adopted: boolean; account: SupporterAccountState }>
  withCredential<T extends { status: number }>(operation: (token: string) => Promise<T>, accountId?: string): Promise<T>
  /**
   * Sign out everywhere succeeded: forget this device's credential without
   * another revocation request. Absent on older coordinators, which disconnect.
   */
  forgetSignedOutEverywhere?(accountId: string): Promise<SupporterAccountState>
  readonly identityGeneration: number
}

type Record_ = { read(): Promise<unknown>; write(value: unknown): Promise<void> }

export interface TwitchSignInPorts {
  enabled: boolean
  account: Account
  fetch: typeof fetch
  /** Absent when the browser has no identity API (Firefox for Android). */
  launchWebAuthFlow?: (details: WebAuthFlowDetails) => Promise<string | undefined>
  /** identity.getRedirectURL, for an early configuration check. */
  redirectUrl?: () => string
  surface: TwitchSurface
  /** Pass Chrome's non-interactive timing options (other browsers reject unknown fields). */
  chromium: boolean
  apiOrigin: string
  /** False when a developer backend override is set: account credentials stay hosted-only. */
  hosted: () => Promise<boolean>
  /** Persisted sign-in markers (never credentials). */
  meta: Record_
  /** Browser-session display profile. */
  profile: Record_
}

/** Persisted markers. A missing or unreadable record is never a first install. */
export interface TwitchSignInMeta {
  v: 1
  firstInstallPending: boolean
  signedOutByUser: boolean
  serverRevoked: boolean
}

const NO_META: TwitchSignInMeta = { v: 1, firstInstallPending: false, signedOutByUser: false, serverRevoked: false }
const SILENT_TIMEOUT_MS = 5_000
const MAX_ID_TOKEN = 3_800
const MAX_RESPONSE = 16_384

type Http = { status: number; body: unknown; retryAfterSeconds?: number }
type Flow = { flowId: string; flowSecret: string; authorizeUrl: string; redirectUri: string }
type Failure = { outcome: TwitchSignInOutcome | 'sign_in_required' | 'identity_mismatch'; retryAfterSeconds?: number }

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const failure = (value: unknown): value is Failure => typeof object(value).outcome === 'string'

export function parseTwitchSignInMeta(value: unknown): TwitchSignInMeta {
  const r = object(value)
  if (r.v !== 1) return { ...NO_META }
  return { v: 1, firstInstallPending: r.firstInstallPending === true, signedOutByUser: r.signedOutByUser === true, serverRevoked: r.serverRevoked === true }
}

/**
 * The server keys redirects by store listing because each listing has its own
 * extension ID, so a store build always names its own store: a Chrome Web Store
 * build running in Edge is still `chrome`. Development builds use the browser.
 */
export function twitchSurface(target: string, runtimeUrl: string, userAgent: string): TwitchSurface {
  if (target === 'cws') return 'chrome'
  if (target === 'edge' || target === 'firefox') return target
  if (runtimeUrl.startsWith('moz-extension:')) return 'firefox'
  return /\bEdg\//.test(userAgent) ? 'edge' : 'chrome'
}

/** Twitch avatars are served from static-cdn.jtvnw.net; anything else is dropped. */
export function parseTwitchProfile(value: unknown): TwitchProfile | null {
  const r = object(value)
  const displayName = typeof r.displayName === 'string' ? r.displayName.trim() : ''
  // eslint-disable-next-line no-control-regex
  if (!displayName || displayName.length > 64 || /[\u0000-\u001f\u007f]/.test(displayName)) return null
  let picture: string | undefined
  if (typeof r.picture === 'string' && r.picture.length <= 512) {
    try {
      const url = new URL(r.picture)
      if (url.protocol === 'https:' && url.hostname === 'static-cdn.jtvnw.net' && !url.username && !url.password) picture = url.toString()
    } catch { /* no avatar */ }
  }
  return picture ? { displayName, picture } : { displayName }
}

/** True for the answer a step-up-gated bearer route gives without a fresh step-up. */
export function requiresStepUp(result: { status: number; body: unknown }): boolean {
  return result.status === 403 && object(result.body).error === 'recent_auth_required'
}

function retryAfter(value: string | null): number | undefined {
  if (!value || !/^\d{1,6}$/.test(value)) return undefined
  return Number(value)
}

/** Server error codes this client knows; anything else is a generic error. */
const KNOWN_CODES: Record<string, Failure['outcome']> = {
  flow_invalid_or_expired: 'flow_expired',
  token_invalid: 'token_invalid',
  interaction_required: 'interaction_required',
  revoked: 'revoked',
  pilot_only: 'pilot_only',
  link_required: 'link_required',
  identity_in_use: 'identity_in_use',
  account_deleted: 'account_deleted',
  surface_unavailable: 'surface_unavailable',
  identity_mismatch: 'identity_mismatch',
  sign_in_required: 'sign_in_required',
  signup_unavailable: 'signup_unavailable',
  try_later: 'try_later',
}

function serverFailure(result: Http): Failure {
  const code = object(result.body).error
  const known = typeof code === 'string' && Object.prototype.hasOwnProperty.call(KNOWN_CODES, code) ? KNOWN_CODES[code] : undefined
  if (known) return { outcome: known, ...(result.retryAfterSeconds !== undefined ? { retryAfterSeconds: result.retryAfterSeconds } : {}) }
  if (result.status === 429) return { outcome: 'try_later', ...(result.retryAfterSeconds !== undefined ? { retryAfterSeconds: result.retryAfterSeconds } : {}) }
  // 404 is "routes not mounted"; 503 request_unavailable is an outage.
  if (result.status === 404 || result.status === 503) return { outcome: 'unavailable' }
  return { outcome: 'error' }
}

function thrownFailure(error: unknown): Failure {
  if (error instanceof AccountRequestNotSent) return { outcome: 'hosted_only' }
  const message = error instanceof Error ? error.message : ''
  if (message === 'account_authorization_required' || message === 'account_identity_changed') return { outcome: 'sign_in_required' }
  if (message === 'account_temporarily_unavailable') return { outcome: 'unavailable' }
  if (message === 'account_response_invalid') return { outcome: 'error' }
  return { outcome: 'network' }
}

/**
 * Only `sign_in_required` means the device bearer itself was refused. A 401
 * for an expired flow or a bad ID token must not make the coordinator drop a
 * good link.
 */
function bearerStatus(result: Http): number {
  return result.status === 401 && object(result.body).error !== 'sign_in_required' ? 400 : result.status
}

const signedIn = (account: SupporterAccountState) => account.state === 'linked' || (account.state === 'unavailable' && account.linked === true)

/** Bearer-only reasons cannot come from the sign-in routes; never show them as such. */
function signInOutcome(value: Failure['outcome']): TwitchSignInOutcome {
  return value === 'sign_in_required' || value === 'identity_mismatch' ? 'error' : value
}

export class TwitchSignIn {
  private active = false

  constructor(private ports: TwitchSignInPorts) {}

  get available(): boolean { return typeof this.ports.launchWebAuthFlow === 'function' }

  /** Record a true first install; the only state in which silent sign-in may run. */
  async markFirstInstall(): Promise<void> {
    if (!this.ports.enabled) return
    await this.ports.meta.write({ ...NO_META, firstInstallPending: true } satisfies TwitchSignInMeta)
  }

  /** Every user sign-out: silent sign-in never runs again until a click signs in. */
  async markSignedOutByUser(): Promise<void> {
    if (!this.ports.enabled) return
    const meta = await this.readMeta()
    await this.ports.meta.write({ ...meta, firstInstallPending: false, signedOutByUser: true } satisfies TwitchSignInMeta)
    await this.ports.profile.write(null).catch(() => undefined)
  }

  async status(): Promise<TwitchSignInResponse> {
    const account = await this.ports.account.run('status')
    return this.respond(account)
  }

  async signIn(mode: TwitchSignInMode, forceVerify = false): Promise<TwitchSignInResponse> {
    if (!this.ports.enabled) return this.respond(await this.ports.account.run('status'), { outcome: 'disabled' })
    if (!this.available) return this.respond(await this.ports.account.run('status'), { outcome: 'unsupported' })
    if (mode === 'silent' && forceVerify) return this.respond(await this.ports.account.run('status'), { outcome: 'error' })
    if (this.active) return this.respond(await this.ports.account.run('status'), { outcome: 'busy' })
    this.active = true
    try {
      return mode === 'silent' ? await this.silent() : await this.interactive(forceVerify)
    } catch (error) {
      return this.respond(await this.ports.account.run('status'), { outcome: signInOutcome(thrownFailure(error).outcome) })
    } finally {
      this.active = false
    }
  }

  /**
   * Prove, with a fresh ID token, that the person holding this device is the
   * account's Twitch identity. For sensitive bearer routes that answer 403
   * `recent_auth_required` (see `requiresStepUp`): try `silent` first, then
   * `interactive` from a click. The Supporter coordinator calls it when the
   * subscription portal asks for a recent Twitch check.
   */
  async stepUp(mode: TwitchSignInMode = 'silent'): Promise<TwitchStepUpResult> {
    if (!this.ports.enabled) return { ok: false, error: 'disabled' }
    if (!this.available) return { ok: false, error: 'unsupported' }
    if (this.active) return { ok: false, error: 'busy' }
    this.active = true
    try {
      return await this.runStepUp(mode)
    } finally {
      this.active = false
    }
  }

  /**
   * Sign out everywhere: POST /v1/account/sessions/revoke-all with this
   * device's bearer. The server ends every web session and extension device
   * of the account and blocks silent sign-in. It needs a recent Twitch check
   * on this device (403 `recent_auth_required`), handled as Manage
   * subscription does: one silent check (or, from a click, the Twitch window)
   * and one retry, never a loop. A check that names another Twitch account
   * signs nothing out.
   *
   * After a 204 this extension is signed out too, as after Sign out: the
   * credential is forgotten and silent sign-in stays off until a click.
   */
  async signOutEverywhere(mode: TwitchSignInMode = 'silent'): Promise<TwitchSignInResponse> {
    const reply = async (everywhere: TwitchSignOutEverywhereResult, account?: SupporterAccountState, retryAfterSeconds?: number) => {
      const response = await this.respond(account ?? await this.ports.account.run('status'), retryAfterSeconds !== undefined ? { retryAfterSeconds } : {})
      response.everywhere = everywhere
      return response
    }
    if (!this.ports.enabled) return reply('disabled')
    if (this.active) return reply('busy')
    this.active = true
    try {
      const account = await this.ports.account.run('status')
      if (account.state === 'unavailable' && account.linked) return await reply('unavailable', account)
      if (account.state !== 'linked') return await reply('sign_in_required', account)
      const accountId = account.accountId
      const revokeAll = () => this.ports.account.withCredential(async token => {
        const result = await this.post('/v1/account/sessions/revoke-all', {}, token)
        return { status: result.status, result }
      }, accountId)
      let answer: Http
      try {
        answer = (await revokeAll()).result
        if (requiresStepUp(answer)) {
          if (!this.available) return await reply('step_up_required')
          const proof = await this.runStepUp(mode)
          if (!proof.ok) {
            if (proof.error === 'identity_mismatch') return await reply('wrong_account')
            if (proof.error === 'sign_in_required') return await reply('sign_in_required')
            if (mode === 'silent' || proof.error === 'cancelled' || proof.error === 'interaction_required' || proof.error === 'busy') return await reply('step_up_required')
            if (proof.error === 'try_later') return await reply('try_later', undefined, proof.retryAfterSeconds)
            if (proof.error === 'network') return await reply('failed')
            if (proof.error === 'unavailable') return await reply('unavailable')
            // The Twitch window, flow or reply did not finish; revoke-all was not retried.
            return await reply('step_up_failed')
          }
          answer = (await revokeAll()).result
          if (requiresStepUp(answer)) return await reply('step_up_required')
        }
      } catch (error) {
        // A 401 has already cleared this device's credential (withCredential).
        const { outcome } = thrownFailure(error)
        return await reply(outcome === 'sign_in_required' ? 'sign_in_required' : outcome === 'unavailable' || outcome === 'error' ? 'unavailable' : 'failed')
      }
      if (answer.status === 204) {
        await this.markSignedOutByUser().catch(() => undefined)
        const forgotten = this.ports.account.forgetSignedOutEverywhere
          ? await this.ports.account.forgetSignedOutEverywhere(accountId)
          : await this.ports.account.run('disconnect')
        return await reply('signed_out_everywhere', forgotten)
      }
      if (answer.status === 404) return await reply('not_available')
      if (answer.status === 429) return await reply('try_later', undefined, answer.retryAfterSeconds)
      // The service answered, so the connection is fine: 503 request_unavailable,
      // another 5xx, or a status this client does not expect.
      return await reply('unavailable')
    } catch {
      return reply('failed')
    } finally {
      this.active = false
    }
  }

  /**
   * Seen in chat opt-in: a fresh Twitch check that ends in one consent action.
   *
   * start-device with purpose `badge` (bound to this device's bearer, like a
   * step-up) → the Twitch window → POST /v1/account/auth/twitch/badge with the
   * ID token and the consent version the card showed. The server verifies the
   * token, checks it is this account's Twitch identity and that the account is
   * an active Supporter, and only then stores and publishes the Twitch user ID
   * and login, so a tampered client cannot publish anyone else's. Always
   * interactive: consent comes from a click, never a silent check.
   */
  async confirmForBadge(badge: { consentVersion: number; wave: SupporterWave }): Promise<TwitchBadgeResult> {
    if (!this.ports.enabled || !this.available) return { ok: false, error: 'unavailable' }
    if (this.active) return { ok: false, error: 'busy' }
    this.active = true
    try {
      const account = await this.ports.account.run('status')
      if (account.state === 'unavailable' && account.linked) return { ok: false, error: 'unavailable' }
      if (account.state !== 'linked') return { ok: false, error: 'sign_in_required' }
      const started = await this.ports.account.withCredential(async token => {
        const result = await this.post('/v1/account/auth/twitch/start-device', { surface: this.ports.surface, purpose: 'badge', mode: 'interactive', forceVerify: false }, token)
        return { status: bearerStatus(result), result }
      }, account.accountId)
      const flow = this.parseStart(started.result)
      if (failure(flow)) return badgeFailure(flow, started.result)
      const proof = await this.authorize(flow, 'interactive')
      if (failure(proof)) return badgeFailure(proof)
      const finished = await this.ports.account.withCredential(async token => {
        const result = await this.post('/v1/account/auth/twitch/badge', { flowId: flow.flowId, flowSecret: flow.flowSecret, idToken: proof, badge: { consentVersion: badge.consentVersion, wave: badge.wave } }, token)
        return { status: bearerStatus(result), result }
      }, account.accountId)
      const body = object(finished.result.body)
      if (finished.result.status === 200 && body.status === 'badge_on') {
        const chatBadge = parseChatBadgeSnapshot(body.chatBadge)
        return { ok: true, ...(isChatBadgeEntry(body.own) ? { own: body.own } : {}), ...(chatBadge ? { chatBadge } : {}) }
      }
      if (finished.result.status === 200) return { ok: false, error: 'error' }
      return badgeFailure(serverFailure(finished.result), finished.result)
    } catch (error) {
      return badgeFailure(thrownFailure(error))
    } finally {
      this.active = false
    }
  }

  /** One step-up round; the caller holds `active`. */
  private async runStepUp(mode: TwitchSignInMode): Promise<TwitchStepUpResult> {
    if (!this.available) return { ok: false, error: 'unsupported' }
    try {
      const account = await this.ports.account.run('status')
      if (account.state === 'unavailable' && account.linked) return { ok: false, error: 'unavailable' }
      if (account.state !== 'linked') return { ok: false, error: 'sign_in_required' }
      const started = await this.ports.account.withCredential(async token => {
        const result = await this.post('/v1/account/auth/twitch/start-device', { surface: this.ports.surface, purpose: 'stepup', mode, forceVerify: false }, token)
        return { status: bearerStatus(result), result }
      }, account.accountId)
      const flow = this.parseStart(started.result)
      if (failure(flow)) return stepUpFailure(flow)
      const proof = await this.authorize(flow, mode)
      if (failure(proof)) return stepUpFailure(proof)
      const finished = await this.ports.account.withCredential(async token => {
        const result = await this.post('/v1/account/auth/twitch/stepup', { flowId: flow.flowId, flowSecret: flow.flowSecret, idToken: proof }, token)
        return { status: bearerStatus(result), result }
      }, account.accountId)
      const body = object(finished.result.body)
      if (finished.result.status === 200 && body.status === 'step_up_granted' && date(body.expiresAt)) return { ok: true, expiresAt: body.expiresAt }
      if (finished.result.status === 200) return { ok: false, error: 'error' }
      return stepUpFailure(serverFailure(finished.result))
    } catch (error) {
      return stepUpFailure(thrownFailure(error))
    }
  }

  private async silent(): Promise<TwitchSignInResponse> {
    const meta = await this.readMeta()
    const account = await this.ports.account.run('status')
    if (!meta.firstInstallPending || meta.signedOutByUser || meta.serverRevoked || account.state !== 'signed_out') {
      // Not allowed: never touch the network. A connection already present ends the first-install window.
      if (meta.firstInstallPending && account.state !== 'signed_out') await this.writeMeta({ ...meta, firstInstallPending: false })
      return this.respond(account, { outcome: signedIn(account) ? 'already_signed_in' : 'interaction_required' })
    }
    // Spend the one silent attempt before any I/O, so a crash cannot loop it.
    await this.writeMeta({ ...meta, firstInstallPending: false })
    const result = await this.attempt('silent', false)
    if (result.outcome === 'revoked') await this.writeMeta({ ...(await this.readMeta()), serverRevoked: true }).catch(() => undefined)
    // Silent ends only in success or "needs a click"; the reason stays internal.
    if (result.outcome !== 'signed_in') return this.respond(result.account ?? await this.ports.account.run('status'), { outcome: result.outcome === 'revoked' ? 'revoked' : 'interaction_required' })
    return this.respond(result.account!, { outcome: 'signed_in' })
  }

  private async interactive(forceVerify: boolean): Promise<TwitchSignInResponse> {
    let account = await this.ports.account.run('status')
    if (account.state === 'error' && account.revocationPending) return this.respond(account, { outcome: 'revocation_pending' })
    if (signedIn(account)) {
      if (!forceVerify) return this.respond(account, { outcome: 'already_signed_in' })
      // "Not you?": sign this identity out first, then choose an account.
      await this.markSignedOutByUser()
      account = await this.ports.account.run('disconnect')
      if (account.state !== 'signed_out') return this.respond(account, { outcome: account.state === 'error' && account.revocationPending ? 'revocation_pending' : 'network' })
    } else if (account.state === 'pending') {
      // A device-link code in progress gives way to this sign-in.
      account = await this.ports.account.run('cancel')
    }
    const result = await this.attempt('interactive', forceVerify)
    if (result.outcome === 'signed_in') {
      // Already signed in: a failed marker write must not report a failure.
      const meta = await this.readMeta()
      await this.writeMeta({ ...meta, firstInstallPending: false, signedOutByUser: false, serverRevoked: false }).catch(() => undefined)
    }
    return this.respond(result.account ?? await this.ports.account.run('status'), { outcome: signInOutcome(result.outcome), retryAfterSeconds: result.retryAfterSeconds })
  }

  /** One complete start → window → device round. */
  private async attempt(mode: TwitchSignInMode, forceVerify: boolean): Promise<Failure & { account?: SupporterAccountState }> {
    const generation = this.ports.account.identityGeneration
    let started: Http
    try {
      started = await this.post('/v1/account/auth/twitch/start-device', { surface: this.ports.surface, purpose: 'signin', mode, forceVerify })
    } catch (error) { return thrownFailure(error) }
    const flow = this.parseStart(started)
    if (failure(flow)) return flow
    const idToken = await this.authorize(flow, mode)
    if (failure(idToken)) return idToken
    let finished: Http
    try {
      finished = await this.post('/v1/account/auth/twitch/device', { flowId: flow.flowId, flowSecret: flow.flowSecret, idToken })
    } catch (error) { return thrownFailure(error) }
    if (finished.status !== 200) return serverFailure(finished)
    const profile = parseTwitchProfile(object(finished.body).profile)
    const { adopted, account } = await this.ports.account.adopt(finished.body, generation)
    if (!adopted) {
      if (account.state === 'error' && account.revocationPending) return { outcome: 'revocation_pending', account }
      return { outcome: account.state === 'linked' ? 'already_signed_in' : 'error', account }
    }
    if (profile && account.state === 'linked') await this.ports.profile.write({ accountId: account.accountId, ...profile }).catch(() => undefined)
    return { outcome: 'signed_in', account }
  }

  private parseStart(result: Http): Flow | Failure {
    if (result.status !== 201) return serverFailure(result)
    const body = object(result.body)
    const flowId = body.flowId
    const flowSecret = body.flowSecret
    if (typeof flowId !== 'string' || !/^[a-f0-9]{32}$/.test(flowId) || typeof flowSecret !== 'string' || !/^[a-f0-9]{64}$/.test(flowSecret) || typeof body.authorizeUrl !== 'string') return { outcome: 'error' }
    let authorize: URL
    try { authorize = new URL(body.authorizeUrl) } catch { return { outcome: 'error' } }
    const params = authorize.searchParams
    const redirectUri = params.get('redirect_uri') ?? ''
    if (authorize.protocol !== 'https:' || authorize.host !== 'id.twitch.tv' || authorize.pathname !== '/oauth2/authorize'
      || authorize.username || authorize.password || authorize.hash
      || params.get('state') !== flowId || params.get('response_type') !== 'id_token' || !redirectUri) return { outcome: 'error' }
    let redirect: URL
    try { redirect = new URL(redirectUri) } catch { return { outcome: 'error' } }
    // An extension redirect for another extension ID would leave the window
    // stranded on a page that never completes the flow.
    const expected = this.expectedRedirectHost()
    if (expected && /\.(chromiumapp\.org|extensions\.allizom\.org)$/.test(redirect.hostname) && redirect.hostname !== expected) return { outcome: 'redirect_mismatch' }
    return { flowId, flowSecret, authorizeUrl: authorize.toString(), redirectUri }
  }

  private expectedRedirectHost(): string | null {
    try { return this.ports.redirectUrl ? new URL(this.ports.redirectUrl()).hostname : null } catch { return null }
  }

  /** Run the window and return the verified-state ID token. */
  private async authorize(flow: Flow, mode: TwitchSignInMode): Promise<string | Failure> {
    const silent = mode === 'silent'
    let responseUrl: string | undefined
    try {
      responseUrl = await this.ports.launchWebAuthFlow!({
        url: flow.authorizeUrl,
        interactive: !silent,
        ...(silent && this.ports.chromium ? { abortOnLoadForNonInteractive: false, timeoutMsForNonInteractive: SILENT_TIMEOUT_MS } : {}),
      })
    } catch (error) {
      if (silent) return { outcome: 'interaction_required' }
      const message = error instanceof Error ? error.message : String(error)
      return { outcome: /did not approve|cancel|denied|closed/i.test(message) ? 'cancelled' : 'auth_window_failed' }
    }
    return parseAuthorizeRedirect(responseUrl, flow, mode)
  }

  private async post(path: string, body: Record<string, unknown>, bearer?: string): Promise<Http> {
    // Account credentials never follow a developer-selected backend address.
    if (!await this.ports.hosted()) throw new AccountRequestNotSent('account_hosted_only')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (bearer) headers.Authorization = `Bearer ${bearer}`
    const response = await this.ports.fetch(`${this.ports.apiOrigin}${path}`, {
      method: 'POST', headers, body: JSON.stringify(body),
      credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12_000),
    })
    const text = await response.text()
    if (text.length > MAX_RESPONSE) throw new Error('account_response_invalid')
    let data: unknown = null
    try { data = text ? JSON.parse(text) : null } catch { /* the status still says enough */ }
    const seconds = retryAfter(response.headers.get('Retry-After'))
    return { status: response.status, body: data, ...(seconds !== undefined ? { retryAfterSeconds: seconds } : {}) }
  }

  private async respond(account: SupporterAccountState, extra: { outcome?: TwitchSignInOutcome; retryAfterSeconds?: number } = {}): Promise<TwitchSignInResponse> {
    const response: TwitchSignInResponse = { type: 'TWITCH_SIGN_IN', status: await this.snapshot(account), account }
    if (extra.outcome) response.outcome = extra.outcome
    if (extra.retryAfterSeconds !== undefined) response.retryAfterSeconds = extra.retryAfterSeconds
    return response
  }

  private async snapshot(account: SupporterAccountState): Promise<TwitchSignInStatus> {
    const meta = await this.readMeta()
    let profile: TwitchProfile | null = null
    if (account.state === 'linked') {
      const stored = object(await this.ports.profile.read().catch(() => null))
      if (stored.accountId === account.accountId) profile = parseTwitchProfile(stored)
    } else if (account.state === 'signed_out' || account.state === 'relink_required' || account.state === 'denied' || account.state === 'expired') {
      await this.ports.profile.write(null).catch(() => undefined)
    }
    return {
      enabled: this.ports.enabled,
      available: this.available,
      silentEligible: this.ports.enabled && this.available && account.state === 'signed_out'
        && meta.firstInstallPending && !meta.signedOutByUser && !meta.serverRevoked,
      profile,
    }
  }

  private async readMeta(): Promise<TwitchSignInMeta> {
    try { return parseTwitchSignInMeta(await this.ports.meta.read()) } catch { return { ...NO_META } }
  }

  private async writeMeta(meta: TwitchSignInMeta): Promise<void> {
    await this.ports.meta.write(meta)
  }
}

/** Parse the redirect the window ended on. The ID token must come from the fragment. */
export function parseAuthorizeRedirect(responseUrl: string | undefined, flow: { flowId: string; redirectUri: string }, mode: TwitchSignInMode): string | Failure {
  let url: URL
  let expected: URL
  try {
    url = new URL(responseUrl ?? '')
    expected = new URL(flow.redirectUri)
  } catch { return { outcome: mode === 'silent' ? 'interaction_required' : 'error' } }
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) return { outcome: 'error' }
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''))
  const state = fragment.get('state') ?? url.searchParams.get('state')
  const error = fragment.get('error') ?? url.searchParams.get('error')
  if (error) {
    // An error redirect carries nothing to accept; a foreign state is still reported.
    if (state !== null && state !== flow.flowId) return { outcome: 'state_mismatch' }
    return { outcome: mode === 'silent' ? 'interaction_required' : error === 'access_denied' ? 'cancelled' : 'error' }
  }
  if (state !== flow.flowId) return { outcome: 'state_mismatch' }
  const idToken = fragment.get('id_token')
  if (!idToken || idToken.length > MAX_ID_TOKEN || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(idToken)) return { outcome: 'error' }
  return idToken
}

export type TwitchBadgeResult =
  | { ok: true; own?: ChatBadgeEntry; chatBadge?: ChatBadgeSnapshot }
  | { ok: false; error: ChatBadgeActionError; retryAfterSeconds?: number }

/** Server codes the badge action adds to the sign-in ones. */
const BADGE_CODES: ReadonlySet<string> = new Set(['identity_mismatch', 'supporter_required', 'consent_outdated', 'pilot_only', 'twitch_in_use'])

function badgeFailure(value: Failure, result?: Http): TwitchBadgeResult {
  const code = result ? object(result.body).error : undefined
  if (typeof code === 'string' && BADGE_CODES.has(code)) return { ok: false, error: code as ChatBadgeActionError }
  // 400 invalid_request from start-device, or 404 from the badge route: the feature is off on the server.
  if (result && (result.status === 404 || (result.status === 400 && code === 'invalid_request'))) return { ok: false, error: 'unavailable' }
  const outcome = value.outcome
  if (outcome === 'cancelled' || outcome === 'interaction_required') return { ok: false, error: 'cancelled' }
  if (outcome === 'identity_mismatch' || outcome === 'sign_in_required' || outcome === 'pilot_only' || outcome === 'network' || outcome === 'unavailable') return { ok: false, error: outcome }
  if (outcome === 'try_later') return { ok: false, error: 'try_later', ...(value.retryAfterSeconds !== undefined ? { retryAfterSeconds: value.retryAfterSeconds } : {}) }
  if (outcome === 'hosted_only') return { ok: false, error: 'unavailable' }
  return { ok: false, error: 'error' }
}

const STEP_UP_ERRORS: ReadonlySet<string> = new Set<TwitchStepUpError>([
  'interaction_required', 'cancelled', 'state_mismatch', 'token_invalid', 'flow_expired', 'account_deleted', 'try_later',
  'surface_unavailable', 'redirect_mismatch', 'auth_window_failed', 'network', 'unavailable', 'hosted_only', 'busy',
  'disabled', 'unsupported', 'error', 'sign_in_required', 'identity_mismatch',
])

function stepUpFailure(value: Failure): TwitchStepUpResult {
  const error = (STEP_UP_ERRORS.has(value.outcome) ? value.outcome : 'error') as TwitchStepUpError
  return value.retryAfterSeconds !== undefined ? { ok: false, error, retryAfterSeconds: value.retryAfterSeconds } : { ok: false, error }
}
