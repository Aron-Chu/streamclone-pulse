import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CACHE_BAR_LIMIT,
  DEFAULT_FORM,
  backendHost,
  formatPollAria,
  formatPollDisplay,
  formsEqual,
  type SettingsForm,
} from '../src/options/settingsModel.ts'
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
  getThemePreference,
  isLocalStackBackendUrl,
  setBackendUrl,
  setDefaultChartWindow,
  setKeepLocalCache,
  setPollIntervalMs,
  setThemePreference,
} from '../src/shared/storage.ts'

describe('settings dirty-tracking model', () => {
  it('treats an identical clone as not dirty', () => {
    expect(formsEqual(DEFAULT_FORM, { ...DEFAULT_FORM })).toBe(true)
  })

  it('detects a change in every persisted field', () => {
    const changes: Array<Partial<SettingsForm>> = [
      { backendUrl: 'http://localhost:9090' },
      { theme: 'volt' },
      { chartWindow: '15m' },
      { autoUpdate: !DEFAULT_FORM.autoUpdate },
      { pollMs: DEFAULT_FORM.pollMs + 5000 },
      { autoTrack: 'followed' },
      { placement: 'right' },
      { show7tvLabels: !DEFAULT_FORM.show7tvLabels },
      { keepCache: !DEFAULT_FORM.keepCache },
    ]
    for (const change of changes) {
      expect(formsEqual(DEFAULT_FORM, { ...DEFAULT_FORM, ...change })).toBe(false)
    }
  })
})

describe('polling slider formatting', () => {
  it('renders compact display labels', () => {
    expect(formatPollDisplay(10_000)).toBe('10s')
    expect(formatPollDisplay(30_000)).toBe('30s')
    expect(formatPollDisplay(60_000)).toBe('1m')
    expect(formatPollDisplay(90_000)).toBe('1m 30s')
    expect(formatPollDisplay(300_000)).toBe('5m')
  })

  it('renders spoken aria value text', () => {
    expect(formatPollAria(30_000)).toBe('30 seconds')
    expect(formatPollAria(60_000)).toBe('1 minute')
    expect(formatPollAria(120_000)).toBe('2 minutes')
    expect(formatPollAria(90_000)).toBe('1 minute 30 seconds')
  })
})

describe('segmented + helpers', () => {
  it('derives a readable backend host', () => {
    expect(backendHost('https://api.streampulse.stream')).toBe('api.streampulse.stream')
    expect(backendHost('http://localhost:8081')).toBe('localhost:8081')
    expect(backendHost('not a url')).toBe('not a url')
  })

  it('detects local stack backend URLs', () => {
    expect(isLocalStackBackendUrl('http://localhost:8081')).toBe(true)
    expect(isLocalStackBackendUrl('http://127.0.0.1:8081')).toBe(true)
    expect(isLocalStackBackendUrl('http://localhost:8090')).toBe(false)
    expect(isLocalStackBackendUrl('https://api.streampulse.stream')).toBe(false)
  })

  it('keeps a sane cache bar limit', () => {
    expect(CACHE_BAR_LIMIT).toBeGreaterThan(0)
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
