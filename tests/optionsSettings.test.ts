import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clampPollIntervalMs,
  clearSessionPulseCache,
  countSessionPulseEntries,
  DEFAULT_BACKEND_URL,
  getBackendUrl,
  getDefaultChartWindow,
  getKeepLocalCache,
  getOverlayDisplayPreferences,
  getOverlayPlacement,
  getThemePreference,
  getColorSchemePreference,
  isLocalStackBackendUrl,
  setBackendUrl,
  setColorSchemePreference,
  setDefaultChartWindow,
  setKeepLocalCache,
  setPollIntervalMs,
  setThemePreference,
} from '../src/shared/storage.ts'

describe('local stack backend detection', () => {
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
      runtime: { id: 'test-extension-id' },
      storage: {
        sync: {
          get: vi.fn(async (keys: string | string[] | Record<string, unknown> | null) => {
            if (keys === null || keys === undefined) return { ...syncStore }
            if (typeof keys === 'object' && !Array.isArray(keys)) {
              const out: Record<string, unknown> = {}
              for (const key of Object.keys(keys)) out[key] = syncStore[key] ?? keys[key]
              return out
            }
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
          get: vi.fn(async (keys: string | string[] | Record<string, unknown> | null) => {
            if (keys === null || keys === undefined) return { ...sessionStore }
            if (typeof keys === 'object' && !Array.isArray(keys)) {
              const out: Record<string, unknown> = {}
              for (const key of Object.keys(keys)) out[key] = sessionStore[key] ?? keys[key]
              return out
            }
            const keyList = Array.isArray(keys) ? keys : [keys]
            const out: Record<string, unknown> = {}
            for (const key of keyList) out[key] = sessionStore[key]
            return out
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(sessionStore, items)
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            const keyList = Array.isArray(keys) ? keys : [keys]
            for (const k of keyList) delete sessionStore[k]
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

  it('round-trips azure and migrates legacy theme ids', async () => {
    syncStore.themePreference = 'azure'
    expect(await getThemePreference()).toBe('azure')
    syncStore.themePreference = 'ocean'
    expect(await getThemePreference()).toBe('azure')
    syncStore.themePreference = 'volcano'
    expect(await getThemePreference()).toBe('volt')
  })

  it('defaults color scheme to auto and round-trips light/dark', async () => {
    expect(await getColorSchemePreference()).toBe('auto')
    await setColorSchemePreference('light')
    expect(await getColorSchemePreference()).toBe('light')
    await setColorSchemePreference('dark')
    expect(await getColorSchemePreference()).toBe('dark')
    await setColorSchemePreference('auto')
    expect(await getColorSchemePreference()).toBe('auto')
  })

  it('normalizes invalid color-scheme values to auto without touching accent', async () => {
    syncStore.themePreference = 'volt'
    syncStore.colorSchemePreference = 'sepia'
    expect(await getColorSchemePreference()).toBe('auto')
    expect(await getThemePreference()).toBe('volt')
  })

  it('persists the polling slider as a clamped millisecond value', async () => {
    await setPollIntervalMs(33_000)
    expect(syncStore.pollIntervalMs).toBe(35_000)
  })

  it('migrates legacy hidden placement to expanded sidebar', async () => {
    syncStore.overlayPlacement = 'hidden'
    syncStore.overlayMode = 'expanded'

    expect(await getOverlayDisplayPreferences()).toEqual({
      placement: 'sidebar',
      mode: 'expanded',
    })
    expect(syncStore.overlayPlacement).toBe('sidebar')
    expect(syncStore.overlayMode).toBe('expanded')
    expect(await getOverlayPlacement()).toBe('sidebar')
  })

  it('migrates mini and collapsed modes to expanded', async () => {
    syncStore.overlayPlacement = 'right'
    syncStore.overlayMode = 'mini'

    expect(await getOverlayDisplayPreferences()).toEqual({
      placement: 'right',
      mode: 'expanded',
    })
    expect(syncStore).toMatchObject({ overlayPlacement: 'right', overlayMode: 'expanded' })

    syncStore.overlayMode = 'collapsed'
    expect(await getOverlayDisplayPreferences()).toEqual({
      placement: 'right',
      mode: 'expanded',
    })
    expect(syncStore.overlayMode).toBe('expanded')
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
