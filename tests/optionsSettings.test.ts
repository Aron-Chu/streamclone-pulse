import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clampPollIntervalMs,
  clearSessionPulseCache,
  countSessionPulseEntries,
  DEFAULT_BACKEND_URL,
  getBackendUrl,
  getDefaultChartWindow,
  getOverlayDisplayPreferences,
  getOverlayPlacement,
  getKeepLocalCache,
  getPollIntervalMs,
  getThemePreference,
  isLocalStackBackendUrl,
  setBackendUrl,
  setDefaultChartWindow,
  setKeepLocalCache,
  setPollIntervalMs,
  setThemePreference,
} from '../src/shared/storage.ts'
describe('settings helpers', () => {
  it('detects local stack backend URLs', () => {
    expect(isLocalStackBackendUrl('http://localhost:8081')).toBe(true)
    expect(isLocalStackBackendUrl('http://127.0.0.1:8081')).toBe(true)
    expect(isLocalStackBackendUrl('http://localhost:8090')).toBe(false)
    expect(isLocalStackBackendUrl('https://api.streampulse.stream')).toBe(false)
  })

})

describe('slider clamping to the polling range', () => {
  it('clamps below the floor, above the ceiling, and snaps to the step', () => {
    expect(clampPollIntervalMs(1_000)).toBe(10_000)
    expect(clampPollIntervalMs(999_999)).toBe(300_000)
    expect(clampPollIntervalMs(33_000)).toBe(35_000)
    expect(clampPollIntervalMs(Number.NaN)).toBe(30_000)
  })
})

describe('settings persistence (mocked chrome.storage)', () => {
  let syncStore: Record<string, unknown>
  let sessionStore: Record<string, unknown>

  beforeEach(() => {
    syncStore = {}
    sessionStore = {}
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension' },
      permissions: {
        contains: vi.fn(async () => false),
        request: vi.fn(async () => true),
      },
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
          remove: vi.fn(async (keys: string | string[]) => {
            const list = Array.isArray(keys) ? keys : [keys]
            for (const key of list) delete syncStore[key]
          }),
        },
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {}),
          remove: vi.fn(async () => {}),
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

  it('round-trips new display + cache keys', async () => {
    await setThemePreference('volt')
    await setDefaultChartWindow('4h')
    await setKeepLocalCache(false)
    expect(await getThemePreference()).toBe('volt')
    expect(await getDefaultChartWindow()).toBe('4h')
    expect(await getKeepLocalCache()).toBe(false)
  })

  it('migrates legacy hidden placement to a reopenable collapsed sidebar', async () => {
    syncStore.overlayPlacement = 'hidden'
    syncStore.overlayMode = 'expanded'

    await expect(getOverlayDisplayPreferences()).resolves.toEqual({
      placement: 'sidebar',
      mode: 'collapsed',
    })
    expect(syncStore.overlayPlacement).toBe('sidebar')
    expect(syncStore.overlayMode).toBe('collapsed')
    await expect(getOverlayPlacement()).resolves.toBe('sidebar')
  })

  it('preserves valid placement and mode preferences', async () => {
    syncStore.overlayPlacement = 'right'
    syncStore.overlayMode = 'mini'

    await expect(getOverlayDisplayPreferences()).resolves.toEqual({
      placement: 'right',
      mode: 'mini',
    })
    expect(syncStore.overlayPlacement).toBe('right')
    expect(syncStore.overlayMode).toBe('mini')
  })

  it('round-trips azure and migrates legacy theme ids', async () => {
    syncStore.themePreference = 'azure'
    expect(await getThemePreference()).toBe('azure')
    syncStore.themePreference = 'ocean'
    expect(await getThemePreference()).toBe('azure')
    syncStore.themePreference = 'volcano'
    expect(await getThemePreference()).toBe('volt')
  })

  it('persists the polling slider as a clamped millisecond value', async () => {
    await setPollIntervalMs(33_000)
    expect(syncStore.pollIntervalMs).toBe(35_000)
  })

  it('clamps store builds to 30 seconds without overwriting a developer preference', async () => {
    syncStore.pollIntervalMs = 15_000
    vi.stubGlobal('__EXTENSION_STORE_BUILD__', true)
    expect(await getPollIntervalMs()).toBe(30_000)
    await setPollIntervalMs(60_000)
    expect(syncStore.pollIntervalMs).toBe(15_000)
  })

  it('counts and clears cached pulse channels', async () => {
    sessionStore['pulse:xqc'] = { fetchedAt: 1 }
    sessionStore['pulse:caseoh_'] = { fetchedAt: 2 }
    sessionStore['unrelated'] = true
    expect(await countSessionPulseEntries()).toBe(2)
    await clearSessionPulseCache()
    expect(await countSessionPulseEntries()).toBe(0)
    expect(sessionStore['unrelated']).toBe(true)
  })

  it('migrates legacy Streamclone :8090 URLs to hosted prod', async () => {
    syncStore.backendUrl = 'http://localhost:8090'
    expect(await getBackendUrl()).toBe(DEFAULT_BACKEND_URL)
    expect(syncStore.backendUrl).toBe(DEFAULT_BACKEND_URL)
    expect(syncStore.localBackendOptIn).toBe(false)
  })

  it('migrates stale localhost backend URLs without opt-in to hosted prod', async () => {
    syncStore.backendUrl = 'http://localhost:8081'
    expect(await getBackendUrl()).toBe(DEFAULT_BACKEND_URL)
    expect(syncStore.backendUrl).toBe(DEFAULT_BACKEND_URL)
    expect(syncStore.localBackendOptIn).toBe(false)
  })

  it('keeps localhost when the user explicitly opts in', async () => {
    await setBackendUrl('http://localhost:8081')
    expect(syncStore.localBackendOptIn).toBe(true)
    expect(await getBackendUrl()).toBe('http://localhost:8081')
  })

  it('clears local opt-in when switching back to hosted', async () => {
    await setBackendUrl('http://localhost:8081')
    await setBackendUrl(DEFAULT_BACKEND_URL)
    expect(syncStore.localBackendOptIn).toBe(false)
    expect(await getBackendUrl()).toBe(DEFAULT_BACKEND_URL)
  })
})
