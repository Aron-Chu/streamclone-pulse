// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Overlay } from '../src/ui/Overlay.tsx'
import { overlayBaseStyles } from '../src/ui/overlayStyles.ts'
import { PanelErrorBoundary } from '../src/ui/PanelErrorBoundary.tsx'
import { StreamRecapSection } from '../src/ui/StreamRecapSection.tsx'
import { CoverageCard } from '../src/ui/CoverageCard.tsx'
import { sendBackgroundMessage } from '../src/content/bridge.ts'
import offlinePulse from './e2e/fixtures/api/pulse-offline.json'
import { EXTENSION_RECONNECT_MESSAGE } from '../src/shared/backgroundResponse.ts'
import type { PulsePayload } from '../src/shared/messages.ts'
import type { ExtensionVodPulseResponse } from '../src/types/vodPulseTypes.ts'
import type { TwitchPageContext } from '../src/content/twitch.ts'

vi.mock('../src/content/bridge.ts', () => ({
  sendBackgroundMessage: vi.fn(async () => ({ ok: false })),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CHANNEL: TwitchPageContext = { kind: 'channel', login: 'fixturechan', vodId: null }
const VOD: TwitchPageContext = { kind: 'vod', login: null, vodId: '2806037629' }

function livePayload(): PulsePayload {
  return {
    login: 'fixturechan',
    isLive: true,
    tracking: true,
    streamId: 'stream-1',
    currentOffsetSeconds: 120,
    rollups: [],
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
  }
}

function vodStatus(coverageStatus: 'missing' | 'syncing', coverageMessage: string): ExtensionVodPulseResponse {
  return {
    mode: 'vod',
    vodId: '2806037629',
    provisional: false,
    channelLogin: 'fixturechan',
    coverageStatus,
    coverageMessage,
  } as ExtensionVodPulseResponse
}

type OverlayProps = Parameters<typeof Overlay>[0]

describe('Overlay load, error and dock states', () => {
  let node: HTMLDivElement
  let root: Root

  beforeEach(() => {
    const storage = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) }
    vi.stubGlobal('chrome', {
      runtime: { id: 'test', getManifest: () => ({ version: '0.2.1' }), getURL: (path: string) => path },
      storage: { sync: storage, local: storage, session: storage, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    })
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    node = document.createElement('div')
    document.body.append(node)
    root = createRoot(node)
  })

  afterEach(() => {
    act(() => root.unmount())
    node.remove()
    vi.mocked(sendBackgroundMessage).mockImplementation(async () => ({ ok: false }))
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function render(props: Partial<OverlayProps>): Promise<void> {
    await act(async () => {
      root.render(
        <Overlay
          login="fixturechan"
          context={CHANNEL}
          payload={null}
          effectivePlacement="right"
          overlayMode="expanded"
          sidebarPart="full"
          sessionOpenedAtMs={1}
          {...props}
        />,
      )
    })
  }

  function text(): string {
    return node.textContent ?? ''
  }

  function headerStatus(): string | null {
    return node.querySelector('header.pulse-personal-banner span[aria-label]')?.textContent ?? null
  }

  function buttons(label: string): HTMLButtonElement[] {
    return [...node.querySelectorAll('button')].filter(button => button.textContent?.trim() === label)
  }

  describe('UX-3: floating Mini and Hide are sized by placement CSS, not the viewport', () => {
    for (const placement of ['right', 'bottom'] as const) {
      it(`collapsed and mini sections carry no inline 100% size in ${placement} placement`, async () => {
        await render({ effectivePlacement: placement, overlayMode: 'collapsed' })
        const collapsed = node.querySelector<HTMLElement>('section[aria-label="StreamPulse collapsed"]')
        expect(collapsed?.className).toContain(`placement-${placement}`)
        expect(collapsed?.style.width).toBe('')
        expect(collapsed?.style.height).toBe('')

        await render({ effectivePlacement: placement, overlayMode: 'mini' })
        const mini = node.querySelector<HTMLElement>('section[aria-label="StreamPulse mini overlay"]')
        expect(mini?.className).toContain(`placement-${placement}`)
        expect(mini?.style.width).toBe('')
        expect(mini?.style.height).toBe('')
      })
    }

    it('lets the placement CSS shrink the hidden pill to its content in right and bottom docks', async () => {
      const style = document.createElement('style')
      style.textContent = overlayBaseStyles
      document.head.append(style)
      try {
        for (const placement of ['right', 'bottom'] as const) {
          await render({ effectivePlacement: placement, overlayMode: 'collapsed' })
          const collapsed = node.querySelector<HTMLElement>('section[aria-label="StreamPulse collapsed"]')!
          const computed = getComputedStyle(collapsed)
          expect(computed.position).toBe('fixed')
          expect(computed.width).toBe('auto')
          expect(computed.borderRadius).toBe('999px')
          // The bottom pill keeps its translateX(-50%) centring after the entry animation.
          if (placement === 'bottom') expect(computed.animationName).toBe('pulse-in-bottom')
        }
      } finally {
        style.remove()
      }
    })

    it('keeps the fill size for the sidebar body host', async () => {
      await render({ effectivePlacement: 'sidebar', sidebarSnapped: true, sidebarPart: 'body', sidebarTab: 'pulse', overlayMode: 'collapsed' })
      const collapsed = node.querySelector<HTMLElement>('section[aria-label="StreamPulse collapsed"]')
      expect(collapsed?.style.width).toBe('100%')
      expect(collapsed?.style.height).toBe('100%')

      await render({ effectivePlacement: 'sidebar', sidebarSnapped: true, sidebarPart: 'body', sidebarTab: 'pulse', overlayMode: 'mini' })
      const mini = node.querySelector<HTMLElement>('section[aria-label="StreamPulse mini overlay"]')
      expect(mini?.style.width).toBe('100%')
      expect(mini?.style.height).toBe('100%')
    })
  })

  describe('UX-1 / LIFE-1: a load that never answers ends in an error card with Retry', () => {
    it('offers Retry after ~10 s and switches to the error card after ~30 s', async () => {
      vi.useFakeTimers()
      await render({})
      expect(text()).toContain('Loading Pulse')
      expect(buttons('Retry')).toHaveLength(0)

      await act(async () => { vi.advanceTimersByTime(10_000) })
      expect(text()).toContain('Loading Pulse')
      expect(buttons('Retry')).toHaveLength(1)

      await act(async () => { vi.advanceTimersByTime(20_000) })
      expect(text()).not.toContain('Loading Pulse')
      expect(text()).toContain("Can't reach StreamPulse")
      expect(buttons('Retry')).toHaveLength(1)
      expect(headerStatus()).toBe('Unavailable')
    })

    it("treats a cleared error ('') as no error, so the watchdog still ends the wait", async () => {
      // mount.tsx clears the error lane with '' (resolveOverlayErrorState: an explicit '' wins).
      vi.useFakeTimers()
      await render({ error: '' })
      expect(text()).toContain('Loading Pulse')
      expect(text()).not.toContain("Can't reach StreamPulse")

      await act(async () => { vi.advanceTimersByTime(30_000) })
      expect(text()).not.toContain('Loading Pulse')
      expect(text()).toContain("Can't reach StreamPulse")
      expect(buttons('Retry')).toHaveLength(1)
      expect(headerStatus()).toBe('Unavailable')
    })

    it('restarts the watchdog for a new channel session instead of carrying the old timeout', async () => {
      vi.useFakeTimers()
      await render({})
      await act(async () => { vi.advanceTimersByTime(30_000) })
      expect(text()).toContain("Can't reach StreamPulse")

      await render({ login: 'otherchan', context: { kind: 'channel', login: 'otherchan', vodId: null }, sessionOpenedAtMs: 2 })
      expect(text()).toContain('Loading Pulse')
      expect(text()).not.toContain("Can't reach StreamPulse")
    })

    it('renders a reported first-load error immediately, in viewer language on the hosted backend', async () => {
      await render({ error: 'pulse 500' })
      expect(text()).toContain("Can't reach StreamPulse")
      expect(text()).not.toContain('Loading Pulse')
      expect(text()).not.toMatch(/stack running|api\.streampulse\.stream|pulse 500/)
      expect(buttons('Retry')).toHaveLength(1)
    })
  })

  describe('UX-2: missing or syncing replay data is a status, not an outage', () => {
    for (const [status, message] of [
      ['missing', 'No replay analytics have been indexed for this VOD yet.'],
      ['syncing', 'Replay Pulse is syncing this VOD'],
    ] as const) {
      it(`VOD ${status} shows the replay status card without "Can't reach" or an endless loader`, async () => {
        vi.useFakeTimers()
        await render({ context: VOD, login: '__vod__:2806037629', vodPulse: vodStatus(status, message), vodPulseLoading: false })
        await act(async () => { vi.advanceTimersByTime(30_000) })
        expect(text()).toContain(message)
        expect(text()).not.toContain("Can't reach StreamPulse")
        expect(text()).not.toContain('stack running')
        expect(text()).not.toContain('Loading Pulse')
        expect(headerStatus()).not.toBe('Unavailable')
        expect(headerStatus()).not.toBe('Loading')
      })
    }

    it('a stalled VOD load shows one error state, not "Loading replay analytics" beside the outage card', async () => {
      vi.useFakeTimers()
      await render({ context: VOD, login: '__vod__:2806037629', vodPulse: null, vodPulseLoading: true })
      expect(text()).toContain('Loading replay analytics')
      await act(async () => { vi.advanceTimersByTime(30_000) })
      expect(text()).toContain("Can't reach StreamPulse")
      expect(text()).not.toContain('Loading replay analytics')
    })

    it('an orphaned VOD tab offers Reload page only, never a Retry through the dead port', async () => {
      await render({ context: VOD, login: '__vod__:2806037629', vodPulse: null, vodPulseLoading: false, error: EXTENSION_RECONNECT_MESSAGE })
      expect(text()).toContain('Extension disconnected')
      expect(buttons('Reload page')).toHaveLength(1)
      expect(buttons('Retry')).toHaveLength(0)
    })
  })

  describe('UX-5 / LIFE-2: refresh failures over a chart use viewer copy', () => {
    it('never shows a raw error code in the refresh banner', async () => {
      await render({ payload: livePayload(), pageIsLive: true, error: 'extension_api_invalid_pulse_payload' })
      const banner = node.querySelector('.pulse-refresh-error')
      expect(banner?.textContent).toContain('The latest Pulse refresh failed; showing the last good data.')
      expect(text()).not.toContain('extension_api_invalid_pulse_payload')
    })

    it('keeps the render-crash error class out of the panel copy', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      function Crash(): never {
        throw new TypeError('boom')
      }
      await act(async () => {
        root.render(<PanelErrorBoundary emit={vi.fn(async () => {})}><Crash /></PanelErrorBoundary>)
      })
      expect(text()).toContain('Something went wrong rendering this panel.')
      expect(text()).not.toMatch(/type_error|unknown|\(/)
      // The way out is text only: the content script carries no feedback button or URL.
      expect(text()).toContain('If this persists, open Help & Feedback in Settings.')
      expect(node.querySelector('a, button')).toBeNull()
      consoleError.mockRestore()
    })

    it('a failed Full chart request shows viewer copy, not the transport message', async () => {
      vi.mocked(sendBackgroundMessage).mockImplementation(async message => {
        if (message.type === 'GET_PULSE' && message.window === 'full') {
          throw new Error('The message port closed before a response was received.')
        }
        return { ok: false }
      })
      // Without fullRollups the recap chart asks for the Full timeline on its own
      // when it mounts (here: on expanding the hidden panel of an open activation).
      const recap = { payload: { ...offlinePulse, fullRollups: undefined } as unknown as PulsePayload, pageIsLive: false }
      await render({ ...recap, overlayMode: 'collapsed' })
      await render({ ...recap, overlayMode: 'expanded' })
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(vi.mocked(sendBackgroundMessage)).toHaveBeenCalledWith(expect.objectContaining({ type: 'GET_PULSE', window: 'full' }))
      expect(text()).toContain('Could not load full stream chart.')
      expect(text()).not.toContain('message port closed')
    })

    it('the recap error card never shows a raw poll error code', async () => {
      const recapProps = {
        payload: offlinePulse as unknown as PulsePayload,
        backendUrl: 'https://api.streampulse.stream',
        uiState: 'error' as const,
        isLive: false,
        onJump: vi.fn(),
        onAnalytics: vi.fn(),
        onOpenAnalytics: vi.fn(),
      }
      await act(async () => {
        root.render(<StreamRecapSection {...recapProps} pollError="extension_api_invalid_pulse_payload" />)
      })
      expect(text()).toContain('Stream recap is unavailable right now.')
      expect(text()).not.toContain('extension_api_invalid_pulse_payload')

      await act(async () => {
        root.render(<StreamRecapSection {...recapProps} pollError={EXTENSION_RECONNECT_MESSAGE} />)
      })
      expect(text()).toContain(EXTENSION_RECONNECT_MESSAGE)
    })

    it('a failed backfill job with an unmapped code still explains itself', async () => {
      await act(async () => {
        root.render(
          <CoverageCard
            source={{
              coverage: { state: 'backfill_failed', coverageStartOffsetSeconds: 900, hasFullStreamCoverage: false } as never,
              coverageStartOffsetSeconds: 900,
              vodId: '2806037629',
            }}
            busy={false}
            refreshed={false}
            job={{ jobId: 'job-1', status: 'failed', error: 'pulse_backfill_internal_42' } as never}
            onLoad={vi.fn()}
          />,
        )
      })
      expect(text()).toContain('Backfill failed.')
      expect(text()).not.toContain('pulse_backfill_internal_42')
      expect(buttons('Retry backfill')).toHaveLength(1)
    })

    it('asks an orphaned tab to reload instead of offering a Retry that cannot work', async () => {
      await render({ payload: livePayload(), pageIsLive: true, error: EXTENSION_RECONNECT_MESSAGE })
      const banner = node.querySelector('.pulse-refresh-error')
      expect(banner?.textContent).toContain(EXTENSION_RECONNECT_MESSAGE)
      expect(banner?.querySelector('button')?.textContent).toBe('Reload page')
    })
  })
})
