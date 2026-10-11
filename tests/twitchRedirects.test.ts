import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SIGN_IN_PUBLIC_TARGETS } from '../scripts/extension-permission-allowlists.mjs'
import { CWS_EXTENSION_ID, FIREFOX_ADDON_ID, STORE_TWITCH_REDIRECTS, chromiumRedirect, firefoxRedirect } from '../scripts/twitch-signin-redirects.mjs'
import { twitchSurface } from '../src/background/twitchSignIn.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const doc = readFileSync(join(root, 'docs/pulse-extension/twitch-signin-redirects.md'), 'utf8')

// The backend validates these shapes (config/twitch_signin.go).
const CHROMIUM_REDIRECT = /^https:\/\/[a-p]{32}\.chromiumapp\.org\/$/
const FIREFOX_REDIRECT = /^https:\/\/[0-9a-f]{40}\.extensions\.allizom\.org\/$/

describe('Continue with Twitch redirect URLs per store build', () => {
  it('derives the Firefox redirect from the add-on ID in the Firefox manifest', () => {
    const firefox = JSON.parse(readFileSync(join(root, 'manifests/firefox.json'), 'utf8')) as { browser_specific_settings: { gecko: { id: string } } }
    expect(firefox.browser_specific_settings.gecko.id).toBe(FIREFOX_ADDON_ID)
    // SHA-1 of streampulse@streampulse.stream, computed 2026-10-10. A changed
    // add-on ID breaks this, the doc below and the Twitch app registration.
    expect(firefoxRedirect(FIREFOX_ADDON_ID)).toBe('https://860ca1e7899dd7ffac987c1ad8e29ba473fa0614.extensions.allizom.org/')
    expect(STORE_TWITCH_REDIRECTS.firefox.redirect).toMatch(FIREFOX_REDIRECT)
  })

  it('uses the Chrome Web Store listing ID for the CWS build and has no Edge redirect until its listing ID exists', () => {
    expect(STORE_TWITCH_REDIRECTS.cws.redirect).toBe(`https://${CWS_EXTENSION_ID}.chromiumapp.org/`)
    expect(STORE_TWITCH_REDIRECTS.cws.redirect).toMatch(CHROMIUM_REDIRECT)
    expect(STORE_TWITCH_REDIRECTS.edge.redirect).toBeNull()
    expect(() => chromiumRedirect('not-an-id')).toThrow(/not a Chromium extension ID/)
  })

  it('sends the surface the backend keys its redirect list by', () => {
    for (const [target, { surface }] of Object.entries(STORE_TWITCH_REDIRECTS)) {
      expect(twitchSurface(target, target === 'firefox' ? 'moz-extension://x/' : 'chrome-extension://x/', '')).toBe(surface)
    }
  })

  it('lets a store ship sign-in only once its redirect exists', () => {
    for (const target of SIGN_IN_PUBLIC_TARGETS) {
      expect(STORE_TWITCH_REDIRECTS[target as keyof typeof STORE_TWITCH_REDIRECTS]?.redirect).toBeTruthy()
    }
  })

  it('documents every redirect the owner registers, with the matching backend entry', () => {
    for (const { surface, redirect } of Object.values(STORE_TWITCH_REDIRECTS)) {
      if (!redirect) continue
      expect(doc).toContain(redirect)
      expect(doc).toContain(`${surface}=${redirect}`)
    }
    expect(doc).toContain('https://streampulse.stream/account/twitch/callback')
  })
})
