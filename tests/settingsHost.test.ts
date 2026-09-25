import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { openSettingsHost } from '../src/background/settingsHost.ts'

describe('settings host navigation', () => {
  it('keeps the full-page Supporter banner styles out of the Twitch content bundle', () => {
    const hostStyles = readFileSync(new URL('../src/options/hostStyles.ts', import.meta.url), 'utf8')
    const sharedStyles = readFileSync(new URL('../src/ui/theme.ts', import.meta.url), 'utf8')
    expect(hostStyles).toContain('.pulse-settings-supporter-banner')
    expect(sharedStyles).not.toContain('.pulse-settings-supporter-banner')
  })

  it('always opens the packaged extension-owned host', async () => {
    const create = vi.fn(async () => undefined)
    await openSettingsHost({ create }, path => `chrome-extension://id/${path}`)
    expect(create).toHaveBeenCalledWith({ url: 'chrome-extension://id/options/index.html#pulse' })
  })

  it('deep-links only to a typed settings section', async () => {
    const create = vi.fn(async () => undefined)
    await openSettingsHost({ create }, path => `chrome-extension://id/${path}`, 'updates')
    expect(create).toHaveBeenCalledWith({ url: 'chrome-extension://id/options/index.html#updates' })
  })
})
