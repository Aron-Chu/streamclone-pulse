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

  it('verifies a hosted analytics deep route after Pages deploy', () => {
    expect(deploymentScript).toContain("from './hosted-analytics-route-smoke.mjs'")
    expect(deploymentScript).toContain('verifyHostedAnalyticsRoutes')
    expect(deploymentScript).toContain('SKIP_HOSTED_ROUTE_SMOKE')
    expect(hostedRouteSmokeScript).toContain("redirect: 'manual'")
    expect(hostedRouteSmokeScript).toContain('hosted analytics route did not return the StreamPulse SPA document')
  })

  it('ships crawl discovery files for every indexable public route', () => {
    const robots = readFileSync(resolve(webRoot, 'public/robots.txt'), 'utf8')
    const sitemap = readFileSync(resolve(webRoot, 'public/sitemap.xml'), 'utf8')
    expect(robots).toContain('Sitemap: https://streampulse.stream/sitemap.xml')
    for (const path of ['/', '/analytics', '/docs', '/status', '/privacy', '/support']) {
      expect(sitemap).toContain(`<loc>https://streampulse.stream${path}</loc>`)
    }
  })

  it('ships static redirects for legacy analytics entrypoints and SPA deep links', () => {
    const redirects = readFileSync(resolve(webRoot, 'public/_redirects'), 'utf8')
    expect(redirects).toMatch(/\/analytics\/streams\s+\/analytics\s+301/)
    expect(redirects).toMatch(/\/analytics\/hub\s+\/analytics\s+301/)
    expect(redirects).toMatch(/\/atlas\s+\/analytics\s+301/)
    expect(redirects).toMatch(/\/analytics\/newsroom\s+\/analytics\/\s+200/)
    expect(redirects).toMatch(/\/analytics\/\*\s+\/analytics\/\s+200/)
    expect(redirects).toMatch(/\/analytics\/:login\/:streamId\s+\/analytics\/\s+200/)
    expect(redirects).toMatch(/\/s\/:login\s+\/analytics\/\s+200/)
    expect(redirects).toMatch(/\/s\/:login\/:streamId\s+\/analytics\/\s+200/)
  })

  it('ships Pages security and cache headers', () => {
    const headers = readFileSync(resolve(webRoot, 'public/_headers'), 'utf8')
    expect(headers).toContain('X-Content-Type-Options: nosniff')
    expect(headers).toContain('Content-Security-Policy-Report-Only:')
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
