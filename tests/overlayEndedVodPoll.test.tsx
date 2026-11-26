// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ENDED_VOD_POLL_MAX_CHECKS, Overlay } from '../src/ui/Overlay.tsx'
import { sendBackgroundMessage } from '../src/content/bridge.ts'
import type { ExtensionRollup, PulsePayload } from '../src/shared/messages.ts'
import type { TwitchPageContext } from '../src/content/twitch.ts'

vi.mock('../src/content/bridge.ts', () => ({
  sendBackgroundMessage: vi.fn(async () => ({ ok: false })),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Audit 2026-11-26 finding 1: after a stream ends on a channel whose VOD never
 * links (VODs off), the panel checked Twitch, backend health and the panel data
 * every 30 s for as long as the tab stayed open, hidden tabs included.
 */
const CHANNEL: TwitchPageContext = { kind: 'channel', login: 'jerma985', vodId: null }

function minutes(count: number): ExtensionRollup[] {
  return Array.from({ length: count }, (_, index) => ({
    offsetSeconds: index * 60, chatCount: 40, sevenTvEmoteCount: 4, totalEmoteCount: 9, viewerCount: 9_000,
  }))
}

function stream(isLive: boolean, vodStatus?: string): PulsePayload {
  return {
    login: 'jerma985',
    streamId: 'stream-jerma',
    isLive,
    tracking: true,
    startedAt: '2026-11-25T22:00:00.000Z',
    endedAt: isLive ? null : '2026-11-26T00:00:00.000Z',
    currentOffsetSeconds: 7_200,
    rollups: minutes(120),
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
    peaks: [],
    ...(vodStatus ? { coverage: { vodStatus } } : {}),
  } as PulsePayload
}

const RECAP = {
  streamId: 'stream-jerma', login: 'jerma985', durationSeconds: 7_200, totalMessages: 4_800,
  peakChatPerMin: 40, topMoments: [], topEmotes: [], clipCandidates: [],
} satisfies PulsePayload['recap']

describe('the ended-stream VOD check', () => {
  let node: HTMLDivElement
  let root: Root
  let hidden = false
  const props = {
    login: 'jerma985',
    context: CHANNEL,
    effectivePlacement: 'right' as const,
    overlayMode: 'expanded' as const,
    sidebarPart: 'full' as const,
    sessionOpenedAtMs: 1,
  }
  const checks = () => vi.mocked(sendBackgroundMessage).mock.calls
    .filter(([request]) => (request as { type: string }).type === 'HEALTH').length
  const fullRequests = () => vi.mocked(sendBackgroundMessage).mock.calls
    .filter(([request]) => {
      const { type, window } = request as { type: string; window?: string }
      return type === 'GET_PULSE' && window === 'full'
    }).length

  async function flush(): Promise<void> {
    for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve() })
  }
  async function wait(ms: number): Promise<void> {
    for (let at = 0; at < ms; at += 30_000) {
      await act(async () => { vi.advanceTimersByTime(30_000) })
      await flush()
    }
  }
  async function liveThenEnded(): Promise<void> {
    await act(async () => { root.render(<Overlay {...props} payload={stream(true)} />) })
    await flush()
    await act(async () => { root.render(<Overlay {...props} payload={stream(false)} />) })
    await flush()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    hidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    const storage = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) }
    vi.stubGlobal('chrome', {
      runtime: { id: 'test', getManifest: () => ({ version: '0.2.2' }), getURL: (path: string) => path },
      storage: { sync: storage, local: storage, session: storage, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    })
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.mocked(sendBackgroundMessage).mockClear().mockImplementation(async () => ({ ok: false }))
    node = document.createElement('div')
    document.body.append(node)
    root = createRoot(node)
  })

  afterEach(() => {
    act(() => root.unmount())
    node.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(document, 'hidden')
  })

  it(`stops after ${ENDED_VOD_POLL_MAX_CHECKS} checks when the VOD never links`, async () => {
    await liveThenEnded()
    expect(checks()).toBe(1)
    await wait(60 * 60_000)
    expect(checks()).toBe(ENDED_VOD_POLL_MAX_CHECKS)
  })

  it('a check still running skips ticks without using them up, even across a re-render', async () => {
    let release: (() => void) | null = null
    vi.mocked(sendBackgroundMessage).mockImplementation(async (request) => {
      if ((request as { type: string }).type === 'HEALTH' && !release) {
        await new Promise<void>((resolve) => { release = resolve })
      }
      return { ok: false }
    })
    await liveThenEnded()
    expect(checks()).toBe(1)
    // A new VOD status re-runs the poll while the first check is still waiting.
    await act(async () => { root.render(<Overlay {...props} payload={stream(false, 'pending')} />) })
    await flush()
    await wait(5 * 60_000)
    expect(checks()).toBe(1)
    await act(async () => { release?.() })
    await flush()
    await wait(60 * 60_000)
    expect(checks()).toBe(ENDED_VOD_POLL_MAX_CHECKS)
  })

  it('a Full stream request during a check does not stop the checks', async () => {
    // The Full request replaces the running check, which then skips its own
    // busy reset. The flag stayed set, so every later tick was skipped.
    let release: (() => void) | null = null
    vi.mocked(sendBackgroundMessage).mockImplementation(async (request) => {
      if ((request as { type: string }).type === 'HEALTH' && !release) {
        await new Promise<void>((resolve) => { release = resolve })
      }
      return { ok: false }
    })
    await liveThenEnded()
    expect(checks()).toBe(1)
    // The recap shows up while the check waits, and its chart asks for the Full stream.
    await act(async () => { root.render(<Overlay {...props} payload={{ ...stream(false), recap: RECAP }} />) })
    await flush()
    expect(fullRequests()).toBeGreaterThan(0)
    await act(async () => { release?.() })
    await flush()
    await wait(60 * 60_000)
    expect(checks()).toBe(ENDED_VOD_POLL_MAX_CHECKS)
  })

  it('skips checks while the tab is hidden, and they do not use up the budget', async () => {
    hidden = true
    await liveThenEnded()
    await wait(10 * 60_000)
    expect(checks()).toBe(0)
    hidden = false
    await wait(60 * 60_000)
    expect(checks()).toBe(ENDED_VOD_POLL_MAX_CHECKS)
  })
})
