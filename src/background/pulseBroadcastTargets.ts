/** True when a Twitch tab URL is for this channel (multi-tab same login still matches). */
export function tabUrlMatchesPulseLogin(url: string | undefined, login: string): boolean {
  if (!url || !login) return false
  try {
    const { pathname } = new URL(url)
    const path = pathname.toLowerCase()
    const needle = `/${login.trim().toLowerCase()}`
    return path === needle || path.startsWith(`${needle}/`)
  } catch {
    return false
  }
}
