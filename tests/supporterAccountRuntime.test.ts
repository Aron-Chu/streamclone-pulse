import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/shared/storage.ts', () => ({ DEFAULT_BACKEND_URL: 'https://api.streampulse.stream', getBackendUrl: async () => 'https://api.streampulse.stream' }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

function privateDatabase() {
  const reads: string[] = []
  const data = new Map<string, unknown>([['https://api.streampulse.stream', { kind: 'linked', token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), accountId: '22222222-2222-4222-8222-222222222222', deviceId: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(Date.now() + 86_400_000).toISOString(), refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString() }]])
  const database = {
    close() {},
    transaction() {
      const transaction = { oncomplete: null as null | (() => void), objectStore: () => ({
        get(key: string) { reads.push(key); const request = { result: data.get(key) }; queueMicrotask(() => transaction.oncomplete?.()); return request },
      }) }
      return transaction
    },
  }
  vi.stubGlobal('indexedDB', { open() { const request = { result: database, onsuccess: null as null | (() => void) }; queueMicrotask(() => request.onsuccess?.()); return request } })
  return reads
}

describe('Supporter runtime origin isolation', () => {
  it('cannot read the existing production credential from a local development build', async () => {
    vi.stubGlobal('__SUPPORTER_BACKEND_ORIGIN__', 'https://localhost:8081')
    vi.stubGlobal('__EXTENSION_STORE_BUILD__', false)
    const reads = privateDatabase()
    const runtime = await import('../src/background/supporterAccountRuntime.ts')
    expect(await runtime.supporterAccount.run('status')).toEqual({ state: 'signed_out' })
    expect(reads).toEqual(['https://localhost:8081:https://api.streampulse.stream'])
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await runtime.accountRequest('/v1/billing/supporter')
    expect(fetch).toHaveBeenCalledWith('https://localhost:8081/v1/billing/supporter', expect.objectContaining({ credentials: 'omit', redirect: 'error' }))
  })
  it('pins Store runtime and storage to production even if a development define is injected', async () => {
    vi.stubGlobal('__SUPPORTER_BACKEND_ORIGIN__', 'https://localhost:8081')
    vi.stubGlobal('__EXTENSION_STORE_BUILD__', true)
    const reads = privateDatabase()
    const runtime = await import('../src/background/supporterAccountRuntime.ts')
    expect(await runtime.supporterAccount.run('status')).toMatchObject({ state: 'linked' })
    expect(reads).toEqual(['https://api.streampulse.stream'])
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await runtime.accountRequest('/v1/billing/supporter')
    expect(fetch).toHaveBeenCalledWith('https://api.streampulse.stream/v1/billing/supporter', expect.objectContaining({ credentials: 'omit' }))
  })
})
