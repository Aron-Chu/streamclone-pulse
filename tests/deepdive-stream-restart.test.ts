// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.twitch.tv/fixturechan"}
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Regression (deep dive 2026-10-09): a channel tab that accepted one stream id
 * never accepted the next stream of the same channel unless an authoritative
 * refresh happened to return it. Drives the real content entry with a stubbed
 * worker that behaves like the real one: every GET_PULSE answer is also
 * broadcast as a stream-scoped PULSE_UPDATE (pulseGetCoordinator onBroadcast).
 * A live broadcast of a new stream while the page reads live now triggers one
 * authoritative refresh (at most every 30 s), which moves the panel over.
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

const listeners: Array<(message: unknown) => void> = []
let serverStream = { id: 'stream-old', live: false }
const getPulseCalls: string[] = []

function payload(login: string) {
  return {
    login,
    isLive: serverStream.live,
    tracking: true,
    streamId: serverStream.id,
    currentOffsetSeconds: 120,
    rollups: [],
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
  }
}

function setPageLive(live: boolean): void {
  document.querySelectorAll('[data-a-target="stream-info-card-component"]').forEach(node => node.remove())
  if (!live) return
  const card = document.createElement('div')
  card.setAttribute('data-a-target', 'stream-info-card-component')
  card.textContent = 'LIVE'
  document.body.append(card)
}

describe('same-channel stream restart', () => {
  beforeAll(async () => {
    vi.useFakeTimers()
    const storage = { get: async () => ({ autoUpdateEnabled: true }), set: async () => {}, remove: async () => {} }
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'test-extension',
        sendMessage: async (message: { type: string; login?: string }) => {
          if (message.type !== 'GET_PULSE') return { ok: true }
          getPulseCalls.push(serverStream.id)
          const reply = { type: 'PULSE_UPDATE', login: message.login, payload: payload(message.login!) }
          // The real worker broadcasts each fetched payload, scoped to its stream id.
          queueMicrotask(() => {
            for (const listener of listeners) {
              listener({ ...reply, streamId: serverStream.id })
            }
          })
          return reply
        },
        onMessage: { addListener: (l: (m: unknown) => void) => listeners.push(l), removeListener: () => {} },
        getURL: (path: string) => path,
      },
      storage: { sync: storage, local: storage, session: storage, onChanged: { addListener: () => {}, removeListener: () => {} } },
    })
    history.replaceState({}, '', '/restartchan')
    setPageLive(false)
    await import('../src/content/entry.ts')
    await vi.advanceTimersByTimeAsync(2_000)
  })

  afterAll(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('offline recap -> channel goes live, backend knows the new stream a minute later: the panel moves to it', async () => {
    const shown = () => mount.updateOverlayPayload.mock.calls
      .map(call => (call[0] as { streamId?: string } | null)?.streamId)
      .filter(Boolean)
    const mounted = mount.mountOverlay.mock.calls.at(-1)?.[1] as { streamId?: string } | null
    expect(mounted?.streamId).toBe('stream-old')

    // Twitch flips the page to live. The backend has not seen the new stream yet.
    setPageLive(true)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(getPulseCalls.at(-1)).toBe('stream-old')

    // One minute later the backend knows the new stream; the live poll keeps asking.
    serverStream = { id: 'stream-new', live: true }
    mount.updateOverlayPayload.mockClear()
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    // The panel moved to the new stream...
    expect(shown()).toContain('stream-new')
    // ...through refreshes throttled to one per 30 s, not one per broadcast.
    const polledNew = getPulseCalls.filter(id => id === 'stream-new').length
    expect(polledNew).toBeGreaterThan(0)
    expect(polledNew).toBeLessThanOrEqual(10 * 60 / 30 + 21)
  })
})
