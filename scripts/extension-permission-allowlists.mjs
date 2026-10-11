/**
 * Exact per-target permission allowlists for extension packaging validation.
 *
 * Twitch host grant: `https://*.twitch.tv/*` is retained so MV3
 * chrome.scripting.executeScript can target Twitch channel/VOD pages
 * (www, m, clips, and related subdomains). That wildcard also covers
 * gql.twitch.tv for extension-origin network access, but StreamPulse does
 * not declare a separate `https://gql.twitch.tv/*` entry and does not fetch
 * GQL from the extension origin — discovery runs in page MAIN world
 * (see src/background/twitchPageInject.ts) using the page network context.
 *
 * Narrowing to `https://www.twitch.tv/*` alone would drop content-script /
 * scripting coverage for non-www Twitch hosts used by channel and mobile
 * surfaces; keep the wildcard until product confirms www-only injection.
 */
/**
 * Base permissions for every target. `identity` is added per store target, and
 * only for the targets listed in SIGN_IN_PUBLIC_TARGETS: store review rejects a
 * permission the package never uses, and a store build's Twitch sign-in stage
 * is derived from its manifest (identity means public; see
 * resolveTwitchSignInStage in extension-target.mjs). Never `identity.email`.
 */
export const ALLOWED_PERMISSIONS = Object.freeze(['storage', 'scripting'])

/**
 * Store targets that ship Continue with Twitch (their manifest requests
 * `identity`). Empty until the release commit that turns sign-in on: that
 * commit adds the target here, adds `identity` to its manifest and updates
 * docs/pulse-extension/store-permission-change-0.2.3.md and the CWS review
 * checklist. Edge joins only once its Add-ons listing ID is registered as a
 * Twitch redirect (see docs/pulse-extension/twitch-signin-redirects.md).
 */
/** @type {readonly string[]} */
export const SIGN_IN_PUBLIC_TARGETS = Object.freeze([])

export const ALLOWED_HOST_PERMISSIONS_STORE = Object.freeze([
  'https://api.streampulse.stream/*',
  'https://cdn.7tv.app/*',
  'https://cdn.betterttv.net/*',
  'https://cdn.streampulse.stream/*',
  'https://static-cdn.jtvnw.net/*',
  'https://cdn.frankerfacez.com/*',
  'https://*.twitch.tv/*',
])

export const ALLOWED_OPTIONAL_HOST_PERMISSIONS_DEVELOPMENT = Object.freeze([
  'http://localhost:8081/*',
  'http://127.0.0.1:8081/*',
])

export function permissionAllowlistForTarget(target) {
  const permissions = [...ALLOWED_PERMISSIONS, ...(SIGN_IN_PUBLIC_TARGETS.includes(target) ? ['identity'] : [])]
  const host_permissions = [...ALLOWED_HOST_PERMISSIONS_STORE]
  const optional_host_permissions =
    target === 'development' ? [...ALLOWED_OPTIONAL_HOST_PERMISSIONS_DEVELOPMENT] : []
  return { permissions, host_permissions, optional_host_permissions }
}

/** Exact set equality (order-sensitive for stable manifests). */
export function assertExactStringList(actual, expected, label) {
  const a = actual ?? []
  const e = expected ?? []
  const errors = []
  if (a.length !== e.length) {
    errors.push(`${label}: length ${a.length} != ${e.length}`)
  }
  for (let i = 0; i < Math.max(a.length, e.length); i++) {
    if (a[i] !== e[i]) {
      errors.push(`${label}[${i}]: got ${JSON.stringify(a[i])} expected ${JSON.stringify(e[i])}`)
    }
  }
  for (const item of a) {
    if (!e.includes(item)) errors.push(`${label}: unexpected ${JSON.stringify(item)}`)
  }
  for (const item of e) {
    if (!a.includes(item)) errors.push(`${label}: missing ${JSON.stringify(item)}`)
  }
  return errors
}
