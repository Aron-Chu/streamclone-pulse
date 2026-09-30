import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const webRoot = resolve(import.meta.dirname, '..')
const deploymentScript = readFileSync(resolve(webRoot, 'scripts/pages-deploy-prod.mjs'), 'utf8')
const hostedRouteSmokeScript = readFileSync(resolve(webRoot, 'scripts/hosted-analytics-route-smoke.mjs'), 'utf8')
const viteConfig = readFileSync(resolve(webRoot, 'vite.config.ts'), 'utf8')

describe('Cloudflare Pages production deployment hygiene', () => {
  it('uses the pinned local Wrangler and protects production deploys', () => {
    expect(deploymentScript).toContain('ALLOW_DIRTY_PAGES_DEPLOY')
    expect(deploymentScript).toContain('node_modules/.bin/wrangler')
    expect(deploymentScript).not.toContain("['wrangler', ...deployArgs]")
  })

  it('runs release checks, tests, a production build, and prerender before deploy', () => {
    expect(deploymentScript).toContain("['tsc', '--noEmit', '-p', 'tsconfig.json']")
    expect(deploymentScript).toContain("['tsc', '--noEmit', '-p', 'tsconfig.test.json']")
    expect(deploymentScript).toContain("['test', '--', '--reporter=dot']")
    expect(deploymentScript).toContain('check-analytics-tailwind.mjs')
    expect(deploymentScript).toContain('check-analytics-routes-spa.mjs')
    expect(deploymentScript).toContain('check-analytics-links.mjs')
    expect(deploymentScript).toContain('check-analytics-overlap.mjs')
    expect(deploymentScript).toContain("['vite', 'build']")
    expect(deploymentScript).toContain('scripts/prerender.mjs')
    expect(deploymentScript).toContain('scripts/check-public-pages.mjs')
    expect(deploymentScript).toContain('scripts/check-backend-url.mjs')
  })

  it('verifies hosted analytics and account routes after Pages deploy', () => {
    expect(deploymentScript).toContain("from './hosted-analytics-route-smoke.mjs'")
    expect(deploymentScript).toContain('verifyHostedAnalyticsRoutes')
    expect(deploymentScript).toContain('await verifyHostedAccountRoutes()')
    expect(deploymentScript).toContain('SKIP_HOSTED_ROUTE_SMOKE')
    expect(hostedRouteSmokeScript).toContain("redirect: 'manual'")
  })

  it('ships crawl discovery files for every indexable public route', () => {
    const robots = readFileSync(resolve(webRoot, 'public/robots.txt'), 'utf8')
    const sitemap = readFileSync(resolve(webRoot, 'public/sitemap.xml'), 'utf8')
    expect(robots).toContain('Sitemap: https://streampulse.stream/sitemap.xml')
    for (const path of ['/', '/analytics', '/docs', '/status', '/privacy', '/support']) {
      expect(sitemap).toContain(`<loc>https://streampulse.stream${path}</loc>`)
    }
  })

  it('preserves search discovery while opting out of AI model use', () => {
    const robots = readFileSync(resolve(webRoot, 'public/robots.txt'), 'utf8')
    const headers = readFileSync(resolve(webRoot, 'public/_headers'), 'utf8')
    expect(robots).toContain('Content-signal: search=yes, ai-input=no, ai-train=no, use=reference')
    for (const agent of ['CCBot', 'ClaudeBot', 'GPTBot', 'Google-Extended', 'meta-externalagent']) {
      expect(robots).toMatch(new RegExp(`User-agent: ${agent}\\s+Disallow: /`, 'i'))
    }
    expect(headers).toContain('Content-Signal: search=yes, ai-input=no, ai-train=no, use=reference')
  })

  it('ships static redirects for legacy analytics entrypoints and SPA deep links', () => {
    const redirects = readFileSync(resolve(webRoot, 'public/_redirects'), 'utf8')
    expect(redirects).toMatch(/\/analytics\/streams\s+\/analytics\s+301/)
    expect(redirects).toMatch(/\/analytics\/hub\s+\/analytics\s+301/)
    expect(redirects).toMatch(/\/atlas\s+\/analytics\s+301/)
    // Explorer must reach the SPA (rewrite, not 301) so the client can map
    // broadcastId/window onto Moments instead of dropping them at the edge.
    for (const path of [
      '/analytics/explore', '/analytics/explore/',
      '/analytics/explore/:broadcastId', '/analytics/explore/:broadcastId/',
      '/analytics/:login', '/analytics/:login/',
      '/analytics/:login/:streamId', '/analytics/:login/:streamId/',
      '/analytics/:login/s/:streamId', '/analytics/:login/s/:streamId/',
      '/s/:login', '/s/:login/:streamId',
    ]) {
      // Pages must serve the canonical asset internally while retaining the
      // requested URL; an .html target produces a browser redirect instead.
      expect(redirects.split(/\r?\n/).find(line => line.startsWith(`${path} `))).toBe(`${path} /analytics/ 200`)
    }
  })

  it('rewrites every account deep link to the private SPA entry', () => {
    const redirects = readFileSync(resolve(webRoot, 'public/_redirects'), 'utf8')
    for (const path of ['/account/sign-in', '/account/confirm', '/account/link-device', '/account/settings', '/account/billing', '/account/billing/return']) {
      // An .html rewrite target is canonicalized into a browser redirect by
      // Pages; the account URL must retain the requested route.
      expect(redirects.split(/\r?\n/).find(line => line.startsWith(`${path} `))).toBe(`${path} / 200`)
      expect(redirects).toContain(`${path}/ ${path} 301`)
    }
  })

  it('ships Pages security and cache headers', () => {
    const headers = readFileSync(resolve(webRoot, 'public/_headers'), 'utf8')
    expect(headers).toContain('X-Content-Type-Options: nosniff')
    expect(headers).not.toContain('Content-Security-Policy-Report-Only:')
    const enforced = headers.split(/\r?\n/).find(line => /^\s+Content-Security-Policy:/.test(line))
    expect(enforced).toContain("object-src 'none'")
    expect(enforced).toContain("frame-ancestors 'none'")
    expect(enforced).toContain("script-src 'self' https://challenges.cloudflare.com")
    expect(enforced).not.toContain("'unsafe-eval'")
    expect(headers).toContain('/assets/*')
    expect(headers).toContain('/static/*')
    expect(headers).toContain('Cache-Control: public, max-age=31536000, immutable')
  })

  it('allows only the local StreamPulse BFF in development CSP', () => {
    expect(viteConfig).toContain('http://localhost:8081')
    expect(viteConfig).toContain('http://127.0.0.1:8081')
    expect(viteConfig).not.toContain('localhost:8090')
    expect(viteConfig).not.toContain('laptopworker')
  })
})
