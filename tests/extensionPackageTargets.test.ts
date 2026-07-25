import { describe, expect, it } from 'vitest'
import { findForbiddenBackendHosts } from '../streampulse-web/scripts/check-backend-url.mjs'
import { isLocalOrLoopbackHost, isStoreTarget, resolveExtensionTarget } from '../scripts/extension-target.mjs'

describe('extension-target helpers', () => {
  it('resolves known targets and rejects unknown', () => {
    expect(resolveExtensionTarget('cws')).toBe('cws')
    expect(resolveExtensionTarget('edge')).toBe('edge')
    expect(resolveExtensionTarget('development')).toBe('development')
    expect(() => resolveExtensionTarget('firefox')).toThrow(/unknown EXTENSION_TARGET/)
  })

  it('marks cws/edge as store targets', () => {
    expect(isStoreTarget('cws')).toBe(true)
    expect(isStoreTarget('edge')).toBe(true)
    expect(isStoreTarget('development')).toBe(false)
  })

  it('detects localhost and loopback hosts', () => {
    expect(isLocalOrLoopbackHost('http://localhost:8081/*')).toBe(true)
    expect(isLocalOrLoopbackHost('http://127.0.0.1:8081/*')).toBe(true)
    expect(isLocalOrLoopbackHost('https://api.streampulse.stream/*')).toBe(false)
  })
})

describe('portal check-backend-url fixtures', () => {
  it('rejects localhost and loopback URLs on every port including 8081', () => {
    expect(findForbiddenBackendHosts('const u="http://localhost:8081/v1"').some((h) => h.includes('8081'))).toBe(true)
    expect(findForbiddenBackendHosts('fetch("http://127.0.0.1:8081/")').some((h) => h.includes('127.0.0.1'))).toBe(true)
    expect(findForbiddenBackendHosts('href="http://localhost/api"').some((h) => h.includes('localhost'))).toBe(true)
    expect(findForbiddenBackendHosts('https://api.streampulse.stream/v1')).toEqual([])
    // React Router relative-URL sentinel is not a Pulse BFF origin.
    expect(findForbiddenBackendHosts('base=`http://localhost`;next()')).toEqual([])
  })

  it('rejects legacy :8090 and laptopworker', () => {
    expect(findForbiddenBackendHosts('http://localhost:8090/x')[0]).toMatch(/localhost:8090/i)
    expect(findForbiddenBackendHosts('https://hub.laptopworker.example')[0]).toMatch(/laptopworker/i)
  })
})
