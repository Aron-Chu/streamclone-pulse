import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizePublicHub } from '../src/lib/publicHub'
import { clearPublicHubCacheForTests, publicHubCacheKey, readPublicHubCache, writePublicHubCache } from '../src/lib/publicHubCache'

const backend = 'local-test'
const now = 1_800_000_000_000

function hub() {
  const generatedAt = new Date(now).toISOString()
  return normalizePublicHub({ generatedAt, corpusPipeline: { generatedAt, state: 'healthy' } })
}

describe('saved hub data age', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    clearPublicHubCacheForTests()
    localStorage.clear()
  })
  afterEach(() => vi.useRealTimers())

  it('stores source age separately from save time and preserves it for an identical body', () => {
    const data = hub()
    writePublicHubCache(backend, '24h', data, undefined, now - 300_000)
    vi.setSystemTime(now + 60_000)
    writePublicHubCache(backend, '24h', structuredClone(data), undefined, now - 60_000)
    expect(readPublicHubCache(backend, '24h')).toMatchObject({ cachedAt: now, dataAsOf: now - 300_000 })
  })

  it('may fill a missing source age without extending saved-copy lifetime', () => {
    const data = hub()
    writePublicHubCache(backend, '30m', data, undefined, null)
    vi.setSystemTime(now + 60_000)
    writePublicHubCache(backend, '30m', structuredClone(data), undefined, now - 300_000)
    expect(readPublicHubCache(backend, '30m')).toMatchObject({ cachedAt: now, dataAsOf: now - 300_000 })
    vi.setSystemTime(now + 11 * 60_000)
    expect(readPublicHubCache(backend, '30m')).toBeNull()
  })

  it.each([undefined, null])('bounds an identical-body age upgrade to the original save time (%s)', (previousAge) => {
    const data = hub()
    writePublicHubCache(backend, '30m', data, undefined, previousAge)
    vi.setSystemTime(now + 60_000)
    writePublicHubCache(backend, '30m', structuredClone(data), undefined, now + 30_000)
    const key = publicHubCacheKey(backend, '30m')
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ cachedAt: now, dataAsOf: now })
    expect(readPublicHubCache(backend, '30m')).toMatchObject({ cachedAt: now, dataAsOf: now })
    vi.setSystemTime(now + 11 * 60_000)
    expect(readPublicHubCache(backend, '30m')).toBeNull()
  })

  it('bounds a previously saved later age when loading an older entry', () => {
    writePublicHubCache(backend, '24h', hub(), undefined, now - 60_000)
    const key = publicHubCacheKey(backend, '24h')
    const entry = JSON.parse(localStorage.getItem(key)!)
    vi.setSystemTime(now + 60_000)
    localStorage.setItem(key, JSON.stringify({ ...entry, dataAsOf: now + 30_000 }))
    expect(readPublicHubCache(backend, '24h')).toMatchObject({ cachedAt: now, dataAsOf: now })
  })

  it('treats legacy, malformed, and future source ages as unknown', () => {
    writePublicHubCache(backend, '24h', hub())
    const key = publicHubCacheKey(backend, '24h')
    const entry = JSON.parse(localStorage.getItem(key)!)
    expect(readPublicHubCache(backend, '24h')?.dataAsOf).toBeNull()
    for (const dataAsOf of ['broken', -1, now + 1, null]) {
      localStorage.setItem(key, JSON.stringify({ ...entry, dataAsOf }))
      expect(readPublicHubCache(backend, '24h')?.dataAsOf).toBeNull()
    }
  })
})
