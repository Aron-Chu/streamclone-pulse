import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SupporterAccountCoordinator } from '../src/background/supporterAccount.ts'
import { createPulseBookmark } from '../src/background/api.ts'
import { handleDeviceBookmarks, handleMyMoments } from '../src/background/myMoments.ts'
import { emptyPersonalData, type PersonalData } from '../src/background/myMomentsStore.ts'

/**
 * A linked account whose token renewal is waiting reports
 * `{ state: 'unavailable', linked: true }`. It is still the account: bookmarks
 * must keep going to the hosted path (which reports the outage), never to the
 * device store, where they would leave the account's list once renewal works.
 */
const root = 'https://api.streampulse.stream'
const accountId = '22222222-2222-4222-8222-222222222222'
const deviceId = '11111111-1111-4111-8111-111111111111'
const f = vi.hoisted(() => ({
  coordinator: null as unknown as import('../src/background/supporterAccount.ts').SupporterAccountCoordinator,
  data: new Map<string, PersonalData>(),
}))
// One real coordinator per test, reached through the same runtime module the
// worker and the bookmark API both import.
vi.mock('../src/background/supporterAccountRuntime.ts', () => ({ bindAccountDataForget: () => undefined, supporterAccount: {
  run: (action: 'status') => f.coordinator.run(action),
  localAccountId: () => f.coordinator.localAccountId(),
  withCredential: (operation: (token: string) => Promise<{ status: number }>, id?: string) => f.coordinator.withCredential(operation, id),
} }))
vi.mock('../src/shared/storage.ts', async original => ({ ...await original<object>(), getBackendUrl: async () => root }))
vi.mock('../src/background/myMomentsStore.ts', async original => ({ ...await original<object>(), personalTransaction: async (scope: string, update?: (value: PersonalData) => PersonalData) => {
  const value = f.data.get(scope) ?? emptyPersonalData()
  if (!update) return value
  const next = update(value); f.data.set(scope, next); return next
} }))

let clock = Date.now()
let stored: unknown
let installationKey: unknown
let request: ReturnType<typeof vi.fn<(path: string, body?: Record<string, unknown>) => Promise<{ status: number; body: unknown }>>>
const iso = (ms: number) => new Date(clock + ms).toISOString()
const credentials = (expiresInMs: number) => ({ kind: 'linked', token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), accountId, deviceId,
  expiresAt: iso(expiresInMs), refreshExpiresAt: iso(86_400_000) })
const fetcher = vi.fn()
beforeEach(() => {
  clock = Date.now()
  installationKey = null
  f.data.clear()
  fetcher.mockReset()
  request = vi.fn()
  vi.stubGlobal('chrome', {})
  vi.stubGlobal('fetch', fetcher)
  f.coordinator = new SupporterAccountCoordinator({
    read: async () => stored, write: async value => { stored = value },
    readInstallationKey: async () => installationKey, writeInstallationKey: async value => { installationKey = value },
    request: (path, body) => request(path, body), now: () => clock,
  })
})
afterEach(() => vi.unstubAllGlobals())

const bookmark = { login: 'xqc', streamId: '123456', vodId: '1234567890', offsetSeconds: 120, label: 'Chat spike', source: 'extension' as const }
const saveFromTwitch = () => handleDeviceBookmarks({ type: 'SAVE_BOOKMARK', bookmark }, {})
const listFromTwitch = () => handleDeviceBookmarks({ type: 'LIST_BOOKMARKS', login: 'xqc', streamId: '123456', limit: 100 }, {})
const load = () => handleMyMoments({ type: 'MY_MOMENTS', action: 'load' }, {}) as Promise<{ snapshot: { scope: string; bookmarksState: string; moments: unknown[] } }>
const accountScope = `${root}|account:${accountId}`

describe('bookmarks while account renewal is waiting', () => {
  it.each([
    ['an email link whose refresh the server did not attempt (429)', () => {
      stored = credentials(30_000)
      request.mockResolvedValue({ status: 429, body: { error: 'try_later' } })
    }],
    ['an email link whose refresh route is not deployed (404)', () => {
      stored = credentials(30_000)
      request.mockResolvedValue({ status: 404, body: null })
    }],
    ['an installation account whose refresh failed on the network', () => {
      stored = { ...credentials(0), installation: true }
      installationKey = { key: 'c'.repeat(64), state: 'claimed', accountId }
      request.mockRejectedValue(new Error('network interrupted'))
    }],
    ['an installation account whose refresh hit a 5xx', () => {
      stored = { ...credentials(0), installation: true }
      installationKey = { key: 'c'.repeat(64), state: 'claimed', accountId }
      request.mockResolvedValue({ status: 502, body: null })
    }],
  ])('keeps %s on the account instead of the device', async (_name, arrange) => {
    arrange()
    expect(await f.coordinator.run('status')).toEqual({ state: 'unavailable', reason: 'temporarily_unavailable', linked: true })

    // The Twitch overlay's save and list fall through to the hosted path...
    expect(await saveFromTwitch()).toBeNull()
    expect(await listFromTwitch()).toBeNull()
    // ...which reports the outage the way master did, without asking to link again.
    await expect(createPulseBookmark(bookmark)).rejects.toThrow('account_temporarily_unavailable')
    expect(fetcher).not.toHaveBeenCalled()

    // My Moments keeps the account scope and says the account is unreachable.
    const { snapshot } = await load()
    expect(snapshot.scope).toBe(accountScope)
    expect(snapshot.bookmarksState).toBe('error')
    const reference = { id: 'm', channel: 'xqc', title: 'Chat spike', vodId: '1234567890', streamId: '123456', offsetSeconds: 120, availability: 'available' as const }
    await expect(handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: snapshot.scope, command: { kind: 'save', reference } }, {}))
      .rejects.toThrow('Could not reach StreamPulse')

    // Nothing was written to the device store.
    expect([...f.data.values()].every(data => data.bookmarks.length === 0)).toBe(true)
    expect(f.data.get(`${root}|local`)?.bookmarks ?? []).toEqual([])
  })

  it('keeps the same scope once renewal succeeds, so nothing saved meanwhile changes owner', async () => {
    stored = credentials(30_000)
    request.mockResolvedValueOnce({ status: 429, body: { error: 'try_later' } })
    expect((await load()).snapshot.scope).toBe(accountScope)
    // The pause ends and the next status read renews the same account.
    clock += 61_000
    request.mockResolvedValueOnce({ status: 200, body: { ...credentials(3_600_000), token: 'e'.repeat(64), refreshToken: 'f'.repeat(64) } })
    fetcher.mockImplementation(async () => Response.json({ items: [] }))
    const { snapshot } = await load()
    expect(request).toHaveBeenLastCalledWith('/v1/account/devices/refresh', { refreshToken: 'b'.repeat(64) })
    expect(stored).toMatchObject({ kind: 'linked', token: 'e'.repeat(64) })
    expect(snapshot).toMatchObject({ scope: accountScope, bookmarksState: 'ready' })
  })

  it('holds a waiting connection whose account cannot be read back instead of saving on the device', async () => {
    stored = credentials(30_000)
    request.mockResolvedValue({ status: 429, body: { error: 'try_later' } })
    expect(await f.coordinator.run('status')).toMatchObject({ state: 'unavailable', linked: true })
    vi.spyOn(f.coordinator, 'localAccountId').mockResolvedValue(null)
    expect(await saveFromTwitch()).toBeNull()
    expect(f.data.size).toBe(0)
  })

  it('still saves on the device when the account is really signed out', async () => {
    stored = null
    expect(await f.coordinator.run('status')).toEqual({ state: 'signed_out' })
    expect(await saveFromTwitch()).toMatchObject({ type: 'BOOKMARK', device: true, item: { login: 'xqc', offsetSeconds: 120 } })
    expect(f.data.get(`${root}|local`)?.bookmarks).toHaveLength(1)
  })

  it('keeps an unconfirmed disconnect on the device scope it resolves to', async () => {
    stored = { kind: 'revoking', token: 'a'.repeat(64) }
    expect(await f.coordinator.run('status')).toEqual({ state: 'error', revocationPending: true })
    expect(await saveFromTwitch()).toMatchObject({ device: true })
    request.mockResolvedValue({ status: 204, body: null })
    expect(await f.coordinator.run('disconnect')).toEqual({ state: 'signed_out' })
    // The save made while revocation was unconfirmed is still listed afterwards.
    expect((await load()).snapshot.moments).toHaveLength(1)
  })
})
