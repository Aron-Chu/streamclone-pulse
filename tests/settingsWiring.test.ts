import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHART_TIMELINE_WINDOWS } from '../src/ui/chatActivityEmotes.ts'
import {
  cacheSessionPulseIfEnabled,
  getDefaultChartWindow,
  getSessionPulse,
  setDefaultChartWindow,
  setKeepLocalCache,
  type DefaultChartWindow,
} from '../src/shared/storage.ts'
import type { PulsePayload } from '../src/shared/messages.ts'

const minimalPayload = { login: 'xqc' } as PulsePayload

describe('settings runtime wiring', () => {
  let syncStore: Record<string, unknown>
  let sessionStore: Record<string, unknown>

  beforeEach(() => {
    syncStore = {}
    sessionStore = {}
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension' },
      storage: {
        sync: {
          get: vi.fn(async (keys: string | string[] | null) => {
            if (keys === null) return { ...syncStore }
            const keyList = Array.isArray(keys) ? keys : [keys]
            const out: Record<string, unknown> = {}
            for (const key of keyList) out[key] = syncStore[key]
            return out
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(syncStore, items)
          }),
        },
        session: {
          get: vi.fn(async (key: string | null) =>
            key === null ? { ...sessionStore } : { [key]: sessionStore[key] },
          ),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(sessionStore, items)
          }),
          remove: vi.fn(async (keys: string[]) => {
            for (const k of keys) delete sessionStore[k]
          }),
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('default chart window values are valid LiveStatsBand timeline windows', async () => {
    const windows: DefaultChartWindow[] = ['15m', '30m', '60m', '2h', '4h', 'full']
    for (const window of windows) {
      await setDefaultChartWindow(window)
      const stored = await getDefaultChartWindow()
      expect(CHART_TIMELINE_WINDOWS).toContain(stored)
    }
  })

  it('skips session cache writes when remember-channels is off', async () => {
    await setKeepLocalCache(false)
    await cacheSessionPulseIfEnabled('xqc', {
      payload: minimalPayload,
      fetchedAt: 1,
      window: 'recent',
      streamId: '',
    })
    expect(await getSessionPulse('xqc')).toBeNull()
    expect(Object.keys(sessionStore)).toHaveLength(0)
  })

  it('writes session cache when remember-channels is on', async () => {
    await setKeepLocalCache(true)
    const entry = {
      payload: minimalPayload,
      fetchedAt: Date.now(),
      window: 'recent' as const,
      streamId: '',
    }
    await cacheSessionPulseIfEnabled('xqc', entry)
    expect(await getSessionPulse('xqc', 'recent')).toEqual(entry)
  })

  it('rejects pulse cache when window or streamId mismatches', async () => {
    await setKeepLocalCache(true)
    await cacheSessionPulseIfEnabled('xqc', {
      payload: { ...minimalPayload, streamId: 'stream-a' },
      fetchedAt: Date.now(),
      window: 'recent',
      streamId: 'stream-a',
    })
    expect(await getSessionPulse('xqc', 'full')).toBeNull()
    expect(await getSessionPulse('xqc', 'recent', 'stream-b')).toBeNull()
    expect(await getSessionPulse('xqc', 'recent', 'stream-a')).not.toBeNull()
  })
})
