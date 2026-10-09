import { DEFAULT_BACKEND_URL, getBackendUrl } from '../shared/storage.ts'
import { ACCOUNT_REVISION_KEY, SUPPORTER_REVISION_KEY } from '../shared/supporterAccount.ts'
import { TWITCH_SIGNIN_ENABLED, type TwitchSignInMode, type TwitchStepUpResult } from '../shared/twitchSignIn.ts'
import { AccountRequestNotSent, SupporterAccountCoordinator } from './supporterAccount.ts'
import { SupporterPayFirstCoordinator } from './supporterPayFirst.ts'

const ACCOUNT_BACKEND_URL = typeof __EXTENSION_STORE_BUILD__ !== 'undefined' && __EXTENSION_STORE_BUILD__ ? DEFAULT_BACKEND_URL
  : typeof __SUPPORTER_BACKEND_ORIGIN__ !== 'undefined' ? __SUPPORTER_BACKEND_ORIGIN__ : DEFAULT_BACKEND_URL

// Extension-origin IndexedDB is unavailable to Twitch content scripts. Do not
// move this record to sync storage or send it through a UI message.
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pulse-account-private-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('account')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('account_storage_unavailable'))
  })
}
// The pre-purchase finish choice is not a credential, but a Twitch page must not
// be able to set it, so it lives beside the account record rather than in
// storage that content scripts can write.
const FINISH_INTENT_KEY = 'supporter-finish-intent'
const INSTALLATION_KEY = 'supporter-installation-key'
const JOURNEY_KEY = 'supporter-pay-first'
async function access(write: boolean, value?: unknown, key: string = DEFAULT_BACKEND_URL): Promise<unknown> {
  // The unpacked local sandbox has no access to the production record or any
  // bootstrap/restore key kept by a development build with the usual origin.
  const privateKey = ACCOUNT_BACKEND_URL === DEFAULT_BACKEND_URL ? key : `${ACCOUNT_BACKEND_URL}:${key}`
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('account', write ? 'readwrite' : 'readonly')
      const store = transaction.objectStore('account')
      const request = write ? value == null ? store.delete(privateKey) : store.put(value, privateKey) : store.get(privateKey)
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = transaction.onabort = () => reject(new Error('account_storage_unavailable'))
    })
  } finally { db.close() }
}

/** Sign in with Twitch markers (never credentials) share the private store under their own key. */
/**
 * myMoments binds the removal of an account's local copy here; it imports this
 * module, so the coordinator below cannot import it back.
 */
let accountDataForget: ((accountId: string) => void) | undefined
export function bindAccountDataForget(forget: (accountId: string) => void): void {
  accountDataForget = forget
}

const TWITCH_SIGN_IN_META_KEY = `twitch-signin-meta-v1:${DEFAULT_BACKEND_URL}`
export const twitchSignInMetaRecord = {
  read: () => access(false, undefined, TWITCH_SIGN_IN_META_KEY),
  write: async (value: unknown) => { await access(true, value, TWITCH_SIGN_IN_META_KEY) },
}
export const supporterAccount = new SupporterAccountCoordinator({
  // Only an invalidation signal is public, never an account ID or credential.
  identityChanged: async () => { await supporterPayFirst.reconcileIdentity(); await chrome.storage.local.set({ [ACCOUNT_REVISION_KEY]: crypto.randomUUID() }) },
  projectionChanged: async () => { await chrome.storage.local.set({ [SUPPORTER_REVISION_KEY]: crypto.randomUUID() }) },
  readIntent: () => access(false, undefined, FINISH_INTENT_KEY),
  writeIntent: async value => { await access(true, value, FINISH_INTENT_KEY) },
  readInstallationKey: () => access(false, undefined, INSTALLATION_KEY),
  writeInstallationKey: async value => { await access(true, value, INSTALLATION_KEY) },
  accountForgotten: accountId => accountDataForget?.(accountId),
  // Store builds honour only live billing, so a sandbox purchase never unlocks
  // anything for real users; development builds may test against either.
  environments: typeof __EXTENSION_STORE_BUILD__ !== 'undefined' && __EXTENSION_STORE_BUILD__ ? ['live'] : ['live', 'sandbox'],
  read: () => access(false),
  write: async value => { await access(true, value) },
  request: accountRequest,
})
/** Network budget includes the deliberately indistinguishable restore response. */
export function accountRequestDeadlineMs(path: string): number {
  return path === '/v1/billing/checkout' || path === '/v1/billing/portal' ? 40_000
    : path === '/v1/account/restores' ? 25_000 : 12_000
}
export async function accountRequest(path: string, body?: Record<string, unknown>, bearer?: string): Promise<{ status: number; body: unknown; retryAfterMs?: number }> {
    // Account credentials cannot follow a dynamically selected backend. The
    // isolated local sandbox is an explicit, immutable development build.
    if (ACCOUNT_BACKEND_URL === DEFAULT_BACKEND_URL && await getBackendUrl() !== DEFAULT_BACKEND_URL) throw new AccountRequestNotSent('account_hosted_only')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    // The installation credential is a bearer, never a cookie: this request
    // sends credentials: 'omit', so no ambient browser session is involved.
    if (bearer) headers.Authorization = `Bearer ${bearer}`
    const response = await fetch(`${ACCOUNT_BACKEND_URL}${path}`, {
      method: body ? 'POST' : 'GET', headers,
      body: body ? JSON.stringify(body) : undefined, credentials: 'omit', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(accountRequestDeadlineMs(path)),
    })
    const text = await response.text()
    if (text.length > 16_384) throw new Error('account_response_invalid')
    let data: unknown = null
    try { data = text ? JSON.parse(text) : null } catch { /* HTTP status still conveys unavailability. */ }
    const retry = response.headers.get('Retry-After')
    const retryAfterMs = retry && /^\d+$/.test(retry) ? Math.min(86_400_000, Math.max(5000, Number(retry) * 1000)) : retry ? Math.min(86_400_000, Math.max(5000, Date.parse(retry) - Date.now())) : undefined
    return { status: response.status, body: data, ...(Number.isFinite(retryAfterMs) ? { retryAfterMs } : {}) }
}
export const supporterPayFirst = new SupporterPayFirstCoordinator({
  account: supporterAccount,
  request: accountRequest,
  read: () => access(false, undefined, JOURNEY_KEY),
  write: async value => { await access(true, value, JOURNEY_KEY) },
  open: async url => { await chrome.tabs.create({ url }) },
  changed: async () => { await chrome.storage.local.set({ [SUPPORTER_REVISION_KEY]: crypto.randomUUID() }) },
  twitchSignIn: TWITCH_SIGNIN_ENABLED,
  stepUp: mode => twitchStepUp ? twitchStepUp(mode) : Promise.resolve({ ok: false, error: 'unavailable' }),
})

/**
 * twitchSignInRuntime binds its step-up here; it imports this module, so the
 * coordinator above cannot import it back.
 */
let twitchStepUp: ((mode: TwitchSignInMode) => Promise<TwitchStepUpResult>) | undefined
export function bindTwitchStepUp(stepUp: (mode: TwitchSignInMode) => Promise<TwitchStepUpResult>): void {
  twitchStepUp = stepUp
}

/**
 * While a link request waits, the worker collects the approval itself, so it
 * does not depend on settings or a Twitch tab being open when the user approves
 * on the website. Bounded by the request's own ten-minute life: it stops as soon
 * as the request is approved, declined, expired or cancelled. The extension API
 * call each tick keeps the MV3 worker alive for that bounded wait only.
 */
const LINK_WATCH_MS = 5_000
let linkWatch: ReturnType<typeof setTimeout> | undefined
export function watchPendingLink(): void {
  if (linkWatch !== undefined) return
  const tick = async () => {
    const state = await supporterAccount.run('status').catch(() => null)
    await supporterPayFirst.tick().catch(() => undefined)
    if (state?.state !== 'pending' && !await supporterPayFirst.hasPending().catch(() => false)) { linkWatch = undefined; return }
    await chrome.runtime.getPlatformInfo().catch(() => undefined)
    linkWatch = setTimeout(() => { void tick() }, LINK_WATCH_MS)
  }
  linkWatch = setTimeout(() => { void tick() }, LINK_WATCH_MS)
}
/** A worker that restarted mid-link resumes collecting it. */
export async function resumePendingLink(): Promise<void> {
  if (await supporterAccount.hasPendingLink().catch(() => false) || await supporterPayFirst.hasPending().catch(() => false)) watchPendingLink()
}
