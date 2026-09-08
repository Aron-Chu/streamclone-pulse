import { useEffect, useMemo, useState } from 'react'
import { getBackendUrl } from '../lib/momentsApiClient'
import { getCachedNewsroomProfile, loadNewsroomProfiles, newsroomProfileUrl } from '../lib/newsroomProfiles'
import { isPlausibleTwitchLogin, normalizeTwitchLogin } from '../lib/normalizeTwitchLogin'

function hydrateFromCache(logins: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const login of logins) {
    const cached = getCachedNewsroomProfile(login)
    if (cached) result[login] = cached
  }
  return result
}

/** Cosmetic identity only. Bounded requests reuse the existing exact-login cache. */
export function useMomentProfiles<T extends { login?: string; profileImageUrl?: string }>(items: readonly T[]): T[] {
  const chosenLogins = new Set<string>()
  for (const item of items) {
    if (chosenLogins.size >= 20) break
    if (newsroomProfileUrl(item.profileImageUrl) || typeof item.login !== 'string') continue
    const login = normalizeTwitchLogin(item.login)
    if (isPlausibleTwitchLogin(login)) chosenLogins.add(login)
  }
  const logins = [...chosenLogins].sort()
  const key = JSON.stringify([getBackendUrl(), logins])
  const [state, setState] = useState<{ key: string; profiles: Record<string, string> }>(() => ({
    key,
    profiles: hydrateFromCache(logins),
  }))
  useEffect(() => {
    const controller = new AbortController()
    setState(previous => ({
      key,
      profiles: { ...previous.profiles, ...hydrateFromCache(logins) },
    }))
    void loadNewsroomProfiles(logins, controller.signal, (login, url) => {
      const normalizedLogin = normalizeTwitchLogin(login)
      if (!isPlausibleTwitchLogin(normalizedLogin)) return
      if (!controller.signal.aborted) setState(previous => ({
        ...previous,
        profiles: { ...previous.profiles, [normalizedLogin]: url },
      }))
    })
    return () => controller.abort()
    // The ordered, bounded login set and API origin are encoded in key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return useMemo(() => items.map(item => {
    const login = typeof item.login === 'string' ? normalizeTwitchLogin(item.login) : ''
    const url = newsroomProfileUrl(item.profileImageUrl) || (isPlausibleTwitchLogin(login) ? (state.profiles[login] ?? getCachedNewsroomProfile(login)) : undefined)
    return url === item.profileImageUrl ? item : { ...item, profileImageUrl: url }
  }), [items, state.profiles, key])
}
