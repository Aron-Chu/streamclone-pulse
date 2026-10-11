// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { Overlay } from '../src/ui/Overlay.tsx'
import { sendBackgroundMessage } from '../src/content/bridge.ts'
import liveReady from './e2e/fixtures/api/pulse-live-ready.json'
import coverageActive from './e2e/fixtures/api/coverage-active.json'
import type { ExtensionCoverageTierResponse, PulsePayload } from '../src/shared/messages.ts'
import type { TwitchPageContext } from '../src/content/twitch.ts'

/**
 * Overlay.openAnalytics passes "no offset" through as undefined, and
 * buildAnalyticsUrl keeps offset 0 as a real minute. Both halves matter:
 * the header and coverage links call openAnalytics() with no argument, so an
 * `offsetSeconds ?? 0` there would aim them at minute 0 instead of the stream,
 * and the live "From start" fallback outside Twitch's DVR window must keep
 * `#t=0`. These tests click the real buttons and read what window.open got.
 */

vi.mock('../src/content/bridge.ts', () => ({
  sendBackgroundMessage: vi.fn(async () => ({ ok: false })),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CHANNEL: TwitchPageContext = { kind: 'channel', login: 'fixturechan', vodId: null }
const STREAM_ANALYTICS = 'https://streampulse.stream/analytics/fixturechan/stream-fixture-1'

type OverlayProps = Parameters<typeof Overlay>[0]

describe('Overlay analytics links', () => {
  let node: HTMLDivElement
  let root: Root
  let open: MockInstance<typeof window.open>
  let video: HTMLVideoElement | null = null

  beforeEach(() => {
    const storage = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) }
    vi.stubGlobal('chrome', {
      runtime: { id: 'test', getManifest: () => ({ version: '0.2.2' }), getURL: (path: string) => path },
      storage: { sync: storage, local: storage, session: storage, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    })
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.mocked(sendBackgroundMessage).mockImplementation(async message => {
      if (message.type === 'LIST_PAST_VODS') {
        return {
          type: 'PAST_VODS',
          items: [{ streamId: 'stream-fixture-1', title: 'Fixture live stream', analyticsStatus: 'current-live' }],
        } as never
      }
      return { ok: false } as never
    })
    open = vi.spyOn(window, 'open').mockImplementation(() => null)
    node = document.createElement('div')
    document.body.append(node)
    root = createRoot(node)
  })

  afterEach(() => {
    act(() => root.unmount())
    node.remove()
    video?.remove()
    video = null
    open.mockRestore()
    vi.mocked(sendBackgroundMessage).mockImplementation(async () => ({ ok: false }))
    vi.unstubAllGlobals()
  })

  async function render(props: Partial<OverlayProps> = {}): Promise<void> {
    await act(async () => {
      root.render(
        <Overlay
          login="fixturechan"
          context={CHANNEL}
          payload={liveReady as unknown as PulsePayload}
          coverageTier={coverageActive as ExtensionCoverageTierResponse}
          pageIsLive
          effectivePlacement="right"
          overlayMode="expanded"
          sidebarPart="full"
          sessionOpenedAtMs={1}
          {...props}
        />,
      )
    })
    // Let the Past streams list answer from the mocked worker.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }

  function button(label: string): HTMLButtonElement {
    const matches = [...node.querySelectorAll('button')].filter(el => el.textContent?.trim() === label)
    expect(matches, `button "${label}"`).toHaveLength(1)
    return matches[0]!
  }

  function openedUrls(): string[] {
    return open.mock.calls.map(call => String(call[0]))
  }

  /** A live player whose DVR window holds only the last 100 s. */
  function mountLivePlayerWithShortDvr(): void {
    video = document.createElement('video')
    const ranges = { length: 1, start: () => 0, end: () => 100 } as unknown as TimeRanges
    const empty = { length: 0, start: () => 0, end: () => 0 } as unknown as TimeRanges
    Object.defineProperty(video, 'seekable', { configurable: true, get: () => ranges })
    Object.defineProperty(video, 'buffered', { configurable: true, get: () => empty })
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 90, set: () => {} })
    document.body.append(video)
  }

  it('"Stream analytics" opens the stream itself, with no #t minute', async () => {
    await render()
    await act(async () => { button('Stream analytics →').click() })
    expect(openedUrls()).toEqual([STREAM_ANALYTICS])
  })

  it('"From start" outside the live DVR window opens the stream analytics at #t=0', async () => {
    mountLivePlayerWithShortDvr()
    await render()
    await act(async () => { button('From start').click() })
    expect(openedUrls()).toEqual([`${STREAM_ANALYTICS}#t=0`])
    expect(node.textContent).toContain('outside Twitch’s live DVR window')
  })
})
