import { describe, expect, it } from 'vitest'
import {
  analyzePortalDistForLocalOrigins,
  countBareLocalhostSentinel,
  findForbiddenBackendUrlHits,
  isForbiddenBackendHostname,
  REACT_ROUTER_URL_BASE,
} from '../scripts/check-backend-url.mjs'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('portal production local-origin gate', () => {
  it('rejects fetch("http://localhost") and backend constants', () => {
    expect(findForbiddenBackendUrlHits('fetch("http://localhost")')).toContain('http://localhost')
    expect(findForbiddenBackendUrlHits('const API="http://localhost:8081"')[0]).toContain('8081')
  })

  it('rejects query/path/port/userinfo/fragment and subdomain variants', () => {
    const samples = [
      'http://localhost/v1',
      'http://localhost:8081',
      'http://localhost?x=1',
      'http://localhost#frag',
      'http://user:pass@localhost',
      'http://foo.localhost/',
      'http://127.0.0.1/',
      'http://127.1/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://laptopworker:8081/',
      'http://host.docker.internal:8081/',
    ]
    for (const sample of samples) {
      expect(findForbiddenBackendUrlHits(JSON.stringify(sample)).length).toBeGreaterThan(0)
    }
  })

  it('rejects a second bare sentinel and counts bare literals', () => {
    expect(countBareLocalhostSentinel('http://localhost http://localhost')).toBe(2)
  })

  it('allows rewritten React Router base and hosted API', () => {
    expect(findForbiddenBackendUrlHits(`base=${REACT_ROUTER_URL_BASE}`)).toEqual([])
    expect(isForbiddenBackendHostname('invalid.invalid')).toBe(false)
    expect(findForbiddenBackendUrlHits('https://api.streampulse.stream/v1')).toEqual([])
  })

  it('fails dist analysis when any bare localhost remains', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sp-portal-scan-'))
    const assets = join(dir, 'assets')
    mkdirSync(assets)
    writeFileSync(join(dir, 'index.html'), '<html></html>')
    writeFileSync(join(assets, 'app.js'), 'const x="http://localhost";')
    const result = analyzePortalDistForLocalOrigins(dir)
    expect(result.sentinelTotal).toBeGreaterThan(0)
    expect(result.forbidden.some((h: { needle: string }) => h.needle === 'http://localhost')).toBe(true)
  })
})
