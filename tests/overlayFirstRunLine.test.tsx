// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Overlay } from '../src/ui/Overlay.tsx'
import liveReady from './e2e/fixtures/api/pulse-live-ready.json'
import coverageActive from './e2e/fixtures/api/coverage-active.json'
import type { ExtensionCoverageTierResponse, PulsePayload } from '../src/shared/messages.ts'
import type { TwitchPageContext } from '../src/content/twitch.ts'

vi.mock('../src/content/bridge.ts', () => ({
  sendBackgroundMessage: vi.fn(async () => ({ ok: false })),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CHANNEL: TwitchPageContext = { kind: 'channel', login: 'fixturechan', vodId: null }
const LINE = 'Pulse charts this stream’s chat. Click Chat for Twitch chat.'

type OverlayProps = Parameters<typeof Overlay>[0]

describe('Overlay first-run line', () => {
  let node: HTMLDivElement
  let root: Root
  let sync: Record<string, unknown>

  beforeEach(() => {
    sync = { overlayPlacement: 'sidebar', sidebarTab: 'pulse' }
    const area = (store: () => Record<string, unknown>) => ({
      get: vi.fn(async (keys?: string | string[] | null) => {
        if (keys == null) return { ...store() }
        const list = Array.isArray(keys) ? keys : [keys]
        return Object.fromEntries(list.filter(key => key in store()).map(key => [key, store()[key]]))
      }),
      set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(store(), items) }),
    })
    const empty: Record<string, unknown> = {}
    vi.stubGlobal('chrome', {
      runtime: { id: 'test', getManifest: () => ({ version: '0.2.6' }), getURL: (path: string) => path },
      storage: {
        sync: area(() => sync),
        local: area(() => empty),
        session: area(() => empty),
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    })
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    node = document.createElement('div')
    document.body.append(node)
    root = createRoot(node)
  })

  afterEach(() => {
    act(() => root.unmount())
    node.remove()
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
          effectivePlacement="sidebar"
          overlayMode="expanded"
          sidebarPart="body"
          sidebarTab="pulse"
          sessionOpenedAtMs={1}
          {...props}
        />,
      )
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }

  const line = () => node.querySelector('[data-pulse-first-run]')

  it('says what Pulse is until the reader dismisses it, then never again', async () => {
    await render()
    expect(line()?.textContent).toBe(`${LINE} Dismiss`)
    await act(async () => { line()!.querySelector('button')!.click() })
    expect(line()).toBeNull()
    expect(sync.firstRunLineDismissed).toBe(true)

    act(() => root.unmount())
    root = createRoot(node)
    await render()
    expect(line()).toBeNull()
  })

  it('stays out of the floating panel, which has no Chat tab', async () => {
    await render({ effectivePlacement: 'right', sidebarPart: 'full' })
    expect(node.textContent).toContain('Open Analytics Hub')
    expect(line()).toBeNull()
  })

  it('stays out of a channel Pulse does not chart', async () => {
    await render({ payload: { ...(liveReady as unknown as PulsePayload), rosterEligible: false } })
    expect(node.textContent).toContain('Not charted')
    expect(line()).toBeNull()
  })
})
