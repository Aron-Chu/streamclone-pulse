import { createHash } from 'node:crypto'

/**
 * Continue with Twitch redirect URLs per store build: what
 * `identity.getRedirectURL()` returns at runtime, which the owner registers on
 * the StreamPulseProd Twitch app and lists in the backend's
 * PULSE_TWITCH_SIGNIN_REDIRECTS (surface=url). See
 * docs/pulse-extension/twitch-signin-redirects.md.
 *
 *   - Chromium builds: https://<extension id>.chromiumapp.org/
 *   - Firefox: https://<sha1 of the add-on id>.extensions.allizom.org/ (Twitch
 *     needs https, so never the http://127.0.0.1/mozoauth2 loopback form)
 *
 * `null` means the listing ID does not exist yet: that store cannot ship
 * sign-in (tests/twitchRedirects.test.ts refuses it in SIGN_IN_PUBLIC_TARGETS).
 */
export const CWS_EXTENSION_ID = 'nifgoonpcgmdhiffcpmhndjgkgahnelg'
export const FIREFOX_ADDON_ID = 'streampulse@streampulse.stream'
/** Partner Center → Extension overview → Extension identity, after the first package upload. */
export const EDGE_EXTENSION_ID = null

export function chromiumRedirect(extensionId) {
  if (!/^[a-p]{32}$/.test(String(extensionId))) throw new Error(`not a Chromium extension ID: ${JSON.stringify(extensionId)}`)
  return `https://${extensionId}.chromiumapp.org/`
}

export function firefoxRedirect(addonId) {
  return `https://${createHash('sha1').update(String(addonId)).digest('hex')}.extensions.allizom.org/`
}

/** The worker's `surface` for each store build, and its redirect (null until it exists). */
export const STORE_TWITCH_REDIRECTS = Object.freeze({
  cws: Object.freeze({ surface: 'chrome', redirect: chromiumRedirect(CWS_EXTENSION_ID) }),
  edge: Object.freeze({ surface: 'edge', redirect: EDGE_EXTENSION_ID ? chromiumRedirect(EDGE_EXTENSION_ID) : null }),
  firefox: Object.freeze({ surface: 'firefox', redirect: firefoxRedirect(FIREFOX_ADDON_ID) }),
})
