import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('toolbar popup ownership', () => {
  it('contains status and navigation without becoming a third settings surface', () => {
    const source = readFileSync(new URL('../src/popup/popup.tsx', import.meta.url), 'utf8')

    expect(source).toContain('Open Twitch')
    expect(source).toContain('Analytics hub')
    expect(source).toContain('Open settings')
    expect(source).toContain("section: 'pulse'")
    expect(source).toContain('installedExtensionVersion')
    expect(source).not.toContain('getChatClosedPulseDockEnabled')
    expect(source).not.toContain('setChatClosedPulseDockEnabled')
    expect(source).not.toContain('Settings live in the Pulse sidebar')
  })

  it('loads shared interaction and motion styles before mounting the popup', () => {
    const source = readFileSync(new URL('../src/popup/popup.tsx', import.meta.url), 'utf8')
    const styleInit = source.indexOf('injectStyles()')
    const mount = source.indexOf("createRoot(document.getElementById('root')")

    expect(source).toContain("import { injectStyles, theme } from '../ui/theme.ts'")
    expect(styleInit).toBeGreaterThanOrEqual(0)
    expect(mount).toBeGreaterThan(styleInit)
  })
})
