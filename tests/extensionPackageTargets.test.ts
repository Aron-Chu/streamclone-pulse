import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { findForbiddenBackendHosts } from '../streampulse-web/scripts/check-backend-url.mjs'
import { isLocalOrLoopbackHost, isStoreTarget, resolveExtensionTarget } from '../scripts/extension-target.mjs'

const packageScriptPath = fileURLToPath(
  new URL('../scripts/package-extension-target.mjs', import.meta.url),
)

describe('extension-target helpers', () => {
  it('resolves known targets and rejects unknown', () => {
    expect(resolveExtensionTarget('cws')).toBe('cws')
    expect(resolveExtensionTarget('edge')).toBe('edge')
    expect(resolveExtensionTarget('firefox')).toBe('firefox')
    expect(resolveExtensionTarget('development')).toBe('development')
    expect(() => resolveExtensionTarget('safari')).toThrow(/unknown EXTENSION_TARGET/)
  })

  it('marks cws/edge/firefox as store targets', () => {
    expect(isStoreTarget('cws')).toBe(true)
    expect(isStoreTarget('edge')).toBe(true)
    expect(isStoreTarget('firefox')).toBe(true)
    expect(isStoreTarget('development')).toBe(false)
  })

  it('detects localhost and loopback hosts', () => {
    expect(isLocalOrLoopbackHost('http://localhost:8081/*')).toBe(true)
    expect(isLocalOrLoopbackHost('http://127.0.0.1:8081/*')).toBe(true)
    expect(isLocalOrLoopbackHost('https://api.streampulse.stream/*')).toBe(false)
  })

  it('compiles each store package with its own runtime target', () => {
    const source = readFileSync(packageScriptPath, 'utf8')
    expect(source).toContain('EXTENSION_TARGET: target')
    expect(source).not.toContain("EXTENSION_TARGET: 'cws'")
  })
})

describe('portal check-backend-url fixtures', () => {
  it('rejects localhost and loopback URLs on every port including 8081', () => {
    expect(findForbiddenBackendHosts('const u="http://localhost:8081/v1"').some((h) => h.includes('8081'))).toBe(true)
    expect(findForbiddenBackendHosts('fetch("http://127.0.0.1:8081/")').some((h) => h.includes('127.0.0.1'))).toBe(true)
    expect(findForbiddenBackendHosts('href="http://localhost/api"').some((h) => h.includes('localhost'))).toBe(true)
    expect(findForbiddenBackendHosts('https://api.streampulse.stream/v1')).toEqual([])
    // Bare React Router sentinel is no longer exempt — production rewrites to https://invalid.invalid.
    expect(findForbiddenBackendHosts('base=`http://localhost`;next()')).toContain('http://localhost')
    expect(findForbiddenBackendHosts('base=`https://invalid.invalid`;next()')).toEqual([])
  })

  it('rejects legacy :8090 and laptopworker', () => {
    expect(findForbiddenBackendHosts('http://localhost:8090/x')[0]).toMatch(/localhost:8090/i)
    expect(findForbiddenBackendHosts('https://hub.laptopworker.example')[0]).toMatch(/laptopworker/i)
  })
})
