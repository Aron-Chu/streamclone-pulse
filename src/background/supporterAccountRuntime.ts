import { DEFAULT_BACKEND_URL, getBackendUrl } from '../shared/storage.ts'
import { AccountRequestNotSent, SupporterAccountCoordinator } from './supporterAccount.ts'

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

/** Sign in with Twitch markers (never credentials) share the private store under their own key. */
const TWITCH_SIGN_IN_META_KEY = `twitch-signin-meta-v1:${DEFAULT_BACKEND_URL}`
export const twitchSignInMetaRecord = {
  read: () => access(false, undefined, TWITCH_SIGN_IN_META_KEY),
  write: async (value: unknown) => { await access(true, value, TWITCH_SIGN_IN_META_KEY) },
}
export const supporterAccount = new SupporterAccountCoordinator({
  // Only an invalidation signal is public, never an account ID or credential.
  identityChanged: async () => { await chrome.storage.local.set({ pulseAccountRevision: crypto.randomUUID() }) },
  // Store builds honour only live billing, so a sandbox purchase never unlocks
  // anything for real users; development builds may test against either.
  environments: typeof __EXTENSION_STORE_BUILD__ !== 'undefined' && __EXTENSION_STORE_BUILD__ ? ['live'] : ['live', 'sandbox'],
  read: () => access(false),
  write: async value => { await access(true, value) },
  request: async (path, body, bearer) => {
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
  },
})
