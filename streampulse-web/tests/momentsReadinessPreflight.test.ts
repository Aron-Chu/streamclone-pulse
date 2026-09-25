import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkLocalReadinessBFF, frozenExploreScope, isAllowedReadinessDataRequest } from './e2e/moments-readiness-preflight'

function json(body: object): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function extensionHealth(): Response {
  return json({ ok: true, version: 'dev', time: 1_790_000_000_000, routes: { pulseChannel: true, pulseCoverage: true } })
}

afterEach(() => vi.unstubAllGlobals())

describe('local real-data readiness preflight', () => {
  it('pins the approved Explore query to a completed UTC date window', () => {
    expect(frozenExploreScope('/analytics/moments?view=explore&period=custom&from=2026-09-10&to=2026-09-12&sort=volume&creator=dona', new Date('2026-09-13T00:00:00Z')))
      .toEqual({ from: '2026-09-10', to: '2026-09-13', login: 'dona', category: '', categoryMissing: false })
  })

  it('rejects today and future UTC days even if a manifest names them', () => {
    const now = new Date('2026-09-13T00:00:00Z')
    for (const to of ['2026-09-13', '2026-09-14']) {
      expect(() => frozenExploreScope(`/analytics/moments?view=explore&period=custom&from=2026-09-12&to=${to}&sort=volume`, now))
        .toThrow('fixed 1–30 day volume Explore path')
    }
  })

  it('rejects hosted or mutating data requests beyond the v1 path', () => {
    expect(isAllowedReadinessDataRequest(new URL('http://127.0.0.1:8081/v1/public/discovery/ranked'), 'GET', 'fetch')).toBe(true)
    expect(isAllowedReadinessDataRequest(new URL('https://api.streampulse.stream/v2/ranked'), 'GET', 'fetch')).toBe(false)
    expect(isAllowedReadinessDataRequest(new URL('https://api.streampulse.stream/graphql'), 'POST', 'xhr')).toBe(false)
    expect(isAllowedReadinessDataRequest(new URL('https://api.streampulse.stream/v1/public/media'), 'GET', 'image')).toBe(false)
    expect(isAllowedReadinessDataRequest(new URL('http://127.0.0.1:8081/v1/public/discovery/ranked'), 'POST', 'fetch')).toBe(false)
  })

  it.each([
    '/analytics/moments?view=explore&sort=volume',
    '/analytics/moments?view=explore&period=custom&from=2026-09-10&to=2026-09-12',
    '/analytics/moments?view=explore&period=custom&from=2026-09-12&to=2026-09-10&sort=volume',
    '/analytics/moments?view=explore&period=custom&from=2026-09-10&to=2026-09-12&sort=volume&from=2026-09-11',
    '/analytics/moments?view=explore&period=custom&from=2026-09-10&to=2026-09-12&sort=volume&unexpected=1',
  ])('rejects a drifting or ambiguous approved scope: %s', path => {
    expect(() => frozenExploreScope(path)).toThrow('fixed 1–30 day volume Explore path')
  })

  it('rejects a nonlocal origin before any request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(checkLocalReadinessBFF('https://api.streampulse.stream')).rejects.toThrow('backend origin must be local :8081')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects an unrelated service on port 8081', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ status: 'ok', service: 'watch' }))
    vi.stubGlobal('fetch', fetch)
    await expect(checkLocalReadinessBFF('http://127.0.0.1:8081')).rejects.toThrow('did not return the StreamPulse extension health contract')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:8081/v1/extension/health')
  })

  it('rejects a healthy extension when its database is not ready', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/extension/health')) return extensionHealth()
      if (url.endsWith('/readyz')) return new Response('database unavailable', { status: 503 })
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    await expect(checkLocalReadinessBFF('http://127.0.0.1:8081')).rejects.toThrow('database readiness returned HTTP 503')
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:8081/v1/extension/health',
      'http://127.0.0.1:8081/readyz',
    ])
  })

  it('requires an explicit HTTP 200 database-ready response', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('/v1/extension/health') ? extensionHealth() : new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    await expect(checkLocalReadinessBFF('http://127.0.0.1:8081')).rejects.toThrow('database readiness returned HTTP 204')
  })

  it('accepts analytics identity, database readiness, and extension health together', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/extension/health')) return extensionHealth()
      if (url.endsWith('/readyz')) return new Response(null, { status: 200 })
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    await expect(checkLocalReadinessBFF('http://localhost:8081')).resolves.toBeUndefined()
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:8081/v1/extension/health',
      'http://localhost:8081/readyz',
    ])
  })
})
