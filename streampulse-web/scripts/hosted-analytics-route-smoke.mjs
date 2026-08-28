#!/usr/bin/env node
/**
 * Read-only post-deploy smoke for Cloudflare Pages analytics deep links.
 *
 * The SPA must be served directly for these paths. A redirect to `/`, a
 * Pages 404, or an HTML document that is not the StreamPulse app means the
 * deployed route is not usable by links emitted from the portal.
 */

export const HOSTED_ANALYTICS_ORIGIN = 'https://streampulse.stream'

export const HOSTED_ANALYTICS_DEEP_PATHS = [
  '/analytics/fuslie/320033532252',
  '/analytics/fuslie/320033532252/',
  '/analytics/fuslie/s/320033532252',
  '/analytics/fuslie/s/320033532252/',
]

function assertSpaDocument(response, route) {
  const location = response.headers.get('location') || ''
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`hosted analytics route redirected (${response.status}) to ${location || '<missing location>'}: ${route}`)
  }
  if (!response.ok) {
    throw new Error(`hosted analytics route returned HTTP ${response.status}: ${route}`)
  }
  return response.text().then((body) => {
    if (!/<html\b/i.test(body) || !/StreamPulse/i.test(body)) {
      throw new Error(`hosted analytics route did not return the StreamPulse SPA document: ${route}`)
    }
    return { route, status: response.status }
  })
}

/**
 * Verify all supported analytics deep-link shapes without following redirects.
 * A fetch implementation can be supplied by tests; production uses global fetch.
 */
export async function verifyHostedAnalyticsRoutes({
  fetchImpl = fetch,
  origin = HOSTED_ANALYTICS_ORIGIN,
  paths = HOSTED_ANALYTICS_DEEP_PATHS,
} = {}) {
  const results = []
  for (const path of paths) {
    const route = new URL(path, origin).toString()
    const response = await fetchImpl(route, { redirect: 'manual' })
    results.push(await assertSpaDocument(response, route))
  }
  return results
}

async function main() {
  const results = await verifyHostedAnalyticsRoutes()
  console.log(`hosted analytics route smoke OK (${results.length} deep links)`)
}

const entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : ''
if (entry.endsWith('hosted-analytics-route-smoke.mjs')) {
  try {
    await main()
  } catch (error) {
    console.error(`hosted analytics route smoke failed: ${error instanceof Error ? error.message : String(error)}`)
    // Let fetch/undici finish closing sockets cleanly on Windows and CI.
    process.exitCode = 1
  }
}
