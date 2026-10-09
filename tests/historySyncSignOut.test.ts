import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { handleMyMoments } from '../src/background/myMoments.ts'
import { syncHistoryNow } from '../src/background/historySync.ts'
import { emptyPersonalData, type PersonalData } from '../src/background/myMomentsStore.ts'

/**
 * With history sync (#61) and the sign-out cleanup (#79) together: leaving the
 * account removes this browser's synced copy, including the queue of jumps
 * not yet sent, and a push already scheduled for that account never goes out.
 * A sync already under way cannot write the account's history back.
 */
const f = vi.hoisted(() => ({ forget: undefined as undefined | ((accountId: string) => void), data: new Map<string, PersonalData>(), history: vi.fn() }))
vi.mock('../src/background/supporterAccountRuntime.ts', () => ({ bindAccountDataForget: (forget: (accountId: string) => void) => { f.forget = forget },
  supporterAccount: { run: async () => ({ state: 'linked', accountId: 'one' }) } }))
vi.mock('../src/background/api.ts', () => ({ fetchPulseBookmarks: async () => ({ items: [] }), createPulseBookmark: vi.fn(), deletePulseBookmark: vi.fn(), accountHistoryRequest: f.history }))
vi.mock('../src/background/myMomentsStore.ts', async original => ({ ...await original<object>(),
  personalTransaction: async (scope: string, update?: (value: PersonalData) => PersonalData) => {
    const value = f.data.get(scope) ?? emptyPersonalData()
    if (!update) return value
    const next = update(value); f.data.set(scope, next); return next
  },
  deletePersonal: async (scope: string) => { f.data.delete(scope) },
}))
const SCOPE = 'https://api.streampulse.stream|account:one'
beforeEach(() => {
  f.data.clear(); f.history.mockReset(); vi.stubGlobal('chrome', {})
  f.data.set(SCOPE, { ...emptyPersonalData(), epoch: 7, preferences: { captureHistory: true, retentionDays: 30 }, notes: { x: 'note' },
    accountSync: { enabled: true, available: true, revision: 1, pending: [], syncedAt: Date.now() } })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('Sign out drops the synced copy, its unsent queue and the push scheduled for it', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await handleMyMoments({ type: 'MOMENT_CAPTURE', action: 'record', epoch: 7, watchedSeconds: 10,
    reference: { id: 'x', channel: 'xqc', title: 'live', vodId: '1234567890', streamId: '123456', offsetSeconds: 77, availability: 'available' } },
  { tab: { url: 'https://www.twitch.tv/videos/1234567890' } as chrome.tabs.Tab })
  expect(f.data.get(SCOPE)?.accountSync?.pending).toEqual(['xqc:123456:77'])
  f.forget!('one')
  await vi.runAllTimersAsync()
  expect(f.data.has(SCOPE)).toBe(false)
  expect(f.history).not.toHaveBeenCalled()
})

it('a sync reply that arrives after Sign out does not write the account history back', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)) }
  let reply: (() => void) | undefined
  f.history.mockImplementation((_path: string, body: { entries: Array<Record<string, unknown>> }) => new Promise(resolve => {
    // Echoes this browser's jump and adds one from another browser on the account.
    const other = { login: 'xqc', streamId: '123456', vodId: '1234567890', offsetSeconds: 500, title: 'elsewhere', jumpedAt: new Date(Date.now() - 1000).toISOString() }
    reply = () => resolve({ status: 200, body: { settings: { syncEnabled: true, retentionDays: 30 }, cursor: 'h1.1', reset: true,
      entries: [...body.entries, other].map(e => ({ ...e, key: `${e.login}:${e.streamId}:${e.offsetSeconds}`, expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() })) } })
  }))
  await handleMyMoments({ type: 'MOMENT_CAPTURE', action: 'record', epoch: 7, watchedSeconds: 10,
    reference: { id: 'x', channel: 'xqc', title: 'live', vodId: '1234567890', streamId: '123456', offsetSeconds: 77, availability: 'available' } },
  { tab: { url: 'https://www.twitch.tv/videos/1234567890' } as chrome.tabs.Tab })
  const run = syncHistoryNow(SCOPE, 'one')
  await flush()
  expect(f.history).toHaveBeenCalledTimes(1)
  f.forget!('one')
  await flush()
  reply!()
  await run
  expect(f.data.get(SCOPE)?.history ?? []).toEqual([])
  expect(f.data.get(SCOPE)?.notes ?? {}).toEqual({})
  expect(f.data.get(SCOPE)?.accountSync?.enabled ?? false).toBe(false)
})
