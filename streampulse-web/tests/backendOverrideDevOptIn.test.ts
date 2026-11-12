import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'sp.backendUrlOverride'
const SHIM = 'http://127.0.0.1:8099'

/**
 * `clearStaleLocalBackendOverride` runs on every dev startup (`src/main.tsx`).
 * It used to strip *any* localhost override, which silently defeated the
 * documented `VITE_ALLOW_LOCAL_BACKEND=1` workflow — the dev discovery fixture
 * shim was cleared before the first request and the portal fell back to the
 * hosted API. It must honour the same opt-in as `getBackendUrlOverride` and
 * `setBackendUrlOverride`.
 */
describe('local backend override respects the explicit dev opt-in', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    sessionStorage.clear()
  })

  it('keeps a localhost override when local backends are opted into', async () => {
    vi.stubEnv('VITE_ALLOW_LOCAL_BACKEND', '1')
    const { clearStaleLocalBackendOverride, getBackendUrlOverride, isAllowedDevBackendQueryOverride } = await import('../src/lib/auth')
    sessionStorage.setItem(KEY, SHIM)

    clearStaleLocalBackendOverride()

    expect(sessionStorage.getItem(KEY)).toBe(SHIM)
    expect(getBackendUrlOverride()).toBe(SHIM)
    expect(isAllowedDevBackendQueryOverride(SHIM)).toBe(true)
    expect(isAllowedDevBackendQueryOverride('https://api.example.test')).toBe(false)
    expect(isAllowedDevBackendQueryOverride('https://evil.example.test/laptopworker')).toBe(false)
    expect(isAllowedDevBackendQueryOverride('http://127.0.0.1:8099/?next=evil')).toBe(false)
  })

  it('still drops a stale localhost override without the opt-in', async () => {
    vi.stubEnv('VITE_ALLOW_LOCAL_BACKEND', '')
    const { clearStaleLocalBackendOverride, getBackendUrlOverride } = await import('../src/lib/auth')
    sessionStorage.setItem(KEY, SHIM)

    clearStaleLocalBackendOverride()

    expect(sessionStorage.getItem(KEY)).toBeNull()
    expect(getBackendUrlOverride()).toBeNull()
  })

  it('never touches a non-local override', async () => {
    vi.stubEnv('VITE_ALLOW_LOCAL_BACKEND', '')
    const { clearStaleLocalBackendOverride } = await import('../src/lib/auth')
    sessionStorage.setItem(KEY, 'https://api.streampulse.stream')

    clearStaleLocalBackendOverride()

    expect(sessionStorage.getItem(KEY)).toBe('https://api.streampulse.stream')
  })
})

/**
 * The removed beta-key login left `sp.betaKey` in site storage. Every site
 * load deletes it, production included, and leaves every other key alone.
 */
describe('removed beta-key cleanup', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('clearRemovedBetaKey deletes sp.betaKey and leaves other sp.* keys alone', async () => {
    vi.stubEnv('PROD', true)
    const { clearRemovedBetaKey } = await import('../src/lib/auth')
    localStorage.setItem('sp.betaKey', 'secret-one')
    localStorage.setItem('sp.hub.recentLogins', '["creator"]')
    localStorage.setItem('sp:publicHub:v1:x', '{}')

    clearRemovedBetaKey()

    expect(localStorage.getItem('sp.betaKey')).toBeNull()
    expect(localStorage.getItem('sp.hub.recentLogins')).toBe('["creator"]')
    expect(localStorage.getItem('sp:publicHub:v1:x')).toBe('{}')
  })

  it('does not throw when site storage is blocked', async () => {
    const { clearRemovedBetaKey } = await import('../src/lib/auth')
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    expect(() => clearRemovedBetaKey()).not.toThrow()
  })

  it('runs on every page load from the site bootstrap', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8')
    const bootstrap = /async function bootstrap\(\) \{[\s\S]*?\n\}/.exec(main)?.[0] ?? ''
    expect(bootstrap).toContain('clearRemovedBetaKey()')
  })
})
