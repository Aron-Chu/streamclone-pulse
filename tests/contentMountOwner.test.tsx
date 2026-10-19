// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.twitch.tv/fixturechan"}
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PULSE_ROOT_HOST_ID,
  PULSE_TABS_HOST_ID,
  ensureUniqueOverlayHosts,
  mountOverlay,
  unmountOverlay,
  updateOverlayContext,
  updateOverlayVodState,
} from '../src/content/mount.tsx'
import { TWITCH_SIDEBAR_HIDE_STYLE_ID } from '../src/content/twitchSidebarChrome.ts'
import type { TwitchPageContext } from '../src/content/twitch.ts'

/**
 * Two StreamPulse installs in one browser (a store copy beside an unpacked
 * one) run two content scripts against the same Twitch page and share the
 * host ids. Each host carries its install's extension id; the first copy keeps
 * the page and the second leaves it alone instead of purging it.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CHANNEL: TwitchPageContext = { kind: 'channel', login: 'fixturechan', vodId: null }
const THIS_INSTALL = 'unpacked-copy'
const OTHER_INSTALL = 'store-copy'

async function settle(run: () => void = () => {}): Promise<void> {
  await act(async () => {
    run()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

function hosts(id: string): HTMLElement[] {
  return Array.from(document.documentElement.children).filter(node => node.id === id) as HTMLElement[]
}

/** The first install's tab row, panel and Twitch chat hide style, already on the page. */
function addOtherInstallPanel(): { tabs: HTMLElement; panel: HTMLElement; hideStyle: HTMLStyleElement } {
  const make = (id: string) => {
    const host = document.createElement('div')
    host.id = id
    host.dataset.streampulseOwner = OTHER_INSTALL
    document.documentElement.append(host)
    return host
  }
  const hideStyle = document.createElement('style')
  hideStyle.id = TWITCH_SIDEBAR_HIDE_STYLE_ID
  document.head.append(hideStyle)
  return { tabs: make(PULSE_TABS_HOST_ID), panel: make(PULSE_ROOT_HOST_ID), hideStyle }
}

describe('content mount with a second StreamPulse install', () => {
  beforeEach(() => {
    const storage = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) }
    vi.stubGlobal('chrome', {
      runtime: {
        id: THIS_INSTALL,
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
    for (const id of [PULSE_TABS_HOST_ID, PULSE_ROOT_HOST_ID]) for (const host of hosts(id)) host.remove()
    document.getElementById(TWITCH_SIDEBAR_HIDE_STYLE_ID)?.remove()
    vi.unstubAllGlobals()
  })

  it('leaves the first copy’s panel and chat hide style alone and stays off the page', async () => {
    const other = addOtherInstallPanel()
    await settle(() => mountOverlay('fixturechan', null, CHANNEL, { sessionOpenedAtMs: 1 }))
    await settle(() => {
      updateOverlayContext(CHANNEL)
      updateOverlayVodState({ loading: false })
      ensureUniqueOverlayHosts()
    })
    expect(hosts(PULSE_TABS_HOST_ID)).toEqual([other.tabs])
    expect(hosts(PULSE_ROOT_HOST_ID)).toEqual([other.panel])
    expect(other.hideStyle.isConnected).toBe(true)

    // Leaving the channel does not take the first copy's panel or hide style with it.
    await settle(() => unmountOverlay())
    expect(hosts(PULSE_TABS_HOST_ID)).toEqual([other.tabs])
    expect(hosts(PULSE_ROOT_HOST_ID)).toEqual([other.panel])
    expect(other.hideStyle.isConnected).toBe(true)
  })

  it('takes the page once the first copy’s panel has left', async () => {
    const other = addOtherInstallPanel()
    await settle(() => mountOverlay('fixturechan', null, CHANNEL, { sessionOpenedAtMs: 1 }))
    other.tabs.remove()
    other.panel.remove()
    await settle(() => mountOverlay('fixturechan', null, CHANNEL, { sessionOpenedAtMs: 1 }))
    const [panel] = hosts(PULSE_ROOT_HOST_ID)
    expect(hosts(PULSE_ROOT_HOST_ID)).toHaveLength(1)
    expect(hosts(PULSE_TABS_HOST_ID)).toHaveLength(1)
    expect(panel.dataset.streampulseOwner).toBe(THIS_INSTALL)
    expect(panel.shadowRoot?.textContent).toContain('Loading Pulse')
  })

  it('still purges its own duplicates and unstamped leftovers, but not another install’s host', async () => {
    await settle(() => mountOverlay('fixturechan', null, CHANNEL, { sessionOpenedAtMs: 1 }))
    const [own] = hosts(PULSE_ROOT_HOST_ID)
    expect(own.dataset.streampulseOwner).toBe(THIS_INSTALL)
    const leftover = (owner?: string) => {
      const host = document.createElement('div')
      host.id = PULSE_ROOT_HOST_ID
      if (owner) host.dataset.streampulseOwner = owner
      document.documentElement.append(host)
      return host
    }
    const sameInstall = leftover(THIS_INSTALL)
    const unstamped = leftover()
    const otherInstall = leftover(OTHER_INSTALL)
    await settle(() => ensureUniqueOverlayHosts())
    expect(sameInstall.isConnected).toBe(false)
    expect(unstamped.isConnected).toBe(false)
    expect(hosts(PULSE_ROOT_HOST_ID)).toEqual([own, otherInstall])
  })
})
