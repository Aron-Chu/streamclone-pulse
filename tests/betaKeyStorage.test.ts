import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Area = 'sync' | 'local' | 'session'

function createStorageMock() {
  const areas: Record<Area, Record<string, unknown>> = {
    sync: {},
    local: {},
    session: {},
  }

  function makeArea(area: Area) {
    return {
      get: vi.fn(async (keys?: string | string[] | null) => {
        const bag = areas[area]
        if (keys == null) return { ...bag }
        const list = Array.isArray(keys) ? keys : [keys]
        const out: Record<string, unknown> = {}
        for (const key of list) {
          if (key in bag) out[key] = bag[key]
        }
        return out
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(areas[area], items)
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys]
        for (const key of list) delete areas[area][key]
      }),
    }
  }

  return {
    areas,
    chrome: {
      runtime: { id: 'test-extension' },
      storage: {
        sync: makeArea('sync'),
        local: makeArea('local'),
        session: makeArea('session'),
      },
      permissions: {
        contains: vi.fn(async () => false),
        request: vi.fn(async () => true),
      },
    },
  }
}

describe('beta key storage', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('stores beta keys in local storage and clears sync', async () => {
    const mock = createStorageMock()
    vi.stubGlobal('chrome', mock.chrome)

    const { setBetaKey, getBetaKey } = await import('../src/shared/storage')
    await setBetaKey('test-key-value')

    expect(mock.areas.local.betaKey).toBe('test-key-value')
    expect(mock.areas.sync.betaKey).toBeUndefined()
    expect(await getBetaKey()).toBe('test-key-value')
  })

  it('migrates a legacy sync beta key into local storage', async () => {
    const mock = createStorageMock()
    mock.areas.sync.betaKey = 'legacy-sync-key'
    vi.stubGlobal('chrome', mock.chrome)

    const { getBetaKey } = await import('../src/shared/storage')
    const value = await getBetaKey()

    expect(value).toBe('legacy-sync-key')
    expect(mock.areas.local.betaKey).toBe('legacy-sync-key')
    expect(mock.areas.sync.betaKey).toBeUndefined()
  })
})
