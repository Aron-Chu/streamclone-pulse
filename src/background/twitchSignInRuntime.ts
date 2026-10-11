import { TWITCH_SIGNIN_ENABLED } from '../shared/twitchSignIn.ts'
import { ACCOUNT_BACKEND_URL, accountRequestsAllowed, supporterAccount, twitchSignInMetaRecord } from './supporterAccountRuntime.ts'
import { TwitchSignIn, twitchSurface, type WebAuthFlowDetails } from './twitchSignIn.ts'

type IdentityApi = {
  launchWebAuthFlow?: (details: WebAuthFlowDetails) => Promise<string | undefined>
  getRedirectURL?: (path?: string) => string
}

// Firefox exposes the promise API on `browser`; Chromium on `chrome`. Firefox
// for Android has neither, and the options card then keeps the device code.
const identity: IdentityApi | undefined =
  (globalThis as { browser?: { identity?: IdentityApi } }).browser?.identity
  ?? (globalThis as { chrome?: { identity?: IdentityApi } }).chrome?.identity

const runtimeUrl = (() => { try { return chrome.runtime.getURL('') } catch { return '' } })()
const target = typeof __EXTENSION_TARGET__ !== 'undefined' ? __EXTENSION_TARGET__ : 'development'
const surface = twitchSurface(target, runtimeUrl, typeof navigator === 'undefined' ? '' : navigator.userAgent)

const PROFILE_KEY = 'pulseTwitchProfile'
let memoryProfile: unknown = null

export const twitchSignIn = new TwitchSignIn({
  enabled: TWITCH_SIGNIN_ENABLED,
  account: supporterAccount,
  fetch: (input, init) => fetch(input, init),
  launchWebAuthFlow: typeof identity?.launchWebAuthFlow === 'function' ? details => identity.launchWebAuthFlow!(details) : undefined,
  redirectUrl: typeof identity?.getRedirectURL === 'function' ? () => identity.getRedirectURL!() : undefined,
  surface,
  chromium: surface !== 'firefox' && !runtimeUrl.startsWith('moz-extension:'),
  // The same origin as the stored credential and its refresh: a development
  // build pinned to a local backend never signs in against production.
  apiOrigin: ACCOUNT_BACKEND_URL,
  hosted: accountRequestsAllowed,
  meta: twitchSignInMetaRecord,
  // Display name and avatar live for this browser session only: session
  // storage is memory-backed and, by default, closed to content scripts.
  profile: {
    read: async () => {
      const session = chrome.storage?.session
      if (!session) return memoryProfile
      return (await session.get(PROFILE_KEY))[PROFILE_KEY] ?? null
    },
    write: async value => {
      const session = chrome.storage?.session
      if (!session) { memoryProfile = value; return }
      if (value == null) await session.remove(PROFILE_KEY)
      else await session.set({ [PROFILE_KEY]: value })
    },
  },
})
