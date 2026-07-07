import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchPulseChannel = vi.hoisted(() => vi.fn())
const fetchExtensionCoverage = vi.hoisted(() => vi.fn())

vi.mock('../src/background/api.ts', () => ({
  fetchPulseChannel,
  fetchExtensionCoverage,
}))

import { prefetchChannelLoginFromUrl } from '../src/routing/twitchRoute.ts'
import {
  awaitPulsePrefetchInFlight,
  fetchAndCachePulseChannel,
  handleTwitchTabNavigation,
  pulsePrefetchInFlightCount,
  resetPulsePrefetchInFlightForTests,
  schedulePulsePrefetch,
} from '../src/background/pulsePrefetch.ts'

function stubChromeStorage(sessionStore: Record<string, unknown> = {}) {
  vi.stubGlobal('chrome', {
    storage: {
      sync: {
        get: vi.fn(async (keys: string | string[] | null) => {
          const defaults: Record<string, unknown> = {
            backendUrl: 'https://api.streampulse.stream',
            keepLocalCache: true,
            localBackendOptIn: false,
          }
          if (keys === null) return { ...defaults }
          const keyList = Array.isArray(keys) ? keys : [keys]
          const out: Record<string, unknown> = {}
          for (const key of keyList) {
            out[key] = defaults[key]
          }
          return out
        }),
        set: vi.fn(),
      },
      session: {
        get: vi.fn(async (key: string | null) =>
          key === null ? { ...sessionStore } : { [key]: sessionStore[key] },
        ),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(sessionStore, items)
        }),
      },
    },
  })
}

describe('prefetchChannelLoginFromUrl', () => {
  it('accepts pure channel watch URLs', () => {
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/xqc')).toBe('xqc')
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/xqc/')).toBe('xqc')
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/xqc?referrer=raid')).toBe('xqc')
  })

  it('excludes non-channel Twitch routes', () => {
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/directory')).toBeNull()
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/settings')).toBeNull()
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/subscriptions')).toBeNull()
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/inventory')).toBeNull()
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/popout')).toBeNull()
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/clips')).toBeNull()
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/drops')).toBeNull()
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/moderator')).toBeNull()
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/dashboard')).toBeNull()
  })

  it('excludes VOD and sub-routes', () => {
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/videos/2806037629')).toBeNull()
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/xqc/videos/1234567890')).toBeNull()
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/xqc/clips')).toBeNull()
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/xqc/about')).toBeNull()
  })

  it('rejects invalid hosts', () => {
    expect(prefetchChannelLoginFromUrl('https://example.com/xqc')).toBeNull()
  })
})

describe('pulse prefetch', () => {
  let sessionStore: Record<string, unknown>

  const samplePayload = {
    login: 'xqc',
    isLive: true,
    tracking: true,
    rollups: [],
    lanes: { composite: [], chat: [], seventv: [] },
    streamId: 'abc',
  }

  beforeEach(() => {
    sessionStore = {}
    resetPulsePrefetchInFlightForTests()
    fetchPulseChannel.mockReset()
    fetchExtensionCoverage.mockReset()
    fetchExtensionCoverage.mockResolvedValue(null)
    fetchPulseChannel.mockResolvedValue(samplePayload)
    stubChromeStorage(sessionStore)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('handleTwitchTabNavigation schedules prefetch for channel URLs', async () => {
    handleTwitchTabNavigation('https://www.twitch.tv/xqc')
    expect(pulsePrefetchInFlightCount()).toBe(1)

    await awaitPulsePrefetchInFlight('xqc')

    expect(fetchPulseChannel).toHaveBeenCalledTimes(1)
    expect(fetchPulseChannel).toHaveBeenCalledWith('xqc', { window: 'recent' })
    expect(sessionStore['pulse:xqc:recent']).toBeTruthy()
  })

  it('reuses session cache and skips network when fresh', async () => {
    sessionStore['pulse:xqc:recent'] = {
      payload: {
        login: 'xqc',
        streamId: 'cached',
        rollups: [],
        lanes: { composite: [], chat: [], seventv: [] },
      },
      fetchedAt: Date.now(),
      window: 'recent',
      streamId: 'cached',
    }

    schedulePulsePrefetch('xqc')
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(fetchPulseChannel).not.toHaveBeenCalled()
  })

  it('skips prefetch when local session cache is disabled', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        sync: {
          get: vi.fn(async (keys: string | string[] | null) => {
            const out: Record<string, unknown> = {
              backendUrl: 'https://api.streampulse.stream',
              keepLocalCache: false,
              localBackendOptIn: false,
            }
            if (keys === null) return out
            const keyList = Array.isArray(keys) ? keys : [keys]
            const picked: Record<string, unknown> = {}
            for (const key of keyList) picked[key] = out[key]
            return picked
          }),
          set: vi.fn(),
        },
        session: {
          get: vi.fn(async () => ({})),
          set: vi.fn(),
        },
      },
    })

    schedulePulsePrefetch('xqc')
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(fetchPulseChannel).not.toHaveBeenCalled()
    expect(pulsePrefetchInFlightCount()).toBe(0)
  })

  it('dedupes in-flight requests for the same login', async () => {
    let release!: () => void
    fetchPulseChannel.mockImplementation(
      () =>
        new Promise(resolve => {
          release = () => resolve(samplePayload)
        }),
    )

    schedulePulsePrefetch('xqc')
    schedulePulsePrefetch('xqc')
    schedulePulsePrefetch('xqc')
    expect(pulsePrefetchInFlightCount()).toBe(1)

    await vi.waitFor(() => {
      expect(typeof release).toBe('function')
    })
    release()
    await awaitPulsePrefetchInFlight('xqc')
    expect(pulsePrefetchInFlightCount()).toBe(0)
    expect(fetchPulseChannel).toHaveBeenCalledTimes(1)
  })

  it('prefetch failures do not block later fetchAndCachePulseChannel', async () => {
    fetchPulseChannel.mockRejectedValueOnce(new Error('network'))
    schedulePulsePrefetch('xqc')
    await awaitPulsePrefetchInFlight('xqc')

    fetchPulseChannel.mockResolvedValueOnce({
      login: 'xqc',
      isLive: true,
      tracking: true,
      rollups: [],
      lanes: { composite: [], chat: [], seventv: [] },
      streamId: 'retry',
    })

    await fetchAndCachePulseChannel('xqc')
    expect(fetchPulseChannel).toHaveBeenCalledTimes(2)
    expect(sessionStore['pulse:xqc:recent']).toBeTruthy()
  })

  it('awaitPulsePrefetchInFlight waits for an active prefetch', async () => {
    let release!: () => void
    fetchPulseChannel.mockImplementation(
      () =>
        new Promise(resolve => {
          release = () => resolve(samplePayload)
        }),
    )

    schedulePulsePrefetch('xqc')
    expect(pulsePrefetchInFlightCount()).toBe(1)

    await vi.waitFor(() => {
      expect(typeof release).toBe('function')
    })
    const waiter = awaitPulsePrefetchInFlight('xqc')
    release()
    await waiter
    expect(pulsePrefetchInFlightCount()).toBe(0)
  })
})
