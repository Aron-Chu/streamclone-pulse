import { describe, expect, it, vi } from 'vitest'
import {
  HOSTED_ANALYTICS_DEEP_PATHS,
  HOSTED_ACCOUNT_PATHS,
  verifyHostedAccountRoutes,
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

describe('hosted account route smoke', () => {
  const canonicalPaths = [
    '/account/sign-in',
    '/account/confirm',
    '/account/link-device',
    '/account/settings',
    '/account/billing',
    '/account/billing/return',
  ]

  it('checks all six account entrypoints directly without following redirects', async () => {
    const fetchImpl = vi.fn(async () => response(200, '<!doctype html><html><title>StreamPulse</title></html>'))

    const results = await verifyHostedAccountRoutes({ fetchImpl, origin: 'https://example.test' })

    expect(HOSTED_ACCOUNT_PATHS).toEqual(canonicalPaths)
    expect(results).toEqual(canonicalPaths.map((path) => ({ route: `https://example.test${path}`, status: 200 })))
    expect(fetchImpl.mock.calls).toEqual(canonicalPaths.map((path) => [
      `https://example.test${path}`,
      { redirect: 'manual' },
    ]))
  })

  it.each(canonicalPaths)('rejects a homepage 308 at %s even when following it would return the SPA', async (path) => {
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) =>
      init?.redirect === 'manual'
        ? response(308, '', { location: '/' })
        : response(200, '<!doctype html><html><title>StreamPulse</title></html>'),
    )

    await expect(verifyHostedAccountRoutes({ fetchImpl, paths: [path] }))
      .rejects.toThrow(`hosted account route redirected (308) to /: https://streampulse.stream${path}`)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl).toHaveBeenCalledWith(`https://streampulse.stream${path}`, { redirect: 'manual' })
  })

  it.each([300, 301, 302, 303, 304, 305, 306, 307, 308, 399])('rejects HTTP %i instead of accepting a redirect', async (status) => {
    const fetchImpl = vi.fn(async () => new Response(null, { status, headers: { location: '/account/settings' } }))

    await expect(verifyHostedAccountRoutes({ fetchImpl, paths: ['/account/sign-in'] }))
      .rejects.toThrow(`hosted account route redirected (${status})`)
  })

  it('rejects a homepage 200 after an accidental automatic redirect', async () => {
    const homepage = response(200, '<!doctype html><html><title>StreamPulse</title></html>')
    Object.defineProperties(homepage, {
      redirected: { value: true },
      url: { value: 'https://streampulse.stream/' },
    })

    await expect(verifyHostedAccountRoutes({
      fetchImpl: vi.fn(async () => homepage),
      paths: ['/account/sign-in'],
    })).rejects.toThrow('hosted account route redirected (200) to https://streampulse.stream/')
  })

  it('rejects missing account routes and non-SPA documents', async () => {
    await expect(verifyHostedAccountRoutes({
      fetchImpl: vi.fn(async () => response(404, '<html><title>Not found</title></html>')),
      paths: ['/account/billing/return'],
    })).rejects.toThrow('hosted account route returned HTTP 404')

    await expect(verifyHostedAccountRoutes({
      fetchImpl: vi.fn(async () => response(200, '<html><title>Other app</title></html>')),
      paths: ['/account/billing/return'],
    })).rejects.toThrow('hosted account route did not return the StreamPulse SPA document')
  })
})
