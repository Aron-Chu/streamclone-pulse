import { DEFAULT_BACKEND_URL, getBackendUrl } from '../shared/storage.ts'
import { SupporterAccountCoordinator } from './supporterAccount.ts'

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
async function access(write: boolean, value?: unknown): Promise<unknown> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('account', write ? 'readwrite' : 'readonly')
      const store = transaction.objectStore('account')
      const request = write ? value == null ? store.delete(DEFAULT_BACKEND_URL) : store.put(value, DEFAULT_BACKEND_URL) : store.get(DEFAULT_BACKEND_URL)
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = transaction.onabort = () => reject(new Error('account_storage_unavailable'))
    })
  } finally { db.close() }
}
export const supporterAccount = new SupporterAccountCoordinator({
  // Only an invalidation signal is public, never an account ID or credential.
  identityChanged: async () => { await chrome.storage.local.set({ pulseAccountRevision: crypto.randomUUID() }) },
  read: () => access(false),
  write: async value => { await access(true, value) },
  request: async (path, body, bearer) => {
    // Account credentials cannot follow a developer-selected backend address.
    if (await getBackendUrl() !== DEFAULT_BACKEND_URL) throw new Error('account_hosted_only')
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
