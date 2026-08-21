import { describe, expect, it } from 'vitest'
import {
  HOSTED_BACKEND_ORIGIN,
  isAllowedBackendUrl,
  normalizeBackendUrl,
  validateBackendUrl,
} from '../src/shared/backendUrlPolicy.ts'

describe('backend URL allowlist', () => {
  it('accepts the three supported origins and canonicalizes them', () => {
    expect(validateBackendUrl('https://api.streampulse.stream')).toMatchObject({
      ok: true,
      url: 'https://api.streampulse.stream',
      kind: 'hosted',
    })
    expect(validateBackendUrl('  http://localhost:8081/  ')).toMatchObject({
      ok: true,
      url: 'http://localhost:8081',
      kind: 'local',
    })
    expect(validateBackendUrl('http://127.0.0.1:8081')).toMatchObject({
      ok: true,
      url: 'http://127.0.0.1:8081',
      kind: 'local',
    })
  })

  it('treats the default https port as canonical', () => {
    expect(validateBackendUrl('https://api.streampulse.stream:443')).toMatchObject({
      ok: true,
      url: 'https://api.streampulse.stream',
    })
  })

  it('rejects hostnames that merely contain an allowed origin', () => {
    // The previous substring classifier accepted every one of these.
    expect(validateBackendUrl('https://evil.tld/?x=localhost:8081')).toMatchObject({
      ok: false,
      reason: 'query',
    })
    expect(validateBackendUrl('https://api.streampulse.stream.evil.tld')).toMatchObject({
      ok: false,
      reason: 'host',
    })
    expect(validateBackendUrl('https://evil.tld#localhost:8081')).toMatchObject({
      ok: false,
      reason: 'fragment',
    })
    expect(validateBackendUrl('https://localhost:8081@evil.tld')).toMatchObject({
      ok: false,
      reason: 'credentials',
    })
    expect(validateBackendUrl('http://laptopworker:8081')).toMatchObject({
      ok: false,
      reason: 'host',
    })
  })

  it('rejects wrong scheme, port, and path on otherwise allowed hosts', () => {
    expect(validateBackendUrl('http://api.streampulse.stream')).toMatchObject({
      ok: false,
      reason: 'scheme',
    })
    expect(validateBackendUrl('https://localhost:8081')).toMatchObject({
      ok: false,
      reason: 'scheme',
    })
    expect(validateBackendUrl('http://localhost:8090')).toMatchObject({
      ok: false,
      reason: 'port',
    })
    expect(validateBackendUrl('http://localhost:8081/v1')).toMatchObject({
      ok: false,
      reason: 'path',
    })
  })

  it('rejects non-http schemes and non-string input', () => {
    expect(validateBackendUrl('javascript:alert(1)')).toMatchObject({ ok: false })
    expect(validateBackendUrl('data:text/html,x')).toMatchObject({ ok: false })
    expect(validateBackendUrl('file:///c:/')).toMatchObject({ ok: false })
    expect(validateBackendUrl(null)).toMatchObject({ ok: false, reason: 'malformed' })
    expect(validateBackendUrl(42)).toMatchObject({ ok: false, reason: 'malformed' })
    expect(validateBackendUrl('')).toMatchObject({ ok: false, reason: 'empty' })
  })

  it('fails closed to the hosted origin', () => {
    expect(normalizeBackendUrl('https://evil.tld')).toBe(HOSTED_BACKEND_ORIGIN)
    expect(isAllowedBackendUrl('https://evil.tld')).toBe(false)
    expect(isAllowedBackendUrl('http://localhost:8081')).toBe(true)
  })
})
