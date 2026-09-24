import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SupporterAccountCoordinator } from '../src/background/supporterAccount.ts'
import { createPulseBookmark, deletePulseBookmark, fetchPulseBookmarks } from '../src/background/api.ts'

const runtime = vi.hoisted(() => ({ coordinator: null as unknown as SupporterAccountCoordinator, root: 'https://api.streampulse.stream' }))
vi.mock('../src/background/supporterAccountRuntime.ts', () => ({ supporterAccount: {
  withCredential: (operation: (token: string) => Promise<{ status: number }>, accountId?: string) => runtime.coordinator.withCredential(operation, accountId),
} }))
vi.mock('../src/shared/storage.ts', async importOriginal => ({ ...await importOriginal<object>(), getBackendUrl: async () => runtime.root }))
const accountId = '22222222-2222-4222-8222-222222222222'
const credentials = () => ({ kind: 'linked', token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), accountId, deviceId: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(Date.now() + 3600000).toISOString(), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() })
let stored: unknown
let request: ReturnType<typeof vi.fn>
beforeEach(() => {
  runtime.root = 'https://api.streampulse.stream'
  stored = credentials()
  request = vi.fn()
  runtime.coordinator = new SupporterAccountCoordinator({ read: async () => stored, write: async value => { stored = value }, request })
})
afterEach(() => vi.unstubAllGlobals())

it('uses the linked account bearer for list, save and delete without cookies or redirects', async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${credentials().token}`)
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' })
    return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json(init?.method === 'POST' ? { id: 'created' } : { items: [] })
  })
  vi.stubGlobal('fetch', fetcher)
  await fetchPulseBookmarks({}, undefined, accountId)
  await createPulseBookmark({ login: 'xqc', offsetSeconds: 12, label: 'save', source: 'extension' }, undefined, accountId)
  await deletePulseBookmark('created', undefined, accountId)
  expect(fetcher).toHaveBeenCalledTimes(3)
  expect(request).not.toHaveBeenCalled()
})

it('does not send account credentials to an override, a path-bearing root or another account scope', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  for (const root of ['https://other.test', 'http://localhost:8081', 'https://api.streampulse.stream/other']) {
    await expect(fetchPulseBookmarks({}, root)).rejects.toThrow('account_hosted_only')
  }
  await expect(createPulseBookmark({ login: 'xqc', offsetSeconds: 1 }, undefined, 'another')).rejects.toThrow('account_identity_changed')
  runtime.root = 'http://localhost:8081'
  await expect(fetchPulseBookmarks({}, 'https://api.streampulse.stream')).rejects.toThrow('account_hosted_only')
  expect(fetcher).not.toHaveBeenCalled()
})

it('revokes local access on 401, does not retry writes, and distinguishes a temporary outage', async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 503 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(fetchPulseBookmarks({})).rejects.toThrow('bookmarks 503')
  expect(stored).toMatchObject({ accountId })
  fetcher.mockResolvedValue(new Response(null, { status: 401 }))
  await expect(deletePulseBookmark('one')).rejects.toThrow('account_authorization_required')
  expect(stored).toBeNull()
  await expect(fetchPulseBookmarks({})).rejects.toThrow('account_authorization_required')
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('refreshes once before concurrent bookmark requests and never accepts an expired refresh credential', async () => {
  stored = { ...credentials(), expiresAt: new Date(0).toISOString() }
  request.mockResolvedValue({ status: 200, body: { ...credentials(), token: 'c'.repeat(64) } })
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${'c'.repeat(64)}`)
    return Response.json({ items: [] })
  })
  vi.stubGlobal('fetch', fetcher)
  await Promise.all([fetchPulseBookmarks({}), fetchPulseBookmarks({})])
  expect(request).toHaveBeenCalledTimes(1)
  stored = { ...credentials(), refreshExpiresAt: new Date(0).toISOString() }
  await expect(fetchPulseBookmarks({})).rejects.toThrow('account_authorization_required')
  expect(fetcher).toHaveBeenCalledTimes(2)
})
