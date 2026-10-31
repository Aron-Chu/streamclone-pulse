// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.twitch.tv/fixturechan"}
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PULSE_ROOT_HOST_ID,
  PULSE_TABS_HOST_ID,
  mountOverlay,
  unmountOverlay,
} from '../src/content/mount.tsx'
import type { PulsePayload } from '../src/shared/messages.ts'
import type { TwitchPageContext } from '../src/content/twitch.ts'
import type { SidebarSnapLayout } from '../src/content/twitchChat.ts'

/**
 * A channel with nothing to chart opens on Chat, but only for that visit: the
 * reader's saved CHAT/PULSE choice is never rewritten by the automatic switch.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const page = vi.hoisted(() => {
  const rect = (top: number, height: number) => ({ top, left: 1000, width: 340, height, right: 1340, bottom: top + height })
  return {
    live: false,
    // Twitch's chat column is on the page, so the panel snaps under the tabs.
    layout: { column: rect(50, 800), header: rect(50, 40), headerTabs: rect(55, 30), panel: rect(90, 700) },
  }
})

vi.mock('../src/content/twitchChat.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/content/twitchChat.ts')>()
  return {
    ...actual,
    observeChatSnapLayout: (cb: (layout: SidebarSnapLayout | null) => void) => {
      cb(page.layout)
      return () => {}
    },
  }
})

vi.mock('../src/content/twitch.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/content/twitch.ts')>()
  return { ...actual, detectTwitchChannelLive: () => page.live }
})

const channel = (login: string): TwitchPageContext => ({ kind: 'channel', login, vodId: null })

function payload(login: string, fields: Partial<PulsePayload>): PulsePayload {
  return {
    login,
    streamId: '',
    isLive: false,
    tracking: false,
    rosterEligible: true,
    rollups: [],
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
    ...fields,
  } as PulsePayload
}

let synced: Record<string, unknown> = {}
const syncSet = vi.fn(async (items: Record<string, unknown>) => {
  Object.assign(synced, items)
})

async function settle(run: () => void = () => {}): Promise<void> {
  await act(async () => {
    run()
    for (let i = 0; i < 4; i += 1) await new Promise(resolve => setTimeout(resolve, 0))
  })
}

/** What entry.ts does on a channel visit: mount loading, then the answer. */
async function visit(login: string, answer: PulsePayload, sessionOpenedAtMs: number): Promise<void> {
  await settle(() => mountOverlay(login, null, channel(login), { sessionOpenedAtMs }))
  await settle(() => mountOverlay(login, answer, channel(login), { sessionOpenedAtMs }))
}

function tab(label: 'Chat' | 'Pulse'): HTMLButtonElement {
  const shadow = document.getElementById(PULSE_TABS_HOST_ID)?.shadowRoot
  const button = [...(shadow?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])]
    .find(node => node.textContent?.trim() === label)
  if (!button) throw new Error(`no ${label} tab`)
  return button
}

function shownTab(): string {
  return tab('Chat').getAttribute('aria-selected') === 'true' ? 'chat' : 'pulse'
}

function panelHidden(): boolean {
  return document.getElementById(PULSE_ROOT_HOST_ID)?.getAttribute('aria-hidden') === 'true'
}

function savedTabWrites(): unknown[] {
  return syncSet.mock.calls.map(([items]) => items).filter(items => 'sidebarTab' in items).map(items => items.sidebarTab)
}

describe('content mount on a channel with nothing to chart', () => {
  beforeEach(() => {
    page.live = false
    synced = {}
    syncSet.mockClear()
    const sync = {
      get: vi.fn(async (keys?: string | string[] | null) => {
        if (keys == null) return { ...synced }
        const wanted = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys)
        return Object.fromEntries(wanted.filter(key => key in synced).map(key => [key, synced[key]]))
      }),
      set: syncSet,
      remove: vi.fn(async () => {}),
    }
    const local = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) }
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'test',
        getManifest: () => ({ version: '0.2.6' }),
        getURL: (path: string) => path,
        sendMessage: vi.fn(async () => ({ ok: false })),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      storage: { sync, local, session: local, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    })
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  })

  afterEach(async () => {
    await settle(() => unmountOverlay())
    vi.unstubAllGlobals()
  })

  it('shows Chat on a channel off the list without saving Chat as the reader’s tab', async () => {
    await visit('offlist', payload('offlist', { rosterEligible: false }), 1)

    expect(shownTab()).toBe('chat')
    expect(panelHidden()).toBe(true)
    expect(savedTabWrites()).toEqual([])

    // Clicking Chat, the tab already shown, is no new choice either.
    await settle(() => tab('Chat').click())
    expect(shownTab()).toBe('chat')
    expect(savedTabWrites()).toEqual([])

    // The next channel opens on the reader's own tab again.
    await visit('charted', payload('charted', { recap: null }), 2)
    expect(shownTab()).toBe('pulse')
    expect(panelHidden()).toBe(false)
    expect(savedTabWrites()).toEqual([])
  })

  it('keeps Pulse once the reader picks it on that channel', async () => {
    await visit('offlist', payload('offlist', { rosterEligible: false }), 1)
    expect(shownTab()).toBe('chat')

    await settle(() => tab('Pulse').click())
    expect(shownTab()).toBe('pulse')
    expect(panelHidden()).toBe(false)
    expect(savedTabWrites()).toEqual(['pulse'])

    // A later answer for the same visit does not switch the reader back.
    await settle(() => mountOverlay('offlist', payload('offlist', { rosterEligible: false, login: 'offlist' }), channel('offlist'), { sessionOpenedAtMs: 1 }))
    expect(shownTab()).toBe('pulse')
  })

  it('shows Chat on a live channel StreamPulse isn’t reading (coverage full)', async () => {
    page.live = true
    await visit('cappedlive', payload('cappedlive', { isLive: true, tracking: false, streamId: '320000000002' }), 1)
    expect(shownTab()).toBe('chat')
    expect(panelHidden()).toBe(true)
    expect(savedTabWrites()).toEqual([])
  })

  it('stays on Pulse for a channel with a chart, and for a saved Chat choice', async () => {
    page.live = true
    await visit('readlive', payload('readlive', { isLive: true, tracking: true, streamId: '320000000003' }), 1)
    expect(shownTab()).toBe('pulse')

    await settle(() => unmountOverlay())
    synced.sidebarTab = 'chat'
    await visit('readlive', payload('readlive', { isLive: true, tracking: true, streamId: '320000000003' }), 2)
    expect(shownTab()).toBe('chat')
    expect(savedTabWrites()).toEqual([])
  })
})
