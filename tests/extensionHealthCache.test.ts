import { describe, expect, it, vi } from 'vitest'
import {
  HEALTH_FAILURE_TTL_MS,
  HEALTH_SUCCESS_TTL_MS,
  createExtensionHealthCache,
} from '../src/background/extensionHealthCache.ts'

const health = { ok: true, version: 'v1', time: 1 }

describe('extension health cache', () => {
  it('caches successes for 30 seconds and force bypasses the cache', async () => {
    let now = 1_000
    const load = vi.fn(async () => health)
    const cache = createExtensionHealthCache({ now: () => now })

    await expect(cache.read('https://example.test', load)).resolves.toMatchObject({ ok: true, cached: false })
    now += HEALTH_SUCCESS_TTL_MS - 1
    await expect(cache.read('https://example.test', load)).resolves.toMatchObject({ ok: true, cached: true })
    expect(load).toHaveBeenCalledTimes(1)

    await expect(cache.read('https://example.test', load, { force: true })).resolves.toMatchObject({ ok: true, cached: false })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('isolates backend keys and retries cached failures after five seconds', async () => {
    let now = 2_000
    const failing = vi.fn(async () => { throw new Error('offline') })
    const cache = createExtensionHealthCache({ now: () => now })

    await expect(cache.read('https://a.test', failing)).resolves.toMatchObject({ ok: false, cached: false, error: 'offline' })
    await expect(cache.read('https://a.test', failing)).resolves.toMatchObject({ ok: false, cached: true })
    await expect(cache.read('https://b.test', failing)).resolves.toMatchObject({ ok: false, cached: false })
    expect(failing).toHaveBeenCalledTimes(2)

    now += HEALTH_FAILURE_TTL_MS
    await cache.read('https://a.test', failing)
    expect(failing).toHaveBeenCalledTimes(3)
  })

  it('uses the short failure TTL when a resolved health response is not ok', async () => {
    let now = 3_000
    const load = vi.fn(async () => ({ ...health, ok: false }))
    const cache = createExtensionHealthCache({ now: () => now })

    await expect(cache.read('https://example.test', load)).resolves.toMatchObject({
      ok: false,
      cached: false,
      error: 'health_not_ok',
    })
    now += HEALTH_FAILURE_TTL_MS - 1
    await expect(cache.read('https://example.test', load)).resolves.toMatchObject({ ok: false, cached: true })
    now += 1
    await expect(cache.read('https://example.test', load)).resolves.toMatchObject({ ok: false, cached: false })
    expect(load).toHaveBeenCalledTimes(2)
  })
})
