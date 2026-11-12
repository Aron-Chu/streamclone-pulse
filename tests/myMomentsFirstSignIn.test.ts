import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleMyMoments } from '../src/background/myMoments.ts'
import { accountHooks } from '../src/background/accountHooks.ts'
import { emptyPersonalData, type PersonalData } from '../src/background/myMomentsStore.ts'
import { parseMyMoments } from '../src/shared/myMoments.ts'

/**
 * The worker's side of the one-time "move this browser's saves" ask: which
 * Twitch accounts this browser has seen and how each answered live on the
 * browser's own (`|local`) My Moments record, never in storage a content
 * script can read. History kept while signed out moves only when asked.
 */
const root = 'https://api.streampulse.stream'
const ONE = '22222222-2222-4222-8222-222222222222'
const TWO = '33333333-3333-4333-8333-333333333333'
const scopeOf = (id: string) => `${root}|account:${id}`
const LOCAL = `${root}|local`
const f = vi.hoisted(() => ({ account: '', data: new Map<string, PersonalData>(), history: vi.fn() }))
vi.mock('../src/background/supporterAccountRuntime.ts', () => ({ bindAccountDataForget: () => undefined,
  supporterAccount: { isInstallationIdentity: async () => false, run: async () => (f.account ? { state: 'linked', accountId: f.account } : { state: 'signed_out' }) } }))
vi.mock('../src/background/api.ts', () => ({ fetchPulseBookmarks: async () => ({ items: [] }), createPulseBookmark: vi.fn(), deletePulseBookmark: vi.fn(), accountHistoryRequest: f.history }))
vi.mock('../src/shared/storage.ts', async original => ({ ...await original<object>(), getBackendUrl: async () => root }))
vi.mock('../src/background/myMomentsStore.ts', async original => ({ ...await original<object>(),
  personalTransaction: async (scope: string, update?: (value: PersonalData) => PersonalData) => {
    const value = f.data.get(scope) ?? emptyPersonalData()
    if (!update) return value
    const next = update(value); f.data.set(scope, next); return next
  },
  deletePersonal: async (scope: string) => { f.data.delete(scope) },
}))

const sender = { tab: { url: 'https://www.twitch.tv/videos/1234567890' } } as chrome.runtime.MessageSender
const page = {} as chrome.runtime.MessageSender
const at = Date.now() - 60_000
const watched = { id: 'xqc:123456:77', channel: 'xqc', title: 'live', vodId: '1234567890', streamId: '123456', offsetSeconds: 77, availability: 'available' as const, note: '', jumpedAt: at, historyExpiresAt: at + 30 * 86_400_000 }
const deviceSave = { id: 'local:1', login: 'xqc', streamId: '123456', offsetSeconds: 60, label: 'Saved offline', notes: '', source: 'extension' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
const status = (answer?: 'move' | 'later' | 'not-mine') => handleMyMoments({ type: 'MY_MOMENTS', action: 'first-sign-in', ...(answer ? { answer } : {}) }, page)

beforeEach(() => {
  f.account = ONE
  f.data.clear(); f.history.mockReset(); vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => undefined) } })
  f.data.set(LOCAL, { ...emptyPersonalData(), preferences: { captureHistory: true, retentionDays: 30 }, bookmarks: [deviceSave], history: [watched] })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('the one-time move ask', () => {
  it('asks the first account once, and never again after any answer', async () => {
    expect(await status()).toEqual({ type: 'MY_MOMENTS_FIRST_SIGN_IN', ask: true, otherAccountSeen: false })
    expect(await status('later')).toEqual({ type: 'MY_MOMENTS_FIRST_SIGN_IN', ask: false, otherAccountSeen: false })
    expect(await status()).toEqual({ type: 'MY_MOMENTS_FIRST_SIGN_IN', ask: false, otherAccountSeen: false })
    // Answering imports nothing by itself.
    expect(f.data.get(LOCAL)?.bookmarks).toEqual([deviceSave])
  })

  it('tells a second account that another account used this browser', async () => {
    await accountHooks.seen(TWO)
    expect(await status()).toEqual({ type: 'MY_MOMENTS_FIRST_SIGN_IN', ask: true, otherAccountSeen: true })
  })

  it('Not mine imports nothing and records not-mine', async () => {
    await accountHooks.seen(TWO)
    await status('not-mine')
    expect(f.data.get(LOCAL)?.firstSignIn?.answered).toEqual({ [ONE]: 'not-mine' })
    expect(f.data.get(LOCAL)?.bookmarks).toEqual([deviceSave])
    expect(f.data.has(scopeOf(ONE))).toBe(false)
  })

  it('never asks while signed out, and keeps no account in the record then', async () => {
    f.account = ''
    expect(await status()).toEqual({ type: 'MY_MOMENTS_FIRST_SIGN_IN', ask: false, otherAccountSeen: false })
    expect(f.data.get(LOCAL)?.firstSignIn).toBeUndefined()
  })

  it('accepts only the three answers from an extension page', () => {
    expect(parseMyMoments({ type: 'MY_MOMENTS', action: 'first-sign-in' })).toEqual({ type: 'MY_MOMENTS', action: 'first-sign-in' })
    expect(parseMyMoments({ type: 'MY_MOMENTS', action: 'first-sign-in', answer: 'not-mine' })).toEqual({ type: 'MY_MOMENTS', action: 'first-sign-in', answer: 'not-mine' })
    expect(parseMyMoments({ type: 'MY_MOMENTS', action: 'first-sign-in', answer: 'all' })).toBeNull()
    expect(parseMyMoments({ type: 'MY_MOMENTS', action: 'first-sign-in', accountId: ONE })).toBeNull()
    expect(parseMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: scopeOf(ONE), command: { kind: 'import-device-history' } })).toMatchObject({ command: { kind: 'import-device-history' } })
  })
})

describe('moving this browser’s history', () => {
  it('import-device-history copies signed-out history into the account copy and queues it; the device copy stays', async () => {
    f.data.set(scopeOf(ONE), { ...emptyPersonalData(), preferences: { captureHistory: true, retentionDays: 30 },
      accountSync: { enabled: true, available: true, revision: 1, pending: [], syncedAt: Date.now() } })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: scopeOf(ONE), command: { kind: 'import-device-history' } }, page)
    expect(f.data.get(scopeOf(ONE))?.history.map(m => m.id)).toEqual(['xqc:123456:77'])
    expect(f.data.get(scopeOf(ONE))?.accountSync?.pending).toEqual(['xqc:123456:77'])
    expect(f.data.get(LOCAL)?.history.map(m => m.id)).toEqual(['xqc:123456:77'])
  })

  it('import-device-history needs a signed-in account', async () => {
    f.account = ''
    await expect(handleMyMoments({ type: 'MY_MOMENTS', action: 'mutate', scope: LOCAL, command: { kind: 'import-device-history' } }, page)).rejects.toThrow(/Sign in/)
  })
})

describe('switching accounts on this browser', () => {
  it('a capture started under one account never lands in another account’s history', async () => {
    f.data.set(scopeOf(ONE), { ...emptyPersonalData(), preferences: { captureHistory: true, retentionDays: 30 } })
    f.data.set(scopeOf(TWO), { ...emptyPersonalData(), preferences: { captureHistory: true, retentionDays: 30 } })
    const started = await handleMyMoments({ type: 'MOMENT_CAPTURE', action: 'status' }, sender) as { epoch: number }
    // "Not you?": another Twitch account signs in before the 10 seconds are up.
    f.account = TWO
    const result = await handleMyMoments({ type: 'MOMENT_CAPTURE', action: 'record', epoch: started.epoch, watchedSeconds: 10,
      reference: { id: 'x', channel: 'xqc', title: 'live', vodId: '1234567890', streamId: '123456', offsetSeconds: 77, availability: 'available' } }, sender)
    expect(result).toEqual({ ok: false })
    expect(f.data.get(scopeOf(TWO))?.history).toEqual([])
  })

  it('Not you? sends history not yet sent before the account is forgotten', async () => {
    f.data.set(scopeOf(ONE), { ...emptyPersonalData(), preferences: { captureHistory: true, retentionDays: 30 }, history: [watched],
      accountSync: { enabled: true, available: true, revision: 1, pending: ['xqc:123456:77'], syncedAt: Date.now() } })
    f.history.mockResolvedValue({ status: 200, body: { settings: { syncEnabled: true, retentionDays: 30 }, cursor: 'h1.1', reset: false,
      entries: [{ login: 'xqc', streamId: '123456', vodId: '1234567890', offsetSeconds: 77, title: 'live', key: 'xqc:123456:77', jumpedAt: new Date(at).toISOString(), expiresAt: new Date(at + 30 * 86_400_000).toISOString() }] } })
    await accountHooks.flush()
    expect(f.history).toHaveBeenCalled()
    expect(f.history.mock.calls[0]![1]).toMatchObject({ entries: [expect.objectContaining({ offsetSeconds: 77 })] })
  })

  it('a flush with nothing waiting sends nothing', async () => {
    f.data.set(scopeOf(ONE), { ...emptyPersonalData(), accountSync: { enabled: true, available: true, revision: 1, pending: [], syncedAt: Date.now() } })
    await accountHooks.flush()
    expect(f.history).not.toHaveBeenCalled()
  })
})
