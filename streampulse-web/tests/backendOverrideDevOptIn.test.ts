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
 * The tailnet dev machine counts as a local backend in dev builds only; production builds drop its name, so the
 * shipped bundle does not carry it.
 */
describe('tailnet dev host', () => {
  const tailnet = `http://${['laptop', 'worker'].join('')}:8081`

  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllEnvs())

  it('is a local backend in a dev build', async () => {
    vi.stubEnv('DEV', true)
    const { isLocalDevBackendUrl } = await import('../src/lib/auth')
    expect(isLocalDevBackendUrl(tailnet)).toBe(true)
    expect(isLocalDevBackendUrl('http://127.0.0.1:8081')).toBe(true)
  })

  it('is not known to a production build', async () => {
    vi.stubEnv('DEV', false)
    const { isLocalDevBackendUrl } = await import('../src/lib/auth')
    expect(isLocalDevBackendUrl(tailnet)).toBe(false)
    expect(isLocalDevBackendUrl('http://127.0.0.1:8081')).toBe(true)
    expect(isLocalDevBackendUrl('https://api.streampulse.stream')).toBe(false)
  })

  it('is written behind the dev flag, so the minifier drops it', () => {
    const auth = readFileSync(resolve(process.cwd(), 'src/lib/auth.ts'), 'utf8')
    expect(auth).toMatch(/const TAILNET_DEV_HOST: string \| null = import\.meta\.env\.DEV \? /)
  })
})

/**
 * The removed beta-key login left `sp.betaKey` in site storage. Every site
 * load deletes it, production included, and leaves every other key alone.
 */
describe('removed site keys cleanup', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('clearRemovedSiteKeys deletes sp.betaKey and sp.hub.recentLogins and leaves other sp.* keys alone', async () => {
    vi.stubEnv('PROD', true)
    const { clearRemovedSiteKeys } = await import('../src/lib/auth')
    localStorage.setItem('sp.betaKey', 'secret-one')
    localStorage.setItem('sp.hub.recentLogins', '["creator"]')
    localStorage.setItem('sp.chart.scrollZoom.v1', 'on')
    localStorage.setItem('sp:publicHub:v1:x', '{}')

    clearRemovedSiteKeys()

    expect(localStorage.getItem('sp.betaKey')).toBeNull()
    expect(localStorage.getItem('sp.hub.recentLogins')).toBeNull()
    expect(localStorage.getItem('sp.chart.scrollZoom.v1')).toBe('on')
    expect(localStorage.getItem('sp:publicHub:v1:x')).toBe('{}')
  })

  it('does not throw when site storage is blocked', async () => {
    const { clearRemovedSiteKeys } = await import('../src/lib/auth')
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    expect(() => clearRemovedSiteKeys()).not.toThrow()
  })

  it('runs on every page load from the site bootstrap', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8')
    const bootstrap = /async function bootstrap\(\) \{[\s\S]*?\n\}/.exec(main)?.[0] ?? ''
    expect(bootstrap).toContain('clearRemovedSiteKeys()')
  })
})
