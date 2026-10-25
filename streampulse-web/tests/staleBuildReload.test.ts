/**
 * RC test F6 (2026-10-20): a tab left open across a Pages deploy asks for lazy
 * chunks and CSS the new deploy no longer serves. It reloads itself onto the
 * new build once per tab session, and never loops.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/lib/sentry', () => ({ Sentry: {}, sanitizePortalPath: (path: string) => path }))
import { STORAGE_PREFIX } from '../src/lib/publicHubCacheReset'
import { installStaleBuildReload, STALE_BUILD_RELOAD_KEY } from '../src/ui/staleBuildReload'

const missingCss = () => new Error('Unable to preload CSS for /assets/AnalyticsMomentsPage-DSHyL4nX.css')
const missingChunk = () => new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1:14313/assets/AnalyticsSessionPage-Bq1x.js')

function firePreloadError(payload: unknown): Event {
  const event = new Event('vite:preloadError', { cancelable: true }) as Event & { payload?: unknown }
  event.payload = payload
  window.dispatchEvent(event)
  return event
}

describe('stale build reload', () => {
  const reload = vi.fn()
  let uninstall = () => {}

  beforeEach(() => {
    window.sessionStorage.clear()
    window.localStorage.clear()
    reload.mockReset()
    uninstall = installStaleBuildReload(reload)
  })
  afterEach(() => {
    uninstall()
    vi.restoreAllMocks()
  })

  it('reloads onto the current build when an old page CSS or chunk is gone, clearing the hub cache first', () => {
    window.localStorage.setItem(`${STORAGE_PREFIX}24h`, '{"cached":true}')
    reload.mockImplementation(() => {
      expect(window.localStorage.getItem(`${STORAGE_PREFIX}24h`)).toBeNull()
    })
    const event = firePreloadError(missingCss())
    expect(reload).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem(STALE_BUILD_RELOAD_KEY)).not.toBeNull()
    // The error still reaches the page's boundary, which shows the chunk text if the reload never lands.
    expect(event.defaultPrevented).toBe(false)
  })

  it('reloads for a missing JS chunk too', () => {
    firePreloadError(missingChunk())
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads at most once per tab session, so a chunk that is really missing never loops', () => {
    firePreloadError(missingCss())
    firePreloadError(missingChunk())
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload again after the reload it already made', () => {
    window.sessionStorage.setItem(STALE_BUILD_RELOAD_KEY, '1')
    firePreloadError(missingChunk())
    expect(reload).not.toHaveBeenCalled()
  })

  it('leaves recovery to the Reload button when session storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })
    firePreloadError(missingChunk())
    expect(reload).not.toHaveBeenCalled()
  })

  it('leaves recovery to the Reload button when the session flag does not stick', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})
    firePreloadError(missingChunk())
    expect(reload).not.toHaveBeenCalled()
  })

  it('ignores errors that are not missing assets', () => {
    firePreloadError(new TypeError('e.login.toLowerCase is not a function'))
    firePreloadError(undefined)
    expect(reload).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem(STALE_BUILD_RELOAD_KEY)).toBeNull()
  })

  it('stops listening once removed', () => {
    uninstall()
    firePreloadError(missingChunk())
    expect(reload).not.toHaveBeenCalled()
  })

  it('is installed by the portal entry before the app renders', () => {
    const main = readFileSync(resolve(__dirname, '../src/main.tsx'), 'utf8')
    const installAt = main.indexOf('\ninstallStaleBuildReload()')
    expect(installAt).toBeGreaterThan(-1)
    expect(installAt).toBeLessThan(main.indexOf('void bootstrap()'))
  })
})
