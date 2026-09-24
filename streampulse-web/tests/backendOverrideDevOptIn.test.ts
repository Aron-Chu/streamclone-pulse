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
