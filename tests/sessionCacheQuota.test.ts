import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSessionPulse, setSessionPulse, type PulseCacheEntry } from '../src/shared/storage'

describe('analytics session cache quota recovery', () => {
  let stored: Record<string, unknown>
  let set: ReturnType<typeof vi.fn>
  let bytes: ReturnType<typeof vi.fn>
  const entry = (): PulseCacheEntry => ({
    payload: { login: 'xqc', rollups: [] } as unknown as PulseCacheEntry['payload'],
    fetchedAt: Date.now(), window: 'full', streamId: 'stream1',
  })

  beforeEach(() => {
    stored = { auth: 'preserve', vodNavigation: { offset: 123 } }
    set = vi.fn(async (items: Record<string, unknown>) => { Object.assign(stored, items) })
    bytes = vi.fn(async () => 1024)
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension' },
      storage: { session: {
        get: vi.fn(async (keys: string | string[] | null) => keys == null ? { ...stored }
          : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, stored[key]]))),
        set,
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]
        }),
        getBytesInUse: bytes,
      } },
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('reclaims only analytics and retries a quota failure once', async () => {
    stored['coverage:old'] = { fetchedAt: Date.now() }
    set.mockRejectedValueOnce(new Error('Session storage quota bytes exceeded. Values were not stored.'))
    await setSessionPulse('xqc', entry())
    expect(set).toHaveBeenCalledTimes(2)
    expect(stored['coverage:old']).toBeUndefined()
    expect(stored.auth).toBe('preserve')
    expect(stored.vodNavigation).toEqual({ offset: 123 })
    expect(await getSessionPulse('xqc', 'full', 'stream1')).not.toBeNull()
  })

  it('leaves an oversized response uncached without failing the request', async () => {
    set.mockRejectedValue(new Error('Session storage quota bytes exceeded. Values were not stored.'))
    await expect(setSessionPulse('xqc', entry())).resolves.toBeUndefined()
    expect(set).toHaveBeenCalledTimes(2)
    expect(await getSessionPulse('xqc', 'full')).toBeNull()
    expect(stored.auth).toBe('preserve')
  })

  it('evicts expired entries even when that channel is never read again', async () => {
    stored['pulse:old:full'] = { ...entry(), fetchedAt: Date.now() - 46_000 }
    stored['coverage:old'] = { fetchedAt: Date.now() - 61_000 }
    await setSessionPulse('xqc', entry())
    expect(stored['pulse:old:full']).toBeUndefined()
    expect(stored['coverage:old']).toBeUndefined()
  })

  it('bounds concurrent channel cache writes', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => setSessionPulse(`channel${i}`, entry())))
    expect(Object.keys(stored).filter(key => key.startsWith('pulse:'))).toHaveLength(24)
    expect(stored['pulse:channel0:full']).toBeUndefined()
    expect(stored['pulse:channel19:full']).toBeDefined()
  })

  it('releases cache under memory pressure without removing unrelated data', async () => {
    bytes.mockImplementation(async () => Object.keys(stored).some(key => key.startsWith('pulse:'))
      ? 7 * 1024 * 1024 : 1024)
    await setSessionPulse('xqc', entry())
    expect(stored).toEqual({ auth: 'preserve', vodNavigation: { offset: 123 } })
  })

  it('does not swallow unexpected failures or poison the write queue', async () => {
    set.mockRejectedValueOnce(new Error('Unexpected storage failure'))
    await expect(setSessionPulse('xqc', entry())).rejects.toThrow('Unexpected storage failure')
    await expect(setSessionPulse('xqc', entry())).resolves.toBeUndefined()
  })
})
