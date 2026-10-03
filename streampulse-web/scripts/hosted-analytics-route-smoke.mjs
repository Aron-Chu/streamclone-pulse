#!/usr/bin/env node
/**
 * Read-only post-deploy smoke for Cloudflare Pages analytics and account routes.
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

export const HOSTED_ACCOUNT_PATHS = [
  '/account/sign-in',
  '/account/confirm',
  '/account/restore',
  '/account/link-device',
  '/account/settings',
  '/account/billing',
  '/account/billing/return',
  '/supporter/thanks',
  '/account/twitch/callback',
  '/account/moments',
]

function assertSpaDocument(response, route, surface) {
  const location = response.headers.get('location') || ''
  if ((response.status >= 300 && response.status < 400) || response.redirected) {
    const destination = location || (response.redirected ? response.url : '') || '<missing location>'
    throw new Error(`hosted ${surface} route redirected (${response.status}) to ${destination}: ${route}`)
  }
  if (!response.ok) {
    throw new Error(`hosted ${surface} route returned HTTP ${response.status}: ${route}`)
  }
  return response.text().then((body) => {
    if (!/<html\b/i.test(body) || !/StreamPulse/i.test(body)) {
      throw new Error(`hosted ${surface} route did not return the StreamPulse SPA document: ${route}`)
    }
    return { route, status: response.status }
  })
}

/**
 * Verify the supplied hosted routes without following redirects.
 * A fetch implementation can be supplied by tests; production uses global fetch.
 */
async function verifyHostedRoutes({ fetchImpl, origin, paths }, surface) {
  const results = []
  for (const path of paths) {
    const route = new URL(path, origin).toString()
    const response = await fetchImpl(route, { redirect: 'manual' })
    results.push(await assertSpaDocument(response, route, surface))
  }
  return results
}

export async function verifyHostedAnalyticsRoutes({
  fetchImpl = fetch,
  origin = HOSTED_ANALYTICS_ORIGIN,
  paths = HOSTED_ANALYTICS_DEEP_PATHS,
} = {}) {
  return verifyHostedRoutes({ fetchImpl, origin, paths }, 'analytics')
}

/** Verify the canonical account entrypoints without following redirects. */
export async function verifyHostedAccountRoutes({
  fetchImpl = fetch,
  origin = HOSTED_ANALYTICS_ORIGIN,
  paths = HOSTED_ACCOUNT_PATHS,
} = {}) {
  return verifyHostedRoutes({ fetchImpl, origin, paths }, 'account')
}

async function main() {
  const analytics = await verifyHostedAnalyticsRoutes()
  const accounts = await verifyHostedAccountRoutes()
  console.log(`hosted route smoke OK (${analytics.length} analytics deep links, ${accounts.length} account routes)`)
}

const entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : ''
if (entry.endsWith('hosted-analytics-route-smoke.mjs')) {
  try {
    await main()
  } catch (error) {
    console.error(`hosted route smoke failed: ${error instanceof Error ? error.message : String(error)}`)
    // Let fetch/undici finish closing sockets cleanly on Windows and CI.
    process.exitCode = 1
  }
}
