import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({
  clients: [] as { capturePage: ReturnType<typeof vi.fn>; captureCta: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[],
  loaded: vi.fn(),
}))
vi.mock('../src/lib/productAnalyticsCapture', () => {
  transport.loaded()
  return { createPublicCaptureClient: () => {
    const client = { capturePage: vi.fn(), captureCta: vi.fn(), stop: vi.fn() }
    transport.clients.push(client)
    return client
  } }
})

let analytics: typeof import('../src/lib/productAnalytics')
beforeEach(async () => {
  vi.resetModules()
  transport.clients.length = 0
  transport.loaded.mockClear()
  vi.stubEnv('VITE_POSTHOG_PROJECT_TOKEN', 'phc_testonly')
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: vi.fn(() => true) })
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: false })
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '0' })
  window.history.replaceState({}, '', '/')
  analytics = await import('../src/lib/productAnalytics')
})
afterEach(() => {
  analytics.setAnalyticsPreference('declined')
  vi.unstubAllEnvs()
})

async function allow() {
  analytics.setAnalyticsPreference('allowed')
  await vi.waitFor(() => expect(transport.clients).toHaveLength(1))
}

describe('public product analytics consent boundary', () => {
  it('does not import or start capture before explicit consent', async () => {
    analytics.setProductAnalyticsRoute()
    await Promise.resolve()
    expect(transport.clients).toHaveLength(0)
    expect(transport.loaded).not.toHaveBeenCalled()
  })

  it.each(['', 'invalid-token', 'phc_private?secret=1', 'phc_', 'phx_personal'])('does not start capture with absent or invalid build token %s', async token => {
    vi.stubEnv('VITE_POSTHOG_PROJECT_TOKEN', token)
    analytics.setAnalyticsPreference('allowed')
    await Promise.resolve()
    expect(analytics.analyticsConfigured()).toBe(false)
    expect(transport.clients).toHaveLength(0)
  })

  it.each(['/account/sign-in', '/account/confirm', '/account/link-device', '/account/billing', '/analytics', '/analytics/private/stream', '/dashboard', '/s/private', '/unknown', '/docs/private'])('does not start capture on excluded path %s even with consent', async path => {
    window.history.replaceState({}, '', path + '?token=private#private')
    analytics.setAnalyticsPreference('allowed')
    await Promise.resolve()
    expect(transport.clients).toHaveLength(0)
  })

  it.each(['gpc', 'dnt'])('honors %s instead of a saved opt-in', async signal => {
    Object.defineProperty(navigator, signal === 'gpc' ? 'globalPrivacyControl' : 'doNotTrack', { configurable: true, value: signal === 'gpc' ? true : '1' })
    analytics.setAnalyticsPreference('allowed')
    expect(analytics.getAnalyticsPreference()).toBe('declined')
    await Promise.resolve()
    expect(transport.clients).toHaveLength(0)
  })

  it('emits category-only page events once per public pathname and static CTA events', async () => {
    window.history.replaceState({}, '', '/?email=private@example.test#secret')
    await allow()
    const client = transport.clients[0]!
    analytics.setProductAnalyticsRoute()
    analytics.setProductAnalyticsRoute()
    expect(client.capturePage).toHaveBeenCalledTimes(1)
    expect(client.capturePage).toHaveBeenCalledWith('home')
    analytics.capturePublicCta('install_extension')
    expect(client.captureCta).toHaveBeenLastCalledWith('home', 'install_extension')
    window.history.replaceState({}, '', '/docs?email=private@example.test')
    analytics.setProductAnalyticsRoute()
    expect(client.capturePage).toHaveBeenLastCalledWith('docs')
  })

  it('stops before private navigation capture and preserves consent for a fresh client on return', async () => {
    await allow()
    const client = transport.clients[0]!
    window.history.replaceState({}, '', '/account/billing?private=1')
    analytics.capturePublicCta('open_analytics')
    analytics.setProductAnalyticsRoute()
    expect(client.captureCta).not.toHaveBeenCalled()
    expect(client.stop).toHaveBeenCalledTimes(1)
    expect(analytics.getAnalyticsPreference()).toBe('allowed')
    window.history.replaceState({}, '', '/')
    analytics.setProductAnalyticsRoute()
    await vi.waitFor(() => expect(transport.clients).toHaveLength(2))
  })

  it('withdraws immediately, saving only the choice and notifying preference controls', async () => {
    await allow()
    const listener = vi.fn()
    const unsubscribe = analytics.subscribeAnalyticsPreference(listener)
    analytics.setAnalyticsPreference('declined')
    analytics.capturePublicCta('install_extension')
    expect(transport.clients[0]!.captureCta).not.toHaveBeenCalled()
    expect(transport.clients[0]!.stop).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(Object.keys(localStorage)).toEqual([analytics.ANALYTICS_PREFERENCE_KEY])
    expect(localStorage.getItem(analytics.ANALYTICS_PREFERENCE_KEY)).toBe('declined')
    unsubscribe()
  })

  it('accepts withdrawal from another tab and rejects an unavailable beacon transport', async () => {
    await allow()
    localStorage.setItem(analytics.ANALYTICS_PREFERENCE_KEY, 'declined')
    window.dispatchEvent(new StorageEvent('storage', { key: analytics.ANALYTICS_PREFERENCE_KEY, newValue: 'declined' }))
    expect(analytics.getAnalyticsPreference()).toBe('declined')
    expect(transport.clients[0]!.stop).toHaveBeenCalledTimes(1)
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: undefined })
    analytics.setAnalyticsPreference('allowed')
    await Promise.resolve()
    expect(transport.clients).toHaveLength(1)
  })

  it('keeps a choice effective in this tab if browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable') })
    await allow()
    expect(analytics.getAnalyticsPreference()).toBe('allowed')
    analytics.setAnalyticsPreference('declined')
    expect(analytics.getAnalyticsPreference()).toBe('declined')
    expect(transport.clients[0]!.stop).toHaveBeenCalledTimes(1)
  })

  it('drops an opt-in withdrawn before the lazy transport import completes', async () => {
    analytics.setAnalyticsPreference('allowed')
    analytics.setAnalyticsPreference('declined')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(transport.clients).toHaveLength(0)
  })

  it('drops an opt-in that navigates to an account before transport import completes', async () => {
    analytics.setAnalyticsPreference('allowed')
    window.history.replaceState({}, '', '/account/confirm?token=private')
    analytics.setProductAnalyticsRoute()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(transport.clients).toHaveLength(0)
  })
})
