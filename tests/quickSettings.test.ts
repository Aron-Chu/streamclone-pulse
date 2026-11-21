import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QUICK_SETTINGS_SCRIPT_FILE, injectQuickSettings } from '../src/background/quickSettingsScript.ts'
import { MESSAGE_SENDER_SCOPE } from '../src/background/pulseBroadcastTargets.ts'
import { sendBackgroundMessage } from '../src/content/bridge.ts'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'
import {
  QUICK_SETTINGS_SHARED_MODULES,
  QUICK_SETTINGS_SHARED_PACKAGES,
  type QuickSettingsPanel,
} from '../src/shared/quickSettingsContract.ts'
import * as banner from '../src/ui/PulseBanner.tsx'
import { useSupporterAppearanceDetails } from '../src/ui/useSupporterAppearance.ts'
import { contentScriptModules } from './helpers/contentGraph.ts'

vi.mock('../src/content/bridge.ts', () => ({
  sendBackgroundMessage: vi.fn(async () => ({ ok: false })),
}))

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tab = { id: 42 } as chrome.tabs.Tab
const contractKeys = [
  ...Object.values(QUICK_SETTINGS_SHARED_PACKAGES),
  ...Object.values(QUICK_SETTINGS_SHARED_MODULES).flatMap(exports => Object.values(exports)),
].sort()

/** A fresh copy of the loader, so each test starts with nothing asked for yet. */
async function freshLoader() {
  vi.resetModules()
  return import('../src/ui/quickSettings.ts')
}

afterEach(() => {
  delete globalThis.__pulseQuickSettings
  delete globalThis.__pulseQuickSettingsHost
  vi.mocked(sendBackgroundMessage).mockReset()
  vi.mocked(sendBackgroundMessage).mockImplementation(async () => ({ ok: false }) as never)
})

describe('Quick settings script', () => {
  it('injects the fixed script into the sender’s tab and frame, in the isolated world', async () => {
    const executeScript = vi.fn().mockResolvedValue([])
    expect(await injectQuickSettings({ executeScript }, { id: 'ext', frameId: 3, tab })).toBe(true)
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 42, frameIds: [3] }, world: 'ISOLATED', files: ['content/quick-settings.js'] })
    expect(QUICK_SETTINGS_SCRIPT_FILE).toBe('content/quick-settings.js')
  })

  it('injects nothing without a tab, and reports a failed injection instead of throwing', async () => {
    const executeScript = vi.fn().mockRejectedValue(new Error('Cannot access contents of the page'))
    expect(await injectQuickSettings({ executeScript }, { id: 'ext' })).toBe(false)
    expect(executeScript).not.toHaveBeenCalled()
    expect(await injectQuickSettings({ executeScript }, { id: 'ext', frameId: 0, tab })).toBe(false)
  })

  it('takes no file, tab or frame from the caller', () => {
    expect(parseBackgroundRequest({ type: 'QUICK_SETTINGS_SCRIPT' })).toEqual({ type: 'QUICK_SETTINGS_SCRIPT' })
    for (const extra of [{ files: ['evil.js'] }, { tabId: 1 }, { frameId: 3 }, { world: 'MAIN' }]) {
      expect(parseBackgroundRequest({ type: 'QUICK_SETTINGS_SCRIPT', ...extra })).toBeNull()
    }
    expect(MESSAGE_SENDER_SCOPE.QUICK_SETTINGS_SCRIPT).toBe('twitch-any')
  })
})

describe('Quick settings host', () => {
  it('hands over exactly what the contract lists, from the content script’s own modules', async () => {
    const { quickSettingsHost } = await import('../src/ui/quickSettings.ts')
    const host = quickSettingsHost()
    expect(Object.keys(host).sort()).toEqual(contractKeys)
    expect(host.react).toBe(react)
    expect(host.jsx).toBe(jsx)
    expect(host.send).toBe(sendBackgroundMessage)
    expect(host.appearance).toBe(useSupporterAppearanceDetails)
    expect(host.banner).toBe(banner.usePulseBanner)
    expect(host.backdrop).toBe(banner.PulseBannerBackdrop)
    expect(host.bannerError).toBe(banner.PulseBannerLoadError)
  })
})

describe('Quick settings loader', () => {
  const panel = (() => null) as unknown as QuickSettingsPanel

  it('returns a registered view without asking the worker', async () => {
    const { loadQuickSettings } = await freshLoader()
    globalThis.__pulseQuickSettings = panel
    expect(await loadQuickSettings()).toBe(panel)
    expect(sendBackgroundMessage).not.toHaveBeenCalled()
  })

  it('hands the host over before it asks, and asks once however often it is called', async () => {
    const { loadQuickSettings } = await freshLoader()
    vi.mocked(sendBackgroundMessage).mockImplementation(async () => {
      expect(globalThis.__pulseQuickSettingsHost).toBeDefined()
      globalThis.__pulseQuickSettings = panel
      return { type: 'QUICK_SETTINGS_SCRIPT', ok: true }
    })
    const [first, second] = await Promise.all([loadQuickSettings(), loadQuickSettings()])
    expect(first).toBe(panel)
    expect(second).toBe(panel)
    expect(sendBackgroundMessage).toHaveBeenCalledTimes(1)
    expect(sendBackgroundMessage).toHaveBeenCalledWith({ type: 'QUICK_SETTINGS_SCRIPT' })
  })

  it('reports a failed load as null and asks again next time', async () => {
    const { loadQuickSettings } = await freshLoader()
    vi.mocked(sendBackgroundMessage).mockRejectedValueOnce(new Error('Extension context invalidated.'))
    expect(await loadQuickSettings()).toBeNull()
    vi.mocked(sendBackgroundMessage).mockResolvedValueOnce({ type: 'QUICK_SETTINGS_SCRIPT', ok: false })
    expect(await loadQuickSettings()).toBeNull()
    vi.mocked(sendBackgroundMessage).mockImplementationOnce(async () => {
      globalThis.__pulseQuickSettings = panel
      return { type: 'QUICK_SETTINGS_SCRIPT', ok: true }
    })
    expect(await loadQuickSettings()).toBe(panel)
    expect(sendBackgroundMessage).toHaveBeenCalledTimes(3)
  })
})

describe('Quick settings stays out of the Twitch content script', () => {
  it('the content script reaches the view only through the injected script', () => {
    const graph = contentScriptModules()
    expect(graph).toContain('src/ui/quickSettings.ts')
    expect(graph).toContain('src/ui/OpenAllSettingsButton.tsx')
    expect(graph.filter(file => file === 'src/ui/PulseSettingsPanel.tsx' || file === 'src/content/quickSettings.ts')).toEqual([])
  })

  it('in a build, quick-settings.js carries the view and takes React and shared state from twitch.js', () => {
    const contentBundle = resolve(root, 'dist/content/twitch.js')
    // Unit tests run before `npm run build` in CI; with no build there is nothing to inspect.
    if (!existsSync(contentBundle)) return
    const viewBundle = resolve(root, 'dist/content/quick-settings.js')
    expect(existsSync(viewBundle), 'dist/content/quick-settings.js is missing from a build that has twitch.js').toBe(true)
    const content = readFileSync(contentBundle, 'utf8')
    const view = readFileSync(viewBundle, 'utf8')
    for (const marker of ['Close settings', 'Extension preferences', 'Docking needs Sidebar placement', 'Explore Supporter', 'SUPPORTER_CARD_SCRIPT']) {
      expect(content.includes(marker), `twitch.js must not contain ${marker}`).toBe(false)
      expect(view.includes(marker), `quick-settings.js must contain ${marker}`).toBe(true)
    }
    expect(content).toContain('QUICK_SETTINGS_SCRIPT')
    expect(content).toContain('__pulseQuickSettingsHost')
    expect(view).toContain('__pulseQuickSettings')
    // One React and one bridge: the script reads them from the host, never bundles its own.
    for (const copy of ['react.transitional.element', '__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE', 'Receiving end does not exist']) {
      expect(view.includes(copy), `quick-settings.js must not bundle ${copy}`).toBe(false)
    }
    const reads = [...new Set([...view.matchAll(/__pulseQuickSettingsHost\.(\w+)/g)].map(match => match[1]))].sort()
    expect(reads).toEqual(contractKeys)
    // Self-contained otherwise: no imports or chunk loads.
    expect(view).not.toMatch(/\bimport\s*\(|\bfrom\s*['"]|chunks\//)
  })
})
