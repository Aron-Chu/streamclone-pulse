// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.twitch.tv/startchan"}
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Startup order of the real content entry against a stubbed worker: the first
 * route check runs on load, the chart request does not wait on the auto-track
 * settings, a same-route URL rewrite never cancels a load in flight, and with
 * no panel up the empty one waits a moment for the chart's answer. The
 * entry is a side-effect module, so it is imported once and the cases below
 * run in order, each on its own Twitch route.
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

type WorkerMessage = { type: string; login?: string }

const sent: WorkerMessage[] = []
let reply: (message: WorkerMessage) => Promise<unknown> = async () => ({ ok: true })
let stored: Record<string, unknown> = {}
/** A storage key whose reads wait until `release` runs. */
let heldKey: string | null = null
let release: (() => void) | null = null
let startup: { sent: WorkerMessage[]; mounted: unknown[] } = { sent: [], mounted: [] }

function payload(login: string, tracking = true) {
  return {
    login,
    isLive: true,
    tracking,
    streamId: `stream-${login}`,
    currentOffsetSeconds: 120,
    rollups: [],
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
  }
}

function pulse(login: string | undefined, delayMs = 0, tracking = true): Promise<unknown> {
  const message = { type: 'PULSE_UPDATE', login, payload: payload(login ?? '', tracking) }
  return delayMs ? new Promise(resolve => setTimeout(() => resolve(message), delayMs)) : Promise.resolve(message)
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve()
}

async function navigate(path: string, ms = 2_000): Promise<void> {
  history.pushState({}, '', path)
  await vi.advanceTimersByTimeAsync(ms)
}

function mountedPayloads(login: string): unknown[] {
  return mount.mountOverlay.mock.calls.filter(call => call[0] === login).map(call => call[1])
}

function pulseRequests(login: string): WorkerMessage[] {
  return sent.filter(message => message.type === 'GET_PULSE' && message.login === login)
}

describe('content entry startup', () => {
  beforeAll(async () => {
    vi.useFakeTimers()
    const storage = {
      get: async (keys: string | string[]) => {
        const list = typeof keys === 'string' ? [keys] : keys
        const values = Object.fromEntries(list.filter(key => key in stored).map(key => [key, stored[key]]))
        if (heldKey && list.includes(heldKey)) {
          return new Promise(resolve => { release = () => resolve(values) })
        }
        return values
      },
      set: async () => {},
      remove: async () => {},
    }
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'test-extension',
        sendMessage: (message: WorkerMessage) => {
          sent.push(message)
          return reply(message)
        },
        onMessage: { addListener: () => {}, removeListener: () => {} },
        getURL: (path: string) => path,
      },
      storage: {
        sync: storage,
        local: storage,
        session: storage,
        onChanged: { addListener: () => {}, removeListener: () => {} },
      },
    })
    reply = async message => message.type === 'GET_PULSE' ? pulse(message.login) : { ok: true }
    await import('../src/content/entry.ts')
    // Microtasks only: no timer may run before the first check.
    await flushMicrotasks()
    startup = { sent: [...sent], mounted: mountedPayloads('startchan') }
    await vi.advanceTimersByTimeAsync(2_000)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    sent.length = 0
    heldKey = null
    release = null
  })

  afterAll(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('checks the page on load instead of after the navigation wait', () => {
    expect(startup.sent.filter(message => message.type === 'GET_PULSE').map(message => message.login)).toEqual(['startchan'])
    expect(startup.mounted.at(-1)).toMatchObject({ login: 'startchan' })
  })

  it('keeps the navigation wait for later URL changes', async () => {
    await navigate('/laterchan', 300)
    expect(pulseRequests('laterchan')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(pulseRequests('laterchan')).toHaveLength(1)
  })

  it('asks for the chart before the auto-track settings are read', async () => {
    heldKey = 'autoTrackPolicy'
    await navigate('/heldchan', 400)
    expect(pulseRequests('heldchan')).toHaveLength(1)
    expect(mountedPayloads('heldchan')).toEqual([null])

    release?.()
    await flushMicrotasks()
    expect(mountedPayloads('heldchan').at(-1)).toMatchObject({ login: 'heldchan' })
  })

  it('a same-route URL rewrite never cancels the load in flight', async () => {
    reply = async message => message.type === 'GET_PULSE' ? pulse(message.login, 1_000) : { ok: true }
    await navigate('/slowchan', 400)
    history.replaceState({}, '', '/slowchan')
    await vi.advanceTimersByTimeAsync(2_000)

    expect(pulseRequests('slowchan')).toHaveLength(1)
    expect(mountedPayloads('slowchan').at(-1)).toMatchObject({ login: 'slowchan' })
  })

  it('a new channel during a slow load shows only the new channel', async () => {
    reply = async message => message.type === 'GET_PULSE'
      ? pulse(message.login, message.login === 'slowa' ? 1_000 : 0)
      : { ok: true }
    await navigate('/slowa', 400)
    await navigate('/fastb')

    expect(mountedPayloads('slowa').every(value => value === null)).toBe(true)
    expect(mount.mountOverlay.mock.calls.at(-1)?.[0]).toBe('fastb')
    expect(mountedPayloads('fastb').at(-1)).toMatchObject({ login: 'fastb' })
    expect(mount.updateOverlayPayload.mock.calls.some(call => (call[0] as { login?: string } | null)?.login === 'slowa')).toBe(false)
  })

  it('the local stack still auto-tracks a followed channel', async () => {
    stored = { backendUrl: 'http://localhost:8081', localBackendOptIn: true, autoTrackPolicy: 'followed' }
    reply = async message => {
      if (message.type === 'GET_PULSE') return pulse(message.login, 0, false)
      if (message.type === 'TRACK') return pulse(message.login, 0, true)
      return { ok: true }
    }
    try {
      await navigate('/trackchan')
      expect(sent.filter(message => message.login === 'trackchan').map(message => message.type)).toEqual(['GET_PULSE', 'TRACK'])
      expect(mountedPayloads('trackchan').at(-1)).toMatchObject({ login: 'trackchan', tracking: true })
    } finally {
      stored = {}
    }
  })

  it('a channel switch with a panel up shows the new channel at once', async () => {
    reply = async message => message.type === 'GET_PULSE' ? pulse(message.login, 1_000) : { ok: true }
    await navigate('/switchchan', 400)
    expect(mountedPayloads('switchchan')).toEqual([null])
  })

  it('with no panel up, the empty panel waits for the answer, at most as long as the navigation wait', async () => {
    await navigate('/directory')
    expect(mount.unmountOverlay).toHaveBeenCalled()
    reply = async message => message.type === 'GET_PULSE' ? pulse(message.login, 1_000) : { ok: true }
    await navigate('/coldchan', 600)
    expect(pulseRequests('coldchan')).toHaveLength(1)
    expect(mountedPayloads('coldchan')).toEqual([])

    await vi.advanceTimersByTimeAsync(150)
    expect(mountedPayloads('coldchan')).toEqual([null])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(mountedPayloads('coldchan').at(-1)).toMatchObject({ login: 'coldchan' })
  })

  it('with no panel up, a quick answer comes up with the panel', async () => {
    await navigate('/directory')
    reply = async message => message.type === 'GET_PULSE' ? pulse(message.login, 100) : { ok: true }
    await navigate('/quickchan', 440)
    expect(mountedPayloads('quickchan')).toEqual([])

    await vi.advanceTimersByTimeAsync(20)
    expect(mountedPayloads('quickchan')).toEqual([null, expect.objectContaining({ login: 'quickchan' })])
  })
})
