import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('toolbar popup ownership', () => {
  it('contains status and navigation without becoming a third settings surface', () => {
    const source = readFileSync(new URL('../src/popup/popup.tsx', import.meta.url), 'utf8')

    expect(source).toContain('Open Twitch')
    expect(source).toContain('Open analytics hub')
    expect(source).toContain('openHubAnalytics(backendUrl)')
    expect(source).toContain('Open settings')
    expect(source).toContain("section: 'pulse'")
    expect(source).toContain('installedExtensionVersion')
    expect(source).not.toContain('getChatClosedPulseDockEnabled')
    expect(source).not.toContain('setChatClosedPulseDockEnabled')
    expect(source).not.toContain('Settings live in the Pulse sidebar')
  })

  it('reads channel data through the worker and never writes Twitch pages', () => {
    const source = readFileSync(new URL('../src/popup/popup.tsx', import.meta.url), 'utf8')

    expect(source).toContain("type: 'GET_PULSE'")
    // GET_PULSE without `watch` never starts tracking a channel from the popup.
    expect(source).not.toMatch(/watch:\s*true/)
    // The only page script reads the avatar Twitch already rendered.
    expect(source.match(/executeScript/g)).toHaveLength(1)
    expect(source).toContain('safeImageUrl(')
  })

  it('asks for My Moments only after checking the window is not private', () => {
    const source = readFileSync(new URL('../src/popup/popup.tsx', import.meta.url), 'utf8')
    const guard = source.indexOf('if (popupShowsDeviceHistory(next, await popupWindowIncognito(tab)))')
    const request = source.indexOf("type: 'MY_MOMENTS', action: 'recent'")

    expect(guard).toBeGreaterThanOrEqual(0)
    expect(request).toBeGreaterThan(guard)
    // The guarded request is the popup's only My Moments read.
    expect(source.match(/type: 'MY_MOMENTS'/g)).toHaveLength(1)
    expect(source).toContain('chrome.windows.getCurrent()')
  })

  it('loads its own stylesheet before mounting the popup', () => {
    const source = readFileSync(new URL('../src/popup/popup.tsx', import.meta.url), 'utf8')
    const styleInit = source.indexOf('styleElement.textContent = popupStyles')
    const mount = source.indexOf("createRoot(document.getElementById('root')")

    expect(source).toContain("import { popupStyles } from './popupStyles.ts'")
    expect(styleInit).toBeGreaterThanOrEqual(0)
    expect(mount).toBeGreaterThan(styleInit)
  })
})
