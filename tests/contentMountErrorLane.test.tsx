// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.twitch.tv/fixturechan"}
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PULSE_ROOT_HOST_ID,
  mountOverlay,
  unmountOverlay,
  updateOverlayPayload,
  updateOverlayVodState,
} from '../src/content/mount.tsx'
import { EXTENSION_RECONNECT_MESSAGE } from '../src/shared/backgroundResponse.ts'
import type { ExtensionVodPulseResponse } from '../src/types/vodPulseTypes.ts'
import type { TwitchPageContext } from '../src/content/twitch.ts'

/**
 * The real mount owns the error lane between the entry and the Overlay, so
 * these cases go through mountOverlay / updateOverlayPayload and read the
 * rendered shadow root, not the Overlay props.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CHANNEL: TwitchPageContext = { kind: 'channel', login: 'fixturechan', vodId: null }
const VOD: TwitchPageContext = { kind: 'vod', login: null, vodId: '2806037629' }

function panelText(): string {
  return document.getElementById(PULSE_ROOT_HOST_ID)?.shadowRoot?.textContent ?? ''
}

function panelButtons(label: string): HTMLButtonElement[] {
  const shadow = document.getElementById(PULSE_ROOT_HOST_ID)?.shadowRoot
  return [...(shadow?.querySelectorAll('button') ?? [])].filter(button => button.textContent?.trim() === label)
}

async function settle(run: () => void = () => {}): Promise<void> {
  await act(async () => {
    run()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('content mount error lane', () => {
  beforeEach(() => {
    const storage = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) }
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'test',
        getManifest: () => ({ version: '0.2.1' }),
        getURL: (path: string) => path,
        sendMessage: vi.fn(async () => ({ ok: false })),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      storage: { sync: storage, local: storage, session: storage, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    })
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  })

  afterEach(async () => {
    await settle(() => unmountOverlay())
    vi.unstubAllGlobals()
  })

  it('UX-1: a failed first load mounts the outage card, not an endless "Loading Pulse"', async () => {
    await settle(() => mountOverlay('fixturechan', null, CHANNEL, { sessionOpenedAtMs: 1, error: 'pulse 500' }))
    expect(panelText()).toContain("Can't reach StreamPulse")
    expect(panelText()).not.toContain('Loading Pulse')
    expect(panelText()).not.toContain('pulse 500')
    expect(panelButtons('Retry')).toHaveLength(1)
  })

  it('LIFE-1: a first load from an orphaned tab mounts the reconnect card with Reload page', async () => {
    await settle(() => mountOverlay('fixturechan', null, CHANNEL, { sessionOpenedAtMs: 1, error: EXTENSION_RECONNECT_MESSAGE }))
    expect(panelText()).toContain('Extension disconnected')
    expect(panelText()).not.toContain('Loading Pulse')
    expect(panelButtons('Reload page')).toHaveLength(1)
    expect(panelButtons('Retry')).toHaveLength(0)
  })

  it('LIFE-3: a soft-stale broadcast with no chart on screen keeps the error card', async () => {
    await settle(() => mountOverlay('fixturechan', null, CHANNEL, { sessionOpenedAtMs: 1, error: 'pulse 500' }))
    await settle(() => updateOverlayPayload(null, undefined, undefined, { softStaleRefresh: true }))
    expect(panelText()).toContain("Can't reach StreamPulse")
    expect(panelText()).not.toContain('Loading Pulse')
  })

  it('UX-2: a replay answer after a failed VOD load clears the outage card', async () => {
    const missing = {
      mode: 'vod',
      vodId: '2806037629',
      provisional: false,
      channelLogin: 'fixturechan',
      coverageStatus: 'missing',
      coverageMessage: 'No replay analytics have been indexed for this VOD yet.',
    } as ExtensionVodPulseResponse
    await settle(() => mountOverlay('__vod__:2806037629', null, VOD, { sessionOpenedAtMs: 1 }))
    await settle(() => {
      updateOverlayVodState({ vodPulse: null, loading: false })
      updateOverlayPayload(null, 'request_failed')
    })
    expect(panelText()).toContain("Can't reach StreamPulse")

    // Retry answers 200 "missing": the entry passes '' so the kept failure is cleared.
    await settle(() => {
      updateOverlayVodState({ vodPulse: missing, loading: false })
      updateOverlayPayload(null, '')
    })
    expect(panelText()).toContain('No replay analytics have been indexed for this VOD yet.')
    expect(panelText()).not.toContain("Can't reach StreamPulse")
  })
})
