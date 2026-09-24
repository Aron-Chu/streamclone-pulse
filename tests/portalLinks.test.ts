import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CANONICAL_PORTAL_ORIGIN,
  POLICY_LINKS,
  portalOriginOrCanonical,
  productLink,
} from '../src/shared/portalLinks.ts'
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
 * The content-script gzip budget had ~600 bytes of headroom when this landed.
 * The registry is a page-surface concern; if it ever reaches the content bundle
 * the budget check becomes the second failure, not the first.
 */
describe('content bundle', () => {
  it('does not ship the policy link registry', () => {
    let bundle: string
    try {
      bundle = readFileSync('dist/content/twitch.js', 'utf8')
    } catch {
      return // built artifact absent; the build's budget gate still covers this
    }
    for (const marker of ['/refunds', 'streampulse.stream/terms', 'streampulse.stream/privacy']) {
      expect(bundle.includes(marker), `content bundle must not contain ${marker}`).toBe(false)
    }
  })
})
