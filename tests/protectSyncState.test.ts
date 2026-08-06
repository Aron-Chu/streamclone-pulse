import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getProtectSyncState,
  setProtectSyncState,
} from '../src/shared/storage.ts'

describe('Protect browser/server state separation', () => {
  let localStore: Record<string, unknown>

  beforeEach(() => {
    localStore = {}
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension' },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: localStore[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => Object.assign(localStore, items)),
          remove: vi.fn(async (key: string) => { delete localStore[key] }),
        },
        sync: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
        session: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists confirmed rows and removal tombstones independently', async () => {
    await setProtectSyncState({
      principalId: 'dev_123',
      serverConfirmed: ['serveronly'],
      tombstones: ['removed'],
      channels: {
        saved: { state: 'protected' },
        removed: { state: 'retry', operation: 'remove', status: 503 },
      },
    })

    const state = await getProtectSyncState()
    expect(state.serverConfirmed).toEqual(['serveronly'])
    expect(state.tombstones).toEqual(['removed'])
    expect(state.channels.removed).toMatchObject({ state: 'retry', operation: 'remove', status: 503 })
  })

  it('drops malformed state without turning it into a deletion plan', async () => {
    localStore.protectSyncState = {
      serverConfirmed: ['serveronly'],
      tombstones: ['removed'],
      channels: { removed: { state: 'unknown', operation: 'remove' } },
    }
    const state = await getProtectSyncState()
    expect(state.serverConfirmed).toEqual(['serveronly'])
    expect(state.tombstones).toEqual(['removed'])
    expect(state.channels).toEqual({})
  })
})
