// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/ui/Overlay.tsx', () => ({ Overlay: () => null }))
vi.mock('../src/shared/extensionDiagnostics.ts', () => ({
  installContentDiagnosticsEmitters: vi.fn(),
}))
vi.mock('../src/ui/overlayTheme.ts', () => ({ applyAccentTheme: vi.fn() }))
vi.mock('../src/content/twitchChat.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/content/twitchChat.ts')>()
  return {
    ...actual,
    observeChatSnapLayout: vi.fn(() => () => {}),
  }
})
vi.mock('../src/shared/storage.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/shared/storage.ts')>()
  return {
    ...actual,
    getOverlayDisplayPreferences: vi.fn(async () => ({ placement: 'sidebar', mode: 'expanded' })),
    getSidebarTab: vi.fn(async () => 'pulse'),
    getThemePreference: vi.fn(async () => 'aurora'),
    getChatClosedPulseDockEnabled: vi.fn(async () => false),
  }
})

import {
  PULSE_ROOT_HOST_ID,
  PULSE_TABS_HOST_ID,
  ensureUniqueOverlayHosts,
  mountOverlay,
  unmountOverlay,
} from '../src/content/mount.tsx'

const context = { kind: 'channel', login: 'fixturechan', vodId: null } as const

describe('overlay host lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      storage: {
        onChanged: { addListener: vi.fn() },
      },
    })
  })

  afterEach(() => {
    unmountOverlay()
    document.documentElement.replaceChildren(document.head, document.body)
    vi.unstubAllGlobals()
  })

  it('recreates disconnected hosts from the active same-session mount state', async () => {
    mountOverlay('fixturechan', null, context)
    await Promise.resolve()

    const originalTabs = document.getElementById(PULSE_TABS_HOST_ID)
    const originalPanel = document.getElementById(PULSE_ROOT_HOST_ID)
    expect(originalTabs).not.toBeNull()
    expect(originalPanel).not.toBeNull()

    originalTabs?.remove()
    originalPanel?.remove()
    ensureUniqueOverlayHosts()

    const replacementTabs = document.getElementById(PULSE_TABS_HOST_ID)
    const replacementPanel = document.getElementById(PULSE_ROOT_HOST_ID)
    expect(replacementTabs).not.toBe(originalTabs)
    expect(replacementPanel).not.toBe(originalPanel)
    expect(replacementTabs?.isConnected).toBe(true)
    expect(replacementPanel?.isConnected).toBe(true)
  })

  it('purges duplicate hosts with exact-id selectors instead of a full document scan', async () => {
    mountOverlay('fixturechan', null, context)
    await Promise.resolve()

    for (const id of [PULSE_TABS_HOST_ID, PULSE_ROOT_HOST_ID]) {
      const duplicate = document.createElement('div')
      duplicate.id = id
      document.documentElement.appendChild(duplicate)
    }
    const querySelectorAll = vi.spyOn(document, 'querySelectorAll')

    ensureUniqueOverlayHosts()

    expect(document.querySelectorAll(`[id="${PULSE_TABS_HOST_ID}"]`)).toHaveLength(1)
    expect(document.querySelectorAll(`[id="${PULSE_ROOT_HOST_ID}"]`)).toHaveLength(1)
    expect(querySelectorAll).not.toHaveBeenCalledWith('*')
  })
})
