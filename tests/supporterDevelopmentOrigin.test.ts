import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadManifestForTarget, resolveSupporterBackendOrigin } from '../scripts/extension-target.mjs'

afterEach(() => vi.unstubAllEnvs())

describe('fixed development Supporter origin', () => {
  it('defaults every target to the hosted API', () => {
    for (const target of ['development', 'cws', 'edge', 'firefox']) expect(resolveSupporterBackendOrigin(target, '')).toBe('https://api.streampulse.stream')
  })
  it.each(['https://localhost:8081', 'https://127.0.0.1:8443', 'https://[::1]:8443'])('accepts explicit HTTPS loopback development: %s', origin => {
    expect(resolveSupporterBackendOrigin('development', origin)).toBe(origin)
  })
  it.each(['http://localhost:8081', 'https://example.com', 'https://localhost.evil.test', 'https://user:secret@localhost', 'https://localhost/path', 'https://localhost?next=remote', 'https://localhost#fragment', 'localhost:8081', 'https://0.0.0.0:8081'])('rejects unsafe origin %s', origin => {
    expect(() => resolveSupporterBackendOrigin('development', origin)).toThrow()
  })
  it('adds the fixed permission only to an unpacked development build and refuses all Store targets', () => {
    vi.stubEnv('PULSE_SUPPORTER_DEV_ORIGIN', 'https://localhost:8081')
    expect(loadManifestForTarget('development').host_permissions).toContain('https://localhost:8081/*')
    for (const target of ['cws', 'edge', 'firefox']) expect(() => loadManifestForTarget(target)).toThrow('only for development')
  })
})
