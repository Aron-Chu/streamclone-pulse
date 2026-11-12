// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Overlay } from '../src/ui/Overlay.tsx'
import { sendBackgroundMessage } from '../src/content/bridge.ts'
import type { ExtensionRollup } from '../src/shared/messages.ts'
import type { TwitchPageContext } from '../src/content/twitch.ts'
import type { ExtensionVodPulseResponse } from '../src/types/vodPulseTypes.ts'
import { vodPulseToChannelPayload } from '../src/vod/vodPulseToChannelPayload.ts'

vi.mock('../src/content/bridge.ts', () => ({
  sendBackgroundMessage: vi.fn(async () => ({ ok: false })),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const VOD_ID = '2903671992'
const VOD: TwitchPageContext = { kind: 'vod', login: null, vodId: VOD_ID }

function minutes(fromSeconds: number, toSeconds: number): ExtensionRollup[] {
  const rows: ExtensionRollup[] = []
  for (let offset = fromSeconds; offset <= toSeconds; offset += 60) {
    rows.push({ offsetSeconds: offset, chatCount: 40, sevenTvEmoteCount: 4, totalEmoteCount: 9, viewerCount: 9_000 })
  }
  return rows
}

// A growing VOD two hours in: the recent window starts at 56:00, the full one at 0:50.
function growingVod(fullRollups?: ExtensionRollup[]): ExtensionVodPulseResponse {
  return {
    mode: 'live_dvr',
    vodId: VOD_ID,
    provisional: false,
    resolutionState: 'live_archive_validated',
    retryable: false,
    streamId: 'stream-jerma',
    login: 'jerma985',
    isLive: true,
    tracking: true,
    startedAt: '2026-10-17T22:00:00.000Z',
    currentOffsetSeconds: 7_730,
    coverageStartOffsetSeconds: 50,
    rollups: minutes(3_350, 7_730),
    fullRollups,
    lanes: { composite: [], chat: [], seventv: [] },
  } as ExtensionVodPulseResponse
}

describe('VOD-5: a growing VOD loads its full history on its own', () => {
  let node: HTMLDivElement
  let root: Root

  beforeEach(() => {
    const storage = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) }
    vi.stubGlobal('chrome', {
      runtime: { id: 'test', getManifest: () => ({ version: '0.2.2' }), getURL: (path: string) => path },
      storage: { sync: storage, local: storage, session: storage, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    })
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.mocked(sendBackgroundMessage).mockImplementation(async (request: { type: string; window?: string }) => {
      if (request.type === 'GET_PULSE_VOD' && request.window === 'full') {
        return { type: 'VOD_PULSE_UPDATE', vodId: VOD_ID, vodPulse: growingVod(minutes(50, 7_730)) }
      }
      return { ok: false }
    })
    node = document.createElement('div')
    document.body.append(node)
    root = createRoot(node)
  })

  afterEach(() => {
    act(() => root.unmount())
    node.remove()
    vi.mocked(sendBackgroundMessage).mockImplementation(async () => ({ ok: false }))
    vi.unstubAllGlobals()
  })

  it('keeps the Full request it starts when the first payload arrives', async () => {
    const props = {
      login: 'jerma985',
      context: VOD,
      effectivePlacement: 'right' as const,
      overlayMode: 'expanded' as const,
      sidebarPart: 'full' as const,
      sessionOpenedAtMs: 1,
    }
    await act(async () => { root.render(<Overlay {...props} payload={null} />) })
    const recent = vodPulseToChannelPayload(growingVod(), 'jerma985')
    await act(async () => { root.render(<Overlay {...props} payload={recent} />) })
    for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })

    expect(sendBackgroundMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'GET_PULSE_VOD', window: 'full', vodId: VOD_ID }))
    expect(node.textContent).not.toContain('Retry full history')
    expect(node.textContent).toContain('Viewer data from 00:00:50')
  })
})
