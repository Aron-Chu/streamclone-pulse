import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Synced history (`/v1/account/history/*`) goes to the same origin as the
 * account credential: the local backend in a development build pinned to one,
 * production in every store build. See accountOriginDevBuild.test.ts.
 */
const PRODUCTION = 'https://api.streampulse.stream'
const LOCAL = 'http://127.0.0.1:14191'
const accountId = '22222222-2222-4222-8222-222222222222'
vi.mock('../src/shared/storage.ts', async original => ({ ...await original<object>(), DEFAULT_BACKEND_URL: 'https://api.streampulse.stream', getBackendUrl: async () => 'https://api.streampulse.stream' }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

/** The worker's private credential store, holding one linked device under whatever key the build uses. */
function privateDatabase() {
  const reads: string[] = []
  const linked = { kind: 'linked', token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), accountId, deviceId: '11111111-1111-4111-8111-111111111111',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(), refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString() }
  const database = {
    close() {},
    transaction() {
      const transaction = { oncomplete: null as null | (() => void), onerror: null, onabort: null, objectStore: () => ({
        get(key: string) { reads.push(key); const request = { result: linked }; queueMicrotask(() => transaction.oncomplete?.()); return request },
      }) }
      return transaction
    },
  }
  vi.stubGlobal('indexedDB', { open() { const request = { result: database, onsuccess: null as null | (() => void) }; queueMicrotask(() => request.onsuccess?.()); return request } })
  return reads
}

async function accountOrigins(store: boolean) {
  vi.stubGlobal('__SUPPORTER_BACKEND_ORIGIN__', LOCAL)
  vi.stubGlobal('__EXTENSION_STORE_BUILD__', store)
  vi.stubGlobal('chrome', { runtime: { getURL: () => 'chrome-extension://test/' } })
  const reads = privateDatabase()
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(String(url)); return Response.json({ syncEnabled: false, retentionDays: 30 }) }))
  const api = await import('../src/background/api.ts')
  await api.accountHistoryRequest('/v1/account/history/settings', {}, accountId)
  const origin = (url: string) => new URL(url).origin
  return { reads, history: urls.map(origin) }
}

describe('history sync uses the account origin', () => {
  it('a development build pinned to a local backend syncs history there', async () => {
    const { reads, history } = await accountOrigins(false)
    expect(reads.every(key => key.startsWith(`${LOCAL}:`))).toBe(true)
    expect(history).toEqual([LOCAL])
  })

  it('a store build syncs history with production', async () => {
    const { reads, history } = await accountOrigins(true)
    expect(reads.every(key => key === PRODUCTION)).toBe(true)
    expect(history).toEqual([PRODUCTION])
  })
})
