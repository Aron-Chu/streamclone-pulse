import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SupporterAccountCoordinator } from '../src/background/supporterAccount.ts'
import { forgetAccountScope, handleMyMoments } from '../src/background/myMoments.ts'
import { emptyPersonalData, type PersonalData } from '../src/background/myMomentsStore.ts'

/**
 * Leaving an account removes this browser's copy of that account's watched
 * history and notes (the `|account:<id>` record); saves made without an
 * account (`|local`) stay. Every exit goes through the real coordinator:
 * Sign out, Sign out everywhere, and the server rejecting the credential.
 */
const root = 'https://api.streampulse.stream'
const accountId = '22222222-2222-4222-8222-222222222222'
const otherAccount = '33333333-3333-4333-8333-333333333333'
const deviceId = '11111111-1111-4111-8111-111111111111'
const accountScope = `${root}|account:${accountId}`
const localScope = `${root}|local`
const f = vi.hoisted(() => ({
  coordinator: null as unknown as import('../src/background/supporterAccount.ts').SupporterAccountCoordinator,
  forget: undefined as undefined | ((accountId: string) => void),
  data: new Map<string, PersonalData>(),
  pages: vi.fn(),
}))
vi.mock('../src/background/supporterAccountRuntime.ts', () => ({
  bindAccountDataForget: (forget: (accountId: string) => void) => { f.forget = forget },
  supporterAccount: {
    run: (action: 'status') => f.coordinator.run(action),
    localAccountId: () => f.coordinator.localAccountId(),
    withCredential: (operation: (token: string) => Promise<{ status: number }>, id?: string) => f.coordinator.withCredential(operation, id),
  },
}))
vi.mock('../src/background/api.ts', () => ({ fetchPulseBookmarks: f.pages, createPulseBookmark: vi.fn(), deletePulseBookmark: vi.fn() }))
vi.mock('../src/shared/storage.ts', async original => ({ ...await original<object>(), getBackendUrl: async () => root }))
vi.mock('../src/background/myMomentsStore.ts', async original => ({ ...await original<object>(),
  personalTransaction: async (scope: string, update?: (value: PersonalData) => PersonalData) => {
    const value = f.data.get(scope) ?? emptyPersonalData()
    if (!update) return value
    const next = update(value); f.data.set(scope, next); return next
  },
  deletePersonal: async (scope: string) => { f.data.delete(scope) },
}))

let clock = Date.now()
let stored: unknown
let request: ReturnType<typeof vi.fn<(path: string, body?: Record<string, unknown>) => Promise<{ status: number; body: unknown }>>>
const iso = (ms: number) => new Date(clock + ms).toISOString()
const credentials = (id = accountId, expiresInMs = 86_400_000) => ({ kind: 'linked', token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), accountId: id, deviceId,
  expiresAt: iso(expiresInMs), refreshExpiresAt: iso(30 * 86_400_000) })
const watched = { id: 'xqc:123456:120', channel: 'xqc', title: 'Chat spike', vodId: null, streamId: '123456', offsetSeconds: 120, availability: 'unresolved' as const, note: '', jumpedAt: Date.now(), historyExpiresAt: Date.now() + 86_400_000 }
const deviceSave = { id: 'local:1', login: 'xqc', streamId: '123456', offsetSeconds: 60, label: 'Saved offline', notes: '', source: 'extension' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
/** Lets the removal queued behind the coordinator's work run. */
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)) }

beforeEach(() => {
  clock = Date.now()
  stored = credentials()
  f.data.clear()
  f.pages.mockReset()
  request = vi.fn()
  vi.stubGlobal('chrome', {})
  f.coordinator = new SupporterAccountCoordinator({
    read: async () => stored, write: async value => { stored = value },
    request: (path, body) => request(path, body), now: () => clock,
    // The runtime's wiring: the port calls whatever myMoments bound.
    accountForgotten: id => f.forget?.(id),
  })
  f.data.set(accountScope, { ...emptyPersonalData(), preferences: { captureHistory: true, retentionDays: 30 }, history: [watched], notes: { 'bk-1': 'private note' } })
  f.data.set(localScope, { ...emptyPersonalData(), bookmarks: [deviceSave], notes: { 'local:1': 'device note' } })
})
afterEach(() => vi.unstubAllGlobals())

describe('leaving an account removes its local copy', () => {
  it('myMoments binds the removal at load', () => {
    expect(typeof f.forget).toBe('function')
  })

  it('Sign out removes the account history and notes, keeping saves made without an account', async () => {
    request.mockResolvedValue({ status: 204, body: null })
    expect(await f.coordinator.run('disconnect')).toEqual({ state: 'signed_out' })
    await settle()
    expect(f.data.has(accountScope)).toBe(false)
    expect(f.data.get(localScope)).toMatchObject({ bookmarks: [{ id: 'local:1' }], notes: { 'local:1': 'device note' } })
  })

  it('Sign out removes the copy even when the revocation request fails', async () => {
    request.mockRejectedValue(new Error('offline'))
    expect(await f.coordinator.run('disconnect')).toEqual({ state: 'error', revocationPending: true })
    await settle()
    expect(f.data.has(accountScope)).toBe(false)
  })

  it('Sign out everywhere removes the copy of the account it signed out', async () => {
    expect(await f.coordinator.forgetSignedOutEverywhere(accountId)).toEqual({ state: 'signed_out' })
    await settle()
    expect(f.data.has(accountScope)).toBe(false)
    expect(f.data.has(localScope)).toBe(true)
  })

  it('Sign out everywhere for another account leaves the signed-in account alone', async () => {
    stored = credentials(otherAccount)
    f.data.set(`${root}|account:${otherAccount}`, { ...emptyPersonalData(), history: [watched] })
    await f.coordinator.forgetSignedOutEverywhere(accountId)
    await settle()
    expect(f.data.has(`${root}|account:${otherAccount}`)).toBe(true)
  })

  it('a credential the server rejects (401) on an account request removes the copy', async () => {
    f.pages.mockImplementation(async () => {
      await f.coordinator.withCredential(async () => ({ status: 401 }), accountId).catch(() => undefined)
      throw new Error('account_authorization_required')
    })
    await handleMyMoments({ type: 'MY_MOMENTS', action: 'load' }, {}).catch(() => undefined)
    await settle()
    expect(stored).toEqual({ kind: 'relink_required' })
    expect(f.data.has(accountScope)).toBe(false)
  })

  it('a refresh the server rejects (401) removes the copy', async () => {
    stored = credentials(accountId, 0)
    request.mockResolvedValue({ status: 401, body: { error: 'invalid_refresh_token' } })
    expect(await f.coordinator.run('status')).toEqual({ state: 'relink_required' })
    await settle()
    expect(f.data.has(accountScope)).toBe(false)
  })

  it('a refresh lost on the network keeps the copy (not a revocation)', async () => {
    stored = credentials(accountId, 0)
    request.mockRejectedValue(new Error('network interrupted'))
    expect(await f.coordinator.run('status')).toEqual({ state: 'relink_required' })
    await settle()
    expect(f.data.get(accountScope)?.history).toHaveLength(1)
  })

  it('runs after a My Moments request already under way, so that request cannot write the copy back', async () => {
    let release!: () => void
    const page = { items: [{ id: 'bk-1', login: 'xqc', streamId: '123456', offsetSeconds: 1, label: 'x', notes: '', createdAt: new Date().toISOString() }] }
    f.pages.mockResolvedValue(page)
    f.pages.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(page) }))
    const edit = handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: accountScope, command: { kind: 'edit', id: 'bk-1', note: 'written late' } }, {})
    await settle()
    const removal = forgetAccountScope(accountId)
    release()
    await edit
    // The edit did write its note first; the removal queued behind it then ran.
    await removal
    expect(f.data.has(accountScope)).toBe(false)
  })
})
