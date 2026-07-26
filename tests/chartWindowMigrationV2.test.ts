import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHART_WINDOW_MIGRATION_KEYS,
  DEFAULT_DEFAULT_CHART_WINDOW,
  getDefaultChartWindow,
  migrateDefaultChartWindowToRecentV2Once,
  setDefaultChartWindow,
} from '../src/shared/storage.ts'

describe('chart window migration v2', () => {
  let syncStore: Record<string, unknown>

  beforeEach(() => {
    syncStore = {}
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
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {}),
          remove: vi.fn(async () => {}),
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('product default is 60m', () => {
    expect(DEFAULT_DEFAULT_CHART_WINDOW).toBe('60m')
  })

  it('migrates every pre-v2 value including Full to 60m once', async () => {
    syncStore[CHART_WINDOW_MIGRATION_KEYS.value] = 'full'
    syncStore[CHART_WINDOW_MIGRATION_KEYS.v1] = true
    await migrateDefaultChartWindowToRecentV2Once()
    expect(await getDefaultChartWindow()).toBe('60m')
    expect(syncStore[CHART_WINDOW_MIGRATION_KEYS.v2]).toBe(true)

    syncStore[CHART_WINDOW_MIGRATION_KEYS.value] = '15m'
    await migrateDefaultChartWindowToRecentV2Once()
    expect(await getDefaultChartWindow()).toBe('15m')
  })

  it.each(['15m', '30m', '60m', '2h', '4h', 'full'] as const)(
    'migrates legacy chart value %s to 60m when v2 marker missing',
    async value => {
      syncStore = { [CHART_WINDOW_MIGRATION_KEYS.value]: value }
      await migrateDefaultChartWindowToRecentV2Once()
      expect(await getDefaultChartWindow()).toBe('60m')
      expect(syncStore[CHART_WINDOW_MIGRATION_KEYS.v2]).toBe(true)
    },
  )

  it('treats missing v2 marker as needing migration', async () => {
    syncStore[CHART_WINDOW_MIGRATION_KEYS.value] = 'full'
    delete syncStore[CHART_WINDOW_MIGRATION_KEYS.v2]
    await migrateDefaultChartWindowToRecentV2Once()
    expect(await getDefaultChartWindow()).toBe('60m')
  })

  it('treats malformed v2 marker as needing migration', async () => {
    syncStore[CHART_WINDOW_MIGRATION_KEYS.value] = '2h'
    syncStore[CHART_WINDOW_MIGRATION_KEYS.v2] = 'yes'
    await migrateDefaultChartWindowToRecentV2Once()
    expect(await getDefaultChartWindow()).toBe('60m')
  })

  it('treats false v2 marker as needing migration', async () => {
    syncStore[CHART_WINDOW_MIGRATION_KEYS.value] = '4h'
    syncStore[CHART_WINDOW_MIGRATION_KEYS.v2] = false
    await migrateDefaultChartWindowToRecentV2Once()
    expect(await getDefaultChartWindow()).toBe('60m')
  })

  it('is idempotent when v2 marker is already set', async () => {
    syncStore[CHART_WINDOW_MIGRATION_KEYS.value] = 'full'
    syncStore[CHART_WINDOW_MIGRATION_KEYS.v2] = true
    await migrateDefaultChartWindowToRecentV2Once()
    expect(await getDefaultChartWindow()).toBe('full')
  })

  it('preserves an explicit Full selection after v2 via setDefaultChartWindow', async () => {
    await migrateDefaultChartWindowToRecentV2Once()
    expect(await getDefaultChartWindow()).toBe('60m')
    await setDefaultChartWindow('full')
    expect(await getDefaultChartWindow()).toBe('full')
    await migrateDefaultChartWindowToRecentV2Once()
    expect(await getDefaultChartWindow()).toBe('full')
  })
})
