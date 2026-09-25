/** System routes (including the separate, unadopted Explorer) are not logins. */
const RESERVED = new Set(['hub', 'emotes', 'streams', 'newsroom', 'explore', 'admin', 'settings', 'login', 'setup', 'docs', 'status', 'privacy', 'support'])
export function isChannelRouteLogin(value: string): boolean {
  return /^[a-z0-9_]{1,25}$/i.test(value) && !RESERVED.has(value.toLowerCase())
}
