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
export const ALLOWED_PERMISSIONS = Object.freeze(['storage', 'scripting'])

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
  const permissions = [...ALLOWED_PERMISSIONS]
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
