// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.twitch.tv/fixturechan"}
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PULSE_ROOT_HOST_ID, mountOverlay, unmountOverlay } from '../src/content/mount.tsx'
import type { ExtensionCoverageTierResponse, PulsePayload } from '../src/shared/messages.ts'
import type { TwitchPageContext } from '../src/content/twitch.ts'

/**
 * Hosted backend, warming tier: StreamPulse has just started reading the
 * channel's chat and no minute is saved yet. The panel shows the warm-up card
 * tracked channels get, not "not tracked".
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CHANNEL: TwitchPageContext = { kind: 'channel', login: 'fixturechan', vodId: null }

async function settle(run: () => void = () => {}): Promise<void> {
  await act(async () => {
    run()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

function panelText(): string {
  return document.getElementById(PULSE_ROOT_HOST_ID)?.shadowRoot?.textContent ?? ''
}

function justStarted(tracking: boolean): PulsePayload {
  return {
    login: 'fixturechan',
    streamId: '320000000002',
    isLive: true,
    tracking,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    currentOffsetSeconds: 60,
    coverageStartOffsetSeconds: 0,
    top500Eligible: true,
    rosterEligible: true,
    rollups: [],
    peaks: [],
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
  } as PulsePayload
}

function tier(coverageTier: string): ExtensionCoverageTierResponse {
  return {
    login: 'fixturechan',
    coverageTier,
    hostedCap: { activeCount: 412, activeLimit: 500, activeAvailable: true },
  } as ExtensionCoverageTierResponse
}

describe('hosted warming channel', () => {
  beforeEach(() => {
    const storage = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) }
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'store-copy',
        getManifest: () => ({ version: '0.2.2' }),
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

  it('shows the warm-up card, not the not-tracked card', async () => {
    await settle(() => mountOverlay('fixturechan', justStarted(true), CHANNEL, {
      sessionOpenedAtMs: Date.now(),
      coverageTier: tier('warming'),
    }))
    const text = panelText()
    expect(text).toContain('Warming')
    expect(text).toContain('Chat is counted once a minute. The chart and Top Moments fill in on their own.')
    expect(text).toContain('0 / 5 minutes collected')
    expect(text).not.toContain('Not charted')
    expect(text).not.toContain('isn’t reading')
  })
})
