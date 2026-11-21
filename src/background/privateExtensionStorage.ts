// Account and device records share the existing extension-origin database.
// Twitch content scripts use the page origin's IndexedDB.
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pulse-account-private-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('account')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('account_storage_unavailable'))
  })
}

async function access(key: string, write: boolean, value?: unknown): Promise<unknown> {
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

export function readPrivateRecord(key: string): Promise<unknown> {
  return access(key, false)
}

export async function writePrivateRecord(key: string, value: unknown): Promise<void> {
  await access(key, true, value)
}
