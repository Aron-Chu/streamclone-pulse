// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.twitch.tv/fixturechan"}
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXTENSION_RECONNECT_MESSAGE } from '../src/shared/backgroundResponse.ts'
import type { OverlayMountOptions } from '../src/content/mount.tsx'

/**
 * Drives the real content entry (route sync, activation, broadcasts, live poll)
 * against a stubbed worker. The entry is a side-effect module with session
 * state, so it is imported once and the cases below run in order, each on its
 * own Twitch route.
 */
const mount = vi.hoisted(() => ({
  ensureUniqueOverlayHosts: vi.fn(),
  mountOverlay: vi.fn(),
  unmountOverlay: vi.fn(),
  updateOverlayContext: vi.fn(),
  updateOverlayLogin: vi.fn(),
  updateOverlayPayload: vi.fn(),
  updateOverlayVodState: vi.fn(),
}))
vi.mock('../src/content/mount.tsx', () => mount)

type WorkerReply = (message: { type: string; login?: string; vodId?: string }) => Promise<unknown>

const runtime: {
  id: string | undefined
  reply: WorkerReply
  listeners: Array<(message: unknown) => void>
} = {
  id: 'test-extension',
  reply: async () => ({ ok: true }),
  listeners: [],
}

function livePayload(login: string, streamId: string) {
  return {
    login,
    isLive: true,
    tracking: true,
    streamId,
    currentOffsetSeconds: 120,
    rollups: [],
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
  }
}

async function navigate(path: string): Promise<void> {
  history.pushState({}, '', path)
  await vi.advanceTimersByTimeAsync(2_000)
}

function lastMountOptions(login: string): OverlayMountOptions | undefined {
  const calls = mount.mountOverlay.mock.calls.filter(call => call[0] === login)
  return calls.at(-1)?.[3] as OverlayMountOptions | undefined
}

function missingVodReply(vodId: string | undefined) {
  return {
    type: 'VOD_PULSE_UPDATE',
    vodId,
    vodPulse: {
      mode: 'vod',
      vodId,
      provisional: false,
      channelLogin: 'fixturechan',
      coverageStatus: 'missing',
      coverageMessage: 'No replay analytics have been indexed for this VOD yet.',
    },
  }
}

function broadcast(message: unknown): void {
  for (const listener of runtime.listeners) listener(message)
}

describe('content entry lifecycle', () => {
  beforeAll(async () => {
    vi.useFakeTimers()
    const storage = { get: async () => ({}), set: async () => {}, remove: async () => {} }
    vi.stubGlobal('chrome', {
      runtime: {
        get id() { return runtime.id },
        sendMessage: (message: { type: string }) => runtime.reply(message),
        onMessage: {
          addListener: (listener: (message: unknown) => void) => runtime.listeners.push(listener),
          removeListener: () => {},
        },
        getURL: (path: string) => path,
      },
      storage: {
        sync: storage,
        local: storage,
        session: storage,
        onChanged: { addListener: () => {}, removeListener: () => {} },
      },
    })
    runtime.reply = async message => message.type === 'GET_PULSE'
      ? { type: 'PULSE_UPDATE', login: message.login, payload: null, error: 'pulse 500' }
      : { ok: true }
    await import('../src/content/entry.ts')
    await vi.advanceTimersByTimeAsync(2_000)
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    runtime.id = 'test-extension'
  })

  afterAll(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('UX-1 / LIFE-1: passes the worker error into the first mount', async () => {
    await navigate('/firstchan')
    const options = lastMountOptions('firstchan')
    expect(mount.mountOverlay.mock.calls.filter(call => call[0] === 'firstchan')).toHaveLength(2)
    expect(mount.mountOverlay.mock.calls.at(-1)?.[1]).toBeNull()
    expect(options?.error).toBe('pulse 500')
  })

  it('UX-1 / LIFE-1: a rejected worker call is a failed load, not a pending one', async () => {
    runtime.reply = async message => {
      if (message.type === 'GET_PULSE') throw new Error('The message port closed before a response was received.')
      return { ok: true }
    }
    await navigate('/secondchan')
    expect(lastMountOptions('secondchan')?.error).toBe('request_failed')
  })

  it('LIFE-3: login-only soft-stale and error broadcasts reach the panel without replacing the chart', async () => {
    runtime.reply = async message => message.type === 'GET_PULSE'
      ? { type: 'PULSE_UPDATE', login: message.login, payload: livePayload('thirdchan', 'stream-3') }
      : { ok: true }
    await navigate('/thirdchan')
    mount.updateOverlayPayload.mockClear()

    broadcast({ type: 'PULSE_UPDATE', login: 'thirdchan', payload: null, softStaleRefresh: true })
    expect(mount.updateOverlayPayload).toHaveBeenLastCalledWith(null, undefined, undefined, { softStaleRefresh: true })

    broadcast({ type: 'PULSE_UPDATE', login: 'thirdchan', payload: null, error: 'pulse 503' })
    expect(mount.updateOverlayPayload).toHaveBeenLastCalledWith(null, 'pulse 503', undefined, { softStaleRefresh: undefined })

    // Payload-bearing broadcasts still need a stream identity, and other channels stay ignored.
    mount.updateOverlayPayload.mockClear()
    broadcast({ type: 'PULSE_UPDATE', login: 'thirdchan', payload: livePayload('thirdchan', 'stream-x') })
    broadcast({ type: 'PULSE_UPDATE', login: 'otherchan', payload: null, error: 'pulse 503' })
    expect(mount.updateOverlayPayload).not.toHaveBeenCalled()
  })

  it('UX-2: missing replay coverage stays out of the error lane', async () => {
    runtime.reply = async message => message.type === 'GET_PULSE_VOD'
      ? missingVodReply(message.vodId)
      : { ok: true }
    await navigate('/videos/2806037629')
    expect(mount.updateOverlayVodState).toHaveBeenCalledWith(expect.objectContaining({ loading: false }))
    // '' (not undefined) so the mount clears any earlier failure instead of keeping it.
    expect(mount.updateOverlayPayload).toHaveBeenLastCalledWith(null, '')
  })

  it('UX-2: a Retry that answers "missing" after a failed VOD load clears the outage', async () => {
    runtime.reply = async message => {
      if (message.type === 'GET_PULSE_VOD') throw new Error('The message port closed before a response was received.')
      return { ok: true }
    }
    await navigate('/videos/2806037631')
    // The rejected worker call is a failed load, not an unhandled rejection that keeps loading.
    expect(mount.updateOverlayVodState).toHaveBeenCalledWith(expect.objectContaining({ loading: false }))
    expect(mount.updateOverlayPayload).toHaveBeenLastCalledWith(null, 'request_failed')

    runtime.reply = async message => message.type === 'GET_PULSE_VOD'
      ? missingVodReply(message.vodId)
      : { ok: true }
    await lastMountOptions('__vod__:2806037631')?.onPulseRefresh?.()
    expect(mount.updateOverlayPayload).toHaveBeenLastCalledWith(null, '')
  })

  it('LIFE-2: an idle tab is flagged when the viewer returns and on the next 5 s tick', async () => {
    runtime.reply = async message => message.type === 'GET_PULSE'
      ? { type: 'PULSE_UPDATE', login: message.login, payload: { ...livePayload('idlechan', 'stream-idle'), isLive: false } }
      : { ok: true }
    await navigate('/idlechan')
    mount.updateOverlayPayload.mockClear()

    // No poll runs on an offline channel, so no bridge call would ever notice.
    runtime.id = undefined
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(mount.updateOverlayPayload).toHaveBeenCalledWith(null, EXTENSION_RECONNECT_MESSAGE)

    runtime.id = 'test-extension'
    await vi.advanceTimersByTimeAsync(5_000)
    mount.updateOverlayPayload.mockClear()
    runtime.id = undefined
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mount.updateOverlayPayload).toHaveBeenCalledWith(null, EXTENSION_RECONNECT_MESSAGE)
  })

  it('LIFE-2: an invalidated extension context stops the frozen live tab and asks for a reload', async () => {
    const liveCard = document.createElement('div')
    liveCard.setAttribute('data-a-target', 'stream-info-card-component')
    liveCard.textContent = 'LIVE'
    document.body.append(liveCard)
    runtime.reply = async message => message.type === 'GET_PULSE'
      ? { type: 'PULSE_UPDATE', login: message.login, payload: livePayload('livechan', 'stream-live') }
      : { ok: true }
    await navigate('/livechan')
    const options = lastMountOptions('livechan')
    expect(options?.error).toBeUndefined()
    expect(options?.livePollStore?.getSnapshot().nextScheduledAt).not.toBeNull()
    mount.updateOverlayPayload.mockClear()

    // The extension updates under the open tab: the next live poll hits a dead context.
    runtime.id = undefined
    await vi.advanceTimersByTimeAsync(40_000)
    expect(mount.updateOverlayPayload).toHaveBeenCalledWith(null, EXTENSION_RECONNECT_MESSAGE)
    // The poll is stopped instead of retrying a port that can never answer.
    expect(options?.livePollStore?.getSnapshot().nextScheduledAt).toBeNull()
    liveCard.remove()
  })

  it('LIFE-2: an orphaned VOD tab reports the reconnect state, not a missing replay', async () => {
    runtime.id = undefined
    await navigate('/videos/2806037630')
    expect(mount.updateOverlayPayload).toHaveBeenLastCalledWith(null, EXTENSION_RECONNECT_MESSAGE)
  })
})
