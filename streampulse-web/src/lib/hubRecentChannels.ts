import { isPlausibleTwitchLogin, normalizeTwitchLogin } from './normalizeTwitchLogin'

export const HUB_RECENT_LOGINS_KEY = 'sp.hub.recentLogins'
export const HUB_RECENT_LOGINS_MAX = 8

export interface HubRecentLogin {
  login: string
  openedAt: string
}

function readRaw(): HubRecentLogin[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(HUB_RECENT_LOGINS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => {
        if (typeof entry !== 'object' || entry === null) return null
        const login = typeof (entry as HubRecentLogin).login === 'string' ? (entry as HubRecentLogin).login : ''
        const openedAt =
          typeof (entry as HubRecentLogin).openedAt === 'string' ? (entry as HubRecentLogin).openedAt : ''
        const normalized = normalizeTwitchLogin(login)
        if (!isPlausibleTwitchLogin(normalized) || !openedAt) return null
        return { login: normalized, openedAt }
      })
      .filter((entry): entry is HubRecentLogin => entry !== null)
  } catch {
    return []
  }
}

function writeRaw(entries: HubRecentLogin[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(HUB_RECENT_LOGINS_KEY, JSON.stringify(entries.slice(0, HUB_RECENT_LOGINS_MAX)))
}

export function readHubRecentLogins(): HubRecentLogin[] {
  return readRaw()
}

export function recordHubRecentLogin(rawLogin: string, openedAt = new Date().toISOString()): HubRecentLogin[] {
  const login = normalizeTwitchLogin(rawLogin)
  if (!isPlausibleTwitchLogin(login)) return readRaw()

  const without = readRaw().filter((entry) => entry.login !== login)
  const next: HubRecentLogin[] = [{ login, openedAt }, ...without].slice(0, HUB_RECENT_LOGINS_MAX)
  writeRaw(next)
  return next
}

export function clearHubRecentLogins(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(HUB_RECENT_LOGINS_KEY)
}
