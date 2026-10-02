import { DEFAULT_BACKEND_URL, getBackendUrl } from '../shared/storage.ts'
import { ACCOUNT_REVISION_KEY, SUPPORTER_REVISION_KEY } from '../shared/supporterAccount.ts'
import { AccountRequestNotSent, SupporterAccountCoordinator } from './supporterAccount.ts'
import { SupporterPayFirstCoordinator } from './supporterPayFirst.ts'

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
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('account', write ? 'readwrite' : 'readonly')
      const store = transaction.objectStore('account')
      const request = write ? value == null ? store.delete(key) : store.put(value, key) : store.get(key)
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = transaction.onabort = () => reject(new Error('account_storage_unavailable'))
    })
  } finally { db.close() }
}
export const supporterAccount = new SupporterAccountCoordinator({
  // Only an invalidation signal is public, never an account ID or credential.
  identityChanged: async () => { await chrome.storage.local.set({ [ACCOUNT_REVISION_KEY]: crypto.randomUUID() }) },
  projectionChanged: async () => { await chrome.storage.local.set({ [SUPPORTER_REVISION_KEY]: crypto.randomUUID() }) },
  readIntent: () => access(false, undefined, FINISH_INTENT_KEY),
  writeIntent: async value => { await access(true, value, FINISH_INTENT_KEY) },
  readInstallationKey: () => access(false, undefined, INSTALLATION_KEY),
  writeInstallationKey: async value => { await access(true, value, INSTALLATION_KEY) },
  // Store builds honour only live billing, so a sandbox purchase never unlocks
  // anything for real users; development builds may test against either.
  environments: typeof __EXTENSION_STORE_BUILD__ !== 'undefined' && __EXTENSION_STORE_BUILD__ ? ['live'] : ['live', 'sandbox'],
  read: () => access(false),
  write: async value => { await access(true, value) },
  request: accountRequest,
})
export async function accountRequest(path: string, body?: Record<string, unknown>, bearer?: string): Promise<{ status: number; body: unknown }> {
    // Account credentials cannot follow a developer-selected backend address.
    if (await getBackendUrl() !== DEFAULT_BACKEND_URL) throw new AccountRequestNotSent('account_hosted_only')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    // The installation credential is a bearer, never a cookie: this request
    // sends credentials: 'omit', so no ambient browser session is involved.
    if (bearer) headers.Authorization = `Bearer ${bearer}`
    const response = await fetch(`${DEFAULT_BACKEND_URL}${path}`, {
      method: body ? 'POST' : 'GET', headers,
      body: body ? JSON.stringify(body) : undefined, credentials: 'omit', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    })
    const text = await response.text()
    if (text.length > 16_384) throw new Error('account_response_invalid')
    let data: unknown = null
    try { data = text ? JSON.parse(text) : null } catch { /* HTTP status still conveys unavailability. */ }
    return { status: response.status, body: data }
}
export const supporterPayFirst = new SupporterPayFirstCoordinator({
  account: supporterAccount,
  request: accountRequest,
  read: () => access(false, undefined, JOURNEY_KEY),
  write: async value => { await access(true, value, JOURNEY_KEY) },
  open: async url => { await chrome.tabs.create({ url }) },
  changed: async () => { await chrome.storage.local.set({ [SUPPORTER_REVISION_KEY]: crypto.randomUUID() }) },
})

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
