import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const discoverNativeLiveVodLink = vi.hoisted(() => vi.fn())
const discoverLiveVodNavigationCandidate = vi.hoisted(() => vi.fn())

vi.mock('../src/content/twitchVodDiscovery.ts', () => ({
  discoverNativeLiveVodLink,
  discoverLiveVodNavigationCandidate,
}))

const {
  currentLiveVodSessionKey,
  hasResolvedLiveVodNavigation,
  invalidateLiveVodNavigationCache,
  peekLiveVodNavigationCandidate,
  resolveLiveVodNavigationCandidate,
} = await import('../src/content/liveVodNavigationCache.ts')

const NATIVE = { vodId: '2838742057', source: 'native_twitch_control' as const }
const SERIALIZED = { vodId: '1234567890', source: 'page_archive_metadata' as const }

function setHref(href: string): void {
  ;(globalThis as { window?: unknown }).window = { location: { href } }
}

beforeEach(() => {
  invalidateLiveVodNavigationCache()
  discoverNativeLiveVodLink.mockReset().mockReturnValue(null)
  discoverLiveVodNavigationCandidate.mockReset().mockReturnValue(null)
  ;(globalThis as { document?: unknown }).document = {}
  setHref('https://www.twitch.tv/hasanabi')
})

afterEach(() => {
  delete (globalThis as { document?: unknown }).document
  delete (globalThis as { window?: unknown }).window
})

describe('live VOD navigation cache', () => {
  it('never scans the DOM from the render-safe peek', () => {
    const key = currentLiveVodSessionKey('318702573527')
    expect(peekLiveVodNavigationCandidate(key)).toBeNull()
    expect(hasResolvedLiveVodNavigation(key)).toBe(false)
    expect(discoverNativeLiveVodLink).not.toHaveBeenCalled()
    expect(discoverLiveVodNavigationCandidate).not.toHaveBeenCalled()
  })

  it('prefers the cheap structural pass and never serializes when it succeeds', () => {
    discoverNativeLiveVodLink.mockReturnValue(NATIVE)
    const key = currentLiveVodSessionKey('318702573527')

    expect(resolveLiveVodNavigationCandidate(key)).toEqual(NATIVE)
    expect(discoverLiveVodNavigationCandidate).not.toHaveBeenCalled()
    expect(peekLiveVodNavigationCandidate(key)).toEqual(NATIVE)
  })

  it('serves a cached candidate without re-scanning', () => {
    discoverNativeLiveVodLink.mockReturnValue(NATIVE)
    const key = currentLiveVodSessionKey('318702573527')
    resolveLiveVodNavigationCandidate(key)

    discoverNativeLiveVodLink.mockClear()
    expect(resolveLiveVodNavigationCandidate(key)).toEqual(NATIVE)
    expect(discoverNativeLiveVodLink).not.toHaveBeenCalled()
  })

  it('runs the serialized fallback at most once per session', () => {
    discoverLiveVodNavigationCandidate.mockReturnValue(null)
    const key = currentLiveVodSessionKey('318702573527')

    expect(resolveLiveVodNavigationCandidate(key)).toBeNull()
    expect(resolveLiveVodNavigationCandidate(key)).toBeNull()
    expect(resolveLiveVodNavigationCandidate(key)).toBeNull()

    expect(discoverLiveVodNavigationCandidate).toHaveBeenCalledTimes(1)
  })

  it('returns the serialized candidate when the structural pass finds nothing', () => {
    discoverLiveVodNavigationCandidate.mockReturnValue(SERIALIZED)
    const key = currentLiveVodSessionKey('318702573527')

    expect(resolveLiveVodNavigationCandidate(key)).toEqual(SERIALIZED)
    expect(peekLiveVodNavigationCandidate(key)).toEqual(SERIALIZED)
  })

  it('skips serialization entirely for debounced rescans', () => {
    const key = currentLiveVodSessionKey('318702573527')

    expect(
      resolveLiveVodNavigationCandidate(key, { allowSerializedFallback: false }),
    ).toBeNull()
    expect(discoverLiveVodNavigationCandidate).not.toHaveBeenCalled()
    expect(discoverNativeLiveVodLink).toHaveBeenCalledTimes(1)
    expect(hasResolvedLiveVodNavigation(key)).toBe(true)
  })

  it('re-serializes on an explicit forced refresh (user action)', () => {
    discoverLiveVodNavigationCandidate.mockReturnValue(null)
    const key = currentLiveVodSessionKey('318702573527')
    resolveLiveVodNavigationCandidate(key)

    discoverLiveVodNavigationCandidate.mockReturnValue(SERIALIZED)
    expect(resolveLiveVodNavigationCandidate(key, { force: true })).toEqual(SERIALIZED)
    expect(discoverLiveVodNavigationCandidate).toHaveBeenCalledTimes(2)
  })

  it('invalidates on route change', () => {
    discoverNativeLiveVodLink.mockReturnValue(NATIVE)
    resolveLiveVodNavigationCandidate(currentLiveVodSessionKey('318702573527'))

    setHref('https://www.twitch.tv/otherchannel')
    expect(peekLiveVodNavigationCandidate(currentLiveVodSessionKey('318702573527')))
      .toBeNull()
  })

  it('invalidates on stream identity change', () => {
    discoverNativeLiveVodLink.mockReturnValue(NATIVE)
    resolveLiveVodNavigationCandidate(currentLiveVodSessionKey('318702573527'))

    expect(peekLiveVodNavigationCandidate(currentLiveVodSessionKey('999999999999')))
      .toBeNull()
  })

  it('yields nothing outside a document context', () => {
    delete (globalThis as { document?: unknown }).document
    expect(resolveLiveVodNavigationCandidate({ href: '', streamId: null })).toBeNull()
    expect(discoverNativeLiveVodLink).not.toHaveBeenCalled()
  })
})
