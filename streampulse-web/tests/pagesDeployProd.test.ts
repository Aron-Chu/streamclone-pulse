import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePageMetadata } from '../src/lib/pageMetadata'

const webRoot = resolve(import.meta.dirname, '..')
const deploymentScript = readFileSync(resolve(webRoot, 'scripts/pages-deploy-prod.mjs'), 'utf8')
const hostedRouteSmokeScript = readFileSync(resolve(webRoot, 'scripts/hosted-analytics-route-smoke.mjs'), 'utf8')
const viteConfig = readFileSync(resolve(webRoot, 'vite.config.ts'), 'utf8')

/**
 * The target of the first _redirects rule that matches `path`, as Pages reads
 * them: top to bottom, `:name` is one segment, `*` the rest.
 */
function firstRewrite(lines: string[], path: string): string | null {
  for (const line of lines) {
    const [from, to] = line.trim().split(/\s+/)
    if (!from || !to || from.startsWith('#')) continue
    const pattern = from.split('/').map(segment => segment === '*' ? '.*'
      : segment.startsWith(':') ? '[^/]+' : segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('/')
    if (new RegExp(`^${pattern}$`).test(path)) return to
  }
  return null
}

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

  // `npx vite build` skips npm's prebuild hook, which drops a recap whose review has expired.
  // Without its own refresh the deploy bundled the committed manifests, expired pages included.
  it('refreshes the recap manifests after the clean-tree check and before the production build', () => {
    const prepare = deploymentScript.indexOf("run('node', ['scripts/prepare-recap-pilot.mjs'])")
    const build = deploymentScript.indexOf("run('npx', ['vite', 'build'], buildEnv)")
    expect(prepare).toBeGreaterThan(deploymentScript.indexOf('\nassertCleanGitTree()\n'))
    expect(build).toBeGreaterThan(prepare)
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
    for (const path of ['/', '/analytics', '/help', '/status', '/privacy']) {
      expect(sitemap).toContain(`<loc>https://streampulse.stream${path}</loc>`)
    }
  })

  it('lists only pages that ask to be indexed, so Search Console reports no "submitted URL marked noindex"', () => {
    const sitemap = readFileSync(resolve(webRoot, 'public/sitemap.xml'), 'utf8')
    const paths = [...sitemap.matchAll(/<loc>https:\/\/streampulse\.stream(\/[^<]*)<\/loc>/g)].map(match => match[1])
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) expect(resolvePageMetadata(path).robots, path).toBe('index,follow')
    // Kept out of search on purpose: the Discord page only forwards to the invite,
    // and BrainChat is not out yet.
    for (const path of ['/discord', '/brainchat']) {
      expect(resolvePageMetadata(path).robots).toBe('noindex,nofollow')
      expect(paths).not.toContain(path)
    }
  })

  it('permits public retrieval while restricting model training', () => {
    const robots = readFileSync(resolve(webRoot, 'public/robots.txt'), 'utf8')
    const headers = readFileSync(resolve(webRoot, 'public/_headers'), 'utf8')
    expect(robots).toContain('Content-signal: search=yes, ai-input=yes, ai-train=no')
    for (const agent of ['CCBot', 'ClaudeBot', 'GPTBot', 'meta-externalagent']) {
      expect(robots).toMatch(new RegExp(`User-agent: ${agent}\\s+Disallow: /`, 'i'))
    }
    expect(headers).toContain('Content-Signal: search=yes, ai-input=yes')
    expect(headers).not.toContain('ai-train=no')
    expect(robots).toContain('User-agent: Google-Extended\nContent-signal: search=yes, ai-input=yes, ai-train=yes\nAllow: /')
  })

  it('ships static redirects for legacy analytics entrypoints and SPA deep links', () => {
    const redirects = readFileSync(resolve(webRoot, 'public/_redirects'), 'utf8')
    expect(redirects).toMatch(/\/analytics\/streams\s+\/analytics\s+301/)
    expect(redirects).toMatch(/\/analytics\/hub\s+\/analytics\s+301/)
    expect(redirects).toMatch(/\/atlas\s+\/analytics\s+301/)
    // The retired Explorer list goes to Moments at the edge. Its own query
    // replaces Explorer's, which Pages would otherwise pass through.
    for (const path of ['/analytics/explore', '/analytics/explore/']) {
      expect(redirects.split(/\r?\n/).find(line => line.startsWith(`${path} `))).toBe(`${path} /analytics/moments?view=recent 301`)
    }
    // An Explorer broadcast must reach the SPA (rewrite, not 301) so the client
    // can map its id onto the stream page. Moments keeps the plain shell too.
    // A clip and an old Newsroom story have two segments but are not stream
    // pages, so they keep the plain shell and download no console code.
    const plainShell = [
      '/analytics/explore/:broadcastId', '/analytics/explore/:broadcastId/', '/analytics/moments', '/analytics/moments/',
      '/analytics/clips/:clipId', '/analytics/clips/:clipId/', '/analytics/newsroom/:storyId', '/analytics/newsroom/:storyId/',
    ]
    for (const path of plainShell) {
      // Pages must serve the separate noindexed fallback while retaining the
      // requested URL; an .html target produces a browser redirect instead.
      expect(redirects.split(/\r?\n/).find(line => line.startsWith(`${path} `))).toBe(`${path} /analytics-fallback/ 200`)
    }
    // Stream and channel pages get the same shell with the console's code preloaded.
    for (const path of [
      '/analytics/:login', '/analytics/:login/',
      '/analytics/:login/:streamId', '/analytics/:login/:streamId/',
      '/analytics/:login/s/:streamId', '/analytics/:login/s/:streamId/',
      '/s/:login', '/s/:login/:streamId',
    ]) {
      expect(redirects.split(/\r?\n/).find(line => line.startsWith(`${path} `))).toBe(`${path} /analytics-console-fallback/ 200`)
    }
    // First match wins: Moments, clips and stories must not fall into the channel rules.
    const lines = redirects.split(/\r?\n/)
    const firstChannelRule = lines.indexOf('/analytics/:login /analytics-console-fallback/ 200')
    for (const path of plainShell.filter(path => !path.startsWith('/analytics/explore/'))) {
      expect(lines.indexOf(`${path} /analytics-fallback/ 200`), path).toBeGreaterThan(-1)
      expect(lines.indexOf(`${path} /analytics-fallback/ 200`), path).toBeLessThan(firstChannelRule)
    }
    expect(firstRewrite(lines, '/analytics/moments')).toBe('/analytics-fallback/')
    expect(firstRewrite(lines, '/analytics/clips/AwkwardHelplessSalamander')).toBe('/analytics-fallback/')
    expect(firstRewrite(lines, '/analytics/clips/AwkwardHelplessSalamander/')).toBe('/analytics-fallback/')
    expect(firstRewrite(lines, '/analytics/newsroom/story-1')).toBe('/analytics-fallback/')
    expect(firstRewrite(lines, '/analytics/xqc')).toBe('/analytics-console-fallback/')
    expect(firstRewrite(lines, '/analytics/xqc/321206426716')).toBe('/analytics-console-fallback/')
    expect(firstRewrite(lines, '/s/xqc/321206426716')).toBe('/analytics-console-fallback/')
  })

  it('temporarily redirects both install entry forms to the install section of Help', () => {
    const redirects = readFileSync(resolve(webRoot, 'public/_redirects'), 'utf8').split(/\r?\n/)
    expect(redirects).toContain('/install /help#install 302')
    expect(redirects).toContain('/install/ /help#install 302')
  })

  it('sends the old documentation aliases straight to their section of Help', () => {
    const redirects = readFileSync(resolve(webRoot, 'public/_redirects'), 'utf8').split(/\r?\n/)
    for (const [path, target] of [['/docs/getting-started', '/help#install'], ['/docs/coverage', '/help#coverage'], ['/docs/api', '/help#api']]) {
      expect(redirects).toContain(`${path} ${target} 301`)
      expect(redirects).toContain(`${path}/ ${target} 301`)
    }
    // No edge rule stops at /docs, which is now itself a redirect into Help.
    expect(redirects.filter(line => /^\/\S+ \/docs[#\s]/.test(line))).toEqual([])
  })

  it('moves the old Help pages and the timestamp builder for good at the edge', () => {
    const redirects = readFileSync(resolve(webRoot, 'public/_redirects'), 'utf8').split(/\r?\n/)
    for (const [path, target] of [
      ['/docs', '/help?from=docs'],
      ['/support', '/help?from=support'],
      ['/feedback', '/help#feedback'],
      ['/tools/twitch-vod-timestamp-link', '/guides/twitch-vod-timestamps'],
    ]) {
      expect(redirects).toContain(`${path} ${target} 301`)
      expect(redirects).toContain(`${path}/ ${target} 301`)
      expect(firstRewrite(redirects, path), path).toBe(target)
      expect(firstRewrite(redirects, `${path}/`), `${path}/`).toBe(target)
    }
  })

  it('rewrites every account deep link to its account shell', () => {
    const redirects = readFileSync(resolve(webRoot, 'public/_redirects'), 'utf8')
    for (const path of ['/account/sign-in', '/account/confirm', '/account/restore', '/account/link-device', '/account/settings', '/account/billing', '/account/billing/return']) {
      // An .html rewrite target is canonicalized into a browser redirect by
      // Pages; the account URL must retain the requested route.
      expect(redirects.split(/\r?\n/).find(line => line.startsWith(`${path} `))).toBe(`${path} /account-fallback/${path.slice('/account/'.length)}/ 200`)
      expect(redirects).toContain(`${path}/ ${path} 301`)
    }
    // Show my Twitch follows returns to a private route that moves itself to the hub.
    expect(redirects.split(/\r?\n/)).toContain('/account/twitch/callback /analytics-fallback/ 200')
    expect(redirects).toContain('/account/twitch/callback/ /account/twitch/callback 301')
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
    // Show my Twitch follows reads from Twitch and cancels its sign-in from the page.
    for (const policy of [enforced, readFileSync(resolve(webRoot, 'index.html'), 'utf8')]) {
      expect(policy).toMatch(/connect-src [^;]*https:\/\/api\.twitch\.tv https:\/\/id\.twitch\.tv;/)
    }
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
