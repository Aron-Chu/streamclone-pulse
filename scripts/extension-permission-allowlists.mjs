/**
 * Exact per-target permission allowlists for extension packaging validation.
 *
 * gql.twitch.tv: REMOVED from extension host_permissions. Twitch GQL discovery
 * runs via chrome.scripting.executeScript in the Twitch page MAIN world
 * (see src/background/twitchPageInject.ts). MAIN-world fetch uses the page
 * network context and does not require an extension host grant.
 */
export const ALLOWED_PERMISSIONS = Object.freeze(['storage', 'scripting'])

export const ALLOWED_HOST_PERMISSIONS_STORE = Object.freeze([
  'https://api.streampulse.stream/*',
  'https://cdn.7tv.app/*',
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
