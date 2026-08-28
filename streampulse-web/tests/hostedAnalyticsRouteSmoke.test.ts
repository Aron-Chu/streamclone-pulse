import { describe, expect, it, vi } from 'vitest'
import {
  HOSTED_ANALYTICS_DEEP_PATHS,
  verifyHostedAnalyticsRoutes,
} from '../scripts/hosted-analytics-route-smoke.mjs'

function response(status: number, body: string, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  })
}

describe('hosted analytics route smoke', () => {
  it('checks every supported deep-link shape without following redirects', async () => {
    const fetchImpl = vi.fn(async () => response(200, '<!doctype html><html><title>StreamPulse</title></html>'))

    const results = await verifyHostedAnalyticsRoutes({
      fetchImpl,
      origin: 'https://example.test',
    })

    expect(results).toHaveLength(HOSTED_ANALYTICS_DEEP_PATHS.length)
    expect(fetchImpl).toHaveBeenCalledTimes(HOSTED_ANALYTICS_DEEP_PATHS.length)
    for (const call of fetchImpl.mock.calls) {
      const [route, options] = call as unknown as [string | URL, RequestInit]
      expect(String(route)).toMatch(/^https:\/\/example\.test\/analytics\/fuslie(?:\/s)?\/320033532252\/?$/)
      expect(options).toEqual({ redirect: 'manual' })
    }
  })

  it('fails when the host redirects a deep link to the homepage', async () => {
    const fetchImpl = vi.fn(async () => response(308, '', { location: '/' }))

    await expect(
      verifyHostedAnalyticsRoutes({ fetchImpl, paths: [HOSTED_ANALYTICS_DEEP_PATHS[0]] }),
    ).rejects.toThrow(/redirected \(308\) to \/.*analytics\/fuslie/)
  })

  it('fails on a Pages 404 or a non-SPA HTML document', async () => {
    await expect(
      verifyHostedAnalyticsRoutes({
        fetchImpl: vi.fn(async () => response(404, '<!doctype html><html><title>Not found</title></html>')),
        paths: [HOSTED_ANALYTICS_DEEP_PATHS[0]],
      }),
    ).rejects.toThrow(/returned HTTP 404/)

    await expect(
      verifyHostedAnalyticsRoutes({
        fetchImpl: vi.fn(async () => response(200, '<!doctype html><html><title>Other app</title></html>')),
        paths: [HOSTED_ANALYTICS_DEEP_PATHS[0]],
      }),
    ).rejects.toThrow(/did not return the StreamPulse SPA document/)
  })
})
