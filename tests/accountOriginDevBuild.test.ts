import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * A development build pinned to a local backend (__SUPPORTER_BACKEND_ORIGIN__)
 * stores and refreshes its account credential on that origin, so every other
 * account request (Twitch sign-in, saves) must go there too: never a local
 * credential to production, nor a production sign-in into the local store.
 * Store builds keep every account request on production.
 */
const PRODUCTION = 'https://api.streampulse.stream'
const LOCAL = 'http://127.0.0.1:14191'
const accountId = '22222222-2222-4222-8222-222222222222'
const captured = vi.hoisted(() => ({ ports: null as null | { apiOrigin: string; hosted: () => Promise<boolean> } }))
vi.mock('../src/shared/storage.ts', async original => ({ ...await original<object>(), DEFAULT_BACKEND_URL: 'https://api.streampulse.stream', getBackendUrl: async () => 'https://api.streampulse.stream' }))
vi.mock('../src/background/twitchSignIn.ts', async original => {
  const actual = await original<typeof import('../src/background/twitchSignIn.ts')>()
  return { ...actual, TwitchSignIn: class extends actual.TwitchSignIn {
    constructor(ports: ConstructorParameters<typeof actual.TwitchSignIn>[0]) { super(ports); captured.ports = ports }
  } }
})
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); captured.ports = null })

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
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(String(url)); return Response.json({ items: [] }) }))
  await import('../src/background/twitchSignInRuntime.ts')
  const api = await import('../src/background/api.ts')
  await api.fetchPulseBookmarks({ limit: 10 }, undefined, accountId)
  const origin = (url: string) => new URL(url).origin
  return { reads, sign: captured.ports!, bookmarks: urls.map(origin) }
}

describe('account requests use one origin', () => {
  it('a development build pinned to a local backend sends every account request there', async () => {
    const { reads, sign, bookmarks } = await accountOrigins(false)
    expect(reads.every(key => key.startsWith(`${LOCAL}:`))).toBe(true)
    expect(sign.apiOrigin).toBe(LOCAL)
    expect(await sign.hosted()).toBe(true)
    expect(bookmarks).toEqual([LOCAL])
  })

  it('a store build sends every account request to production', async () => {
    const { reads, sign, bookmarks } = await accountOrigins(true)
    expect(reads.every(key => key === PRODUCTION)).toBe(true)
    expect(sign.apiOrigin).toBe(PRODUCTION)
    expect(await sign.hosted()).toBe(true)
    expect(bookmarks).toEqual([PRODUCTION])
  })
})
