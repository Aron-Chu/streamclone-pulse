import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('pulseDebug storage access levels', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('routes content-script debug append through runtime messaging', async () => {
    const sendMessage = vi.fn((_msg: unknown, cb?: (r: unknown) => void) => {
      cb?.({ ok: true })
    })
    const localGet = vi.fn()
    const localSet = vi.fn()

    vi.stubGlobal('location', { href: 'https://www.twitch.tv/ninja' })
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'test-ext',
        sendMessage,
        lastError: undefined,
      },
      storage: {
        sync: {
          get: vi.fn(async () => ({ debugLoggingEnabled: true })),
          set: vi.fn(async () => undefined),
          onChanged: { addListener: vi.fn() },
        },
        local: {
          get: localGet,
          set: localSet,
          remove: vi.fn(),
        },
        onChanged: { addListener: vi.fn() },
      },
    })

    const { initPulseDebug, pulseDebug, canAccessLocalStorageDirectly } = await import(
      '../src/shared/pulseDebug'
    )
    expect(canAccessLocalStorageDirectly()).toBe(false)
    await initPulseDebug()
    await pulseDebug('ui.coverage', 'content path', { n: 1 })

    expect(localGet).not.toHaveBeenCalled()
    expect(localSet).not.toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'APPEND_PULSE_DEBUG',
        entry: expect.objectContaining({
          step: 'ui.coverage',
          message: 'content path',
        }),
      }),
      expect.any(Function),
    )
  })

  it('writes debug logs directly from trusted extension contexts', async () => {
    const sendMessage = vi.fn()
    const areas: Record<string, unknown> = {}

    vi.stubGlobal('location', { href: 'chrome-extension://testid/options.html' })
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'test-ext',
        sendMessage,
        lastError: undefined,
      },
      storage: {
        sync: {
          get: vi.fn(async () => ({ debugLoggingEnabled: true })),
          set: vi.fn(async () => undefined),
          onChanged: { addListener: vi.fn() },
        },
        local: {
          get: vi.fn(async (keys?: string | string[]) => {
            const list = keys == null ? Object.keys(areas) : Array.isArray(keys) ? keys : [keys]
            const out: Record<string, unknown> = {}
            for (const key of list) {
              if (key in areas) out[key] = areas[key]
            }
            return out
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(areas, items)
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete areas[key]
          }),
        },
        onChanged: { addListener: vi.fn() },
      },
    })

    const { initPulseDebug, pulseDebug, getPulseDebugLog, canAccessLocalStorageDirectly } =
      await import('../src/shared/pulseDebug')
    expect(canAccessLocalStorageDirectly()).toBe(true)
    await initPulseDebug()
    await pulseDebug('ui.coverage', 'trusted path')

    expect(sendMessage).not.toHaveBeenCalled()
    const entries = await getPulseDebugLog()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.message).toBe('trusted path')
  })

  it('restrictCredentialStorageAccess requests TRUSTED_CONTEXTS on local storage', async () => {
    const setAccessLevel = vi.fn(async () => undefined)
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-ext' },
      storage: {
        sync: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
        },
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
          setAccessLevel,
        },
        session: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
        },
      },
      permissions: {
        contains: vi.fn(async () => false),
        request: vi.fn(async () => true),
      },
    })

    const { restrictCredentialStorageAccess } = await import('../src/shared/storage')
    await restrictCredentialStorageAccess()
    expect(setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' })
  })
})
