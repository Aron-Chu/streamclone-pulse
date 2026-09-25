import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHART_WINDOW_MIGRATION_KEYS,
  DEFAULT_DEFAULT_CHART_WINDOW,
  getDefaultChartWindow,
  migrateDefaultChartWindowToFullV3Once,
  setDefaultChartWindow,
} from '../src/shared/storage.ts'

describe('chart window migration v3', () => {
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

  it('product default is Full stream', () => {
    expect(DEFAULT_DEFAULT_CHART_WINDOW).toBe('full')
  })

  it.each([undefined, null, 'invalid', 60])('initializes missing or invalid range %s to Full stream', async value => {
    syncStore[CHART_WINDOW_MIGRATION_KEYS.value] = value
    await migrateDefaultChartWindowToFullV3Once()
    expect(await getDefaultChartWindow()).toBe('full')
    expect(syncStore[CHART_WINDOW_MIGRATION_KEYS.v3]).toBe(true)
  })

  it('marks migration complete without replacing subsequent choices', async () => {
    syncStore[CHART_WINDOW_MIGRATION_KEYS.value] = 'full'
    syncStore[CHART_WINDOW_MIGRATION_KEYS.v1] = true
    await migrateDefaultChartWindowToFullV3Once()
    expect(await getDefaultChartWindow()).toBe('full')
    expect(syncStore[CHART_WINDOW_MIGRATION_KEYS.v3]).toBe(true)

    syncStore[CHART_WINDOW_MIGRATION_KEYS.value] = '15m'
    await migrateDefaultChartWindowToFullV3Once()
    expect(await getDefaultChartWindow()).toBe('15m')
  })

  it.each(['15m', '30m', '60m', '2h', '4h', 'full'] as const)(
    'preserves legacy chart value %s when v3 marker is missing',
    async value => {
      syncStore = { [CHART_WINDOW_MIGRATION_KEYS.value]: value }
      await migrateDefaultChartWindowToFullV3Once()
      expect(await getDefaultChartWindow()).toBe(value)
      expect(syncStore[CHART_WINDOW_MIGRATION_KEYS.v3]).toBe(true)
    },
  )

  it('treats missing v3 marker as needing migration', async () => {
    syncStore[CHART_WINDOW_MIGRATION_KEYS.value] = 'full'
    delete syncStore[CHART_WINDOW_MIGRATION_KEYS.v3]
    await migrateDefaultChartWindowToFullV3Once()
    expect(await getDefaultChartWindow()).toBe('full')
  })

  it('preserves the range with a malformed migration marker', async () => {
    syncStore[CHART_WINDOW_MIGRATION_KEYS.value] = '2h'
    syncStore[CHART_WINDOW_MIGRATION_KEYS.v3] = 'yes'
    await migrateDefaultChartWindowToFullV3Once()
    expect(await getDefaultChartWindow()).toBe('2h')
  })

  it('preserves the range with a false migration marker', async () => {
    syncStore[CHART_WINDOW_MIGRATION_KEYS.value] = '4h'
    syncStore[CHART_WINDOW_MIGRATION_KEYS.v3] = false
    await migrateDefaultChartWindowToFullV3Once()
    expect(await getDefaultChartWindow()).toBe('4h')
  })

  it('is idempotent when v3 marker is already set', async () => {
    syncStore[CHART_WINDOW_MIGRATION_KEYS.value] = 'full'
    syncStore[CHART_WINDOW_MIGRATION_KEYS.v3] = true
    await migrateDefaultChartWindowToFullV3Once()
    expect(await getDefaultChartWindow()).toBe('full')
  })

  it('preserves an explicit range after v3 via setDefaultChartWindow', async () => {
    await migrateDefaultChartWindowToFullV3Once()
    expect(await getDefaultChartWindow()).toBe('full')
    await setDefaultChartWindow('60m')
    expect(await getDefaultChartWindow()).toBe('60m')
    await setDefaultChartWindow('full')
    expect(await getDefaultChartWindow()).toBe('full')
    await migrateDefaultChartWindowToFullV3Once()
    expect(await getDefaultChartWindow()).toBe('full')
  })
})
