import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CANONICAL_PORTAL_ORIGIN,
  COMMUNITY_LINKS,
  deviceLinkWithCode,
  POLICY_LINKS,
  portalOriginOrCanonical,
  productLink,
} from '../src/shared/portalLinks.ts'
import { contentScriptModules } from './helpers/contentGraph.ts'
import { listSourceFiles } from './helpers/sourceFiles.ts'

/**
 * Every published StreamPulse link lives in one registry. These tests encode the
 * two properties that were actually broken before it existed: some links carried
 * a trailing slash (a redirect hop on every click) and the account links ignored
 * the configured portal origin, so a dev build pointed at production.
 */
describe('portal link registry', () => {
  it('publishes canonical, slash-free HTTPS policy links', () => {
    const links = Object.values(POLICY_LINKS)
    expect(links.length).toBeGreaterThanOrEqual(4)
    for (const link of links) {
      const url = new URL(link)
      expect(url.protocol).toBe('https:')
      expect(url.hostname).toBe('streampulse.stream')
      expect(url.port).toBe('')
      // Canonical tags and sitemap.xml use the bare path; a trailing slash is a
      // redirect hop, and a query or fragment is not part of a policy address.
      expect(url.pathname.endsWith('/')).toBe(false)
      expect(url.search).toBe('')
      expect(url.hash).toBe('')
    }
    expect(new Set(links).size).toBe(links.length)
  })

  it('keeps policy links on production even when a dev portal is configured', () => {
    // A localhost portal has no privacy policy. The published policy is one
    // canonical document, so a configured origin must not rewrite it.
    expect(POLICY_LINKS.privacy).toBe(`${CANONICAL_PORTAL_ORIGIN}/privacy`)
    expect(POLICY_LINKS.terms).toBe(`${CANONICAL_PORTAL_ORIGIN}/terms`)
    expect(POLICY_LINKS.refunds).toBe(`${CANONICAL_PORTAL_ORIGIN}/refunds`)
  })

  it('keeps the community links on fixed, slash-free production pages', () => {
    // The extension's contract with the website: /feedback holds the private
    // feedback form and /discord holds the invite. A dev origin never rewrites them.
    expect(COMMUNITY_LINKS).toEqual({ feedback: `${CANONICAL_PORTAL_ORIGIN}/feedback`, discord: `${CANONICAL_PORTAL_ORIGIN}/discord` })
    for (const link of Object.values(COMMUNITY_LINKS)) {
      const url = new URL(link)
      expect(url.origin).toBe(CANONICAL_PORTAL_ORIGIN)
      expect(url.search).toBe('')
      expect(url.hash).toBe('')
    }
  })

  it('resolves product links against a configured dev portal origin', () => {
    expect(productLink('supporter', 'http://localhost:5173')).toBe('http://localhost:5173/supporter')
    expect(productLink('linkDevice', 'http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173/account/link-device')
    expect(productLink('supporter')).toBe(`${CANONICAL_PORTAL_ORIGIN}/supporter`)
  })

  it('falls back to production rather than emitting an unvalidated origin', () => {
    // A link is a place we send the user, so anything outside the allowlist must
    // never reach an href.
    for (const hostile of [
      'https://streampulse.stream.evil.test',
      'http://streampulse.stream',
      'https://streampulse.stream:8443',
      'https://user:pass@streampulse.stream',
      'javascript:alert(1)',
      'not a url',
      '',
    ]) {
      expect(portalOriginOrCanonical(hostile)).toBe(CANONICAL_PORTAL_ORIGIN)
      expect(productLink('supporter', hostile)).toBe(`${CANONICAL_PORTAL_ORIGIN}/supporter`)
    }
  })

  it('prefills only a valid human code in the fragment, without sending it as a query', () => {
    const link = new URL(deviceLinkWithCode('ABCDE-12345'))
    expect(link.origin).toBe(CANONICAL_PORTAL_ORIGIN)
    expect(link.pathname).toBe('/account/link-device')
    expect(link.search).toBe('')
    expect(link.hash).toBe('#code=ABCDE12345')
  })

  it('adds only the fixed billing continuation, and never with a malformed code', () => {
    expect(new URL(deviceLinkWithCode('ABCDE-12345', undefined, 'billing')).hash).toBe('#code=ABCDE12345&then=billing')
    expect(deviceLinkWithCode('not-a-code', undefined, 'billing')).toBe(productLink('linkDevice'))
    // A caller cannot smuggle another flow or destination through the parameter.
    expect(deviceLinkWithCode('ABCDE-12345', undefined, 'https://evil.test' as never)).toBe(`${CANONICAL_PORTAL_ORIGIN}/account/link-device#code=ABCDE12345`)
  })

  it('omits malformed codes, polling secrets, and objects with additional fields', () => {
    for (const code of [
      'abcde-12345', 'ABCDE12345', 'ABCDE-1234G', 'ABCDE-12345&token=secret',
      ' ABCDE-12345', 'ABCDE-12345\n', 'A'.repeat(64), '', null, undefined,
      { code: 'ABCDE-12345', pollingSecret: 'A'.repeat(64) },
    ]) {
      expect(deviceLinkWithCode(code)).toBe(productLink('linkDevice'))
    }
  })

  it('keeps the existing product-origin guard when prefilling a code', () => {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
      expect(deviceLinkWithCode('ABCDE-12345', origin)).toBe(`${origin}/account/link-device#code=ABCDE12345`)
    }
    for (const origin of [
      'https://streampulse.stream.evil.test', 'http://streampulse.stream',
      'https://streampulse.stream:8443', 'https://user:pass@streampulse.stream',
      'http://localhost:5173/account/link-device', 'https://streampulse.stream?token=secret',
      'javascript:alert(1)', 'not a url', '',
    ]) {
      expect(deviceLinkWithCode('ABCDE-12345', origin)).toBe(`${CANONICAL_PORTAL_ORIGIN}/account/link-device#code=ABCDE12345`)
    }
  })

  it('is the only place streampulse.stream page URLs are written', () => {
    const offenders: string[] = []
    const files = listSourceFiles('src', ['.ts', '.tsx'])
    expect(files.length).toBeGreaterThan(50)
    for (const file of files) {
      if (file.endsWith('portalLinks.ts')) continue
      for (const match of readFileSync(file, 'utf8').matchAll(/streampulse\.stream\/[a-z][\w/-]*/g)) {
        // `/analytics/...` deep links are owned by analyticsLinks.ts, and
        // api.streampulse.stream is the API origin, not a page.
        if (match[0].startsWith('streampulse.stream/analytics')) continue
        offenders.push(`${file}: ${match[0]}`)
      }
    }
    expect(offenders, 'hardcode page URLs in portalLinks.ts only').toEqual([])
  })
})

/**
 * streampulse-web in this repo is the site behind streampulse.stream, and a link
 * the extension publishes must resolve there the way
 * streampulse-web/scripts/check-public-links.mjs resolves one: a prerendered
 * route or a `_redirects` rule. Pages answers anything else with 404.html. The
 * e2e harness replaces streampulse.stream with a mock page, so no other test
 * notices a link to a page the website does not have yet.
 *
 * This is the merge gate for a new extension link: the website route lands
 * first. It does not prove the page is deployed; the store review checklist
 * covers that.
 */
describe('website routes', () => {
  it('links only to pages the website in this repo serves', () => {
    const web = (path: string) => readFileSync(`streampulse-web/${path}`, 'utf8')
    const prerendered = new Set([...web('scripts/prerender.mjs').matchAll(/^\s*path: '([^']*)',/gm)].map(match => `/${match[1]}`))
    const rewritten = new Set(web('public/_redirects').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => line.split(/\s+/)[0]))
    expect(prerendered).toContain('/privacy')
    expect(rewritten).toContain('/account/link-device')

    // Every page path portalLinks.ts writes: policy, community and product links.
    const linked = [...new Set([...readFileSync('src/shared/portalLinks.ts', 'utf8').matchAll(/(?:\$\{CANONICAL_PORTAL_ORIGIN\}|')(\/[a-z][\w/-]*)[`']/g)].map(match => match[1]))]
    for (const link of [...Object.values(POLICY_LINKS), ...Object.values(COMMUNITY_LINKS), productLink('supporter'), productLink('billing'), productLink('signIn'), productLink('linkDevice')]) {
      expect(linked, 'the path scan missed a registry link').toContain(new URL(link).pathname)
    }

    const missing = linked.filter(path => !prerendered.has(path) && !rewritten.has(path))
    expect(missing, 'streampulse-web does not serve these extension links; land the website route before the extension links to it').toEqual([])
  })
})

/**
 * The content-script gzip budget had ~600 bytes of headroom when this landed.
 * The registry is a page-surface concern; if it ever reaches the content bundle
 * the budget check becomes the second failure, not the first.
 */
describe('content bundle', () => {
  // The minifier keeps `${CANONICAL_PORTAL_ORIGIN}/discord` as a template
  // literal (`${C}/discord`), so a full 'streampulse.stream/discord' string never
  // appears in any build. Match the bare path, at a path-segment end so
  // '/supporter' is not read as '/support'.
  const markers = ['/refunds', '/terms', '/privacy', '/discord', '/support', '/feedback']
  const pathSegment = (marker: string) => new RegExp(`${marker}(?![\\w-])`)

  it('matches a marker only at a path-segment end', () => {
    expect(pathSegment('/support').test('`${C}/support`')).toBe(true)
    expect(pathSegment('/support').test('"/support"')).toBe(true)
    expect(pathSegment('/support').test('`${C}/supporter`')).toBe(false)
    expect(pathSegment('/terms').test('/terms-of-sale')).toBe(false)
  })

  it('keeps the link registry and the community entry points out of the content script graph', () => {
    // Unit tests run before `npm run build` in CI, so this source-level walk is
    // the half of the guard that runs there.
    const graph = contentScriptModules()
    expect(graph).toContain('src/content/entry.ts')
    expect(graph.length).toBeGreaterThan(50)
    const leaked = graph.filter(file => ['src/shared/portalLinks.ts', 'src/ui/communityIcons.tsx', 'src/ui/SettingsWorkspace.tsx'].includes(file))
    expect(leaked).toEqual([])
  })

  it('does not ship the policy or community links in a build', () => {
    const contentBundle = 'dist/content/twitch.js'
    // Unit tests run before `npm run build` in CI; with no build there is nothing to inspect.
    if (!existsSync(contentBundle)) {
      expect(existsSync(contentBundle)).toBe(false)
      return
    }
    const bundle = readFileSync(contentBundle, 'utf8')
    for (const marker of markers) {
      expect(pathSegment(marker).test(bundle), `content bundle must not contain ${marker}`).toBe(false)
    }
    // The markers must be able to match at all: the page bundles that do ship
    // the registry contain every one of them in the form the minifier writes.
    const pageBundles = listSourceFiles('dist', ['.js']).filter(file => !file.startsWith('dist/content/')).map(file => readFileSync(file, 'utf8'))
    for (const marker of markers) {
      expect(pageBundles.some(page => pathSegment(marker).test(page)), `no page bundle contains ${marker}; the marker cannot detect a leak`).toBe(true)
    }
  })
})
