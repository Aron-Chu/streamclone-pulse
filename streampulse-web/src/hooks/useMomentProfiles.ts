import { useEffect, useMemo, useState } from 'react'
import { getBackendUrl } from '../lib/apiClient'
import { loadNewsroomProfiles, newsroomProfileUrl } from '../lib/newsroomProfiles'
import { isPlausibleTwitchLogin, normalizeTwitchLogin } from '../lib/normalizeTwitchLogin'

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
  const [state, setState] = useState<{ key: string; profiles: Record<string, string> }>({ key, profiles: {} })
  useEffect(() => {
    const controller = new AbortController()
    setState({ key, profiles: {} })
    void loadNewsroomProfiles(logins, controller.signal, (login, url) => {
      const normalizedLogin = normalizeTwitchLogin(login)
      if (!isPlausibleTwitchLogin(normalizedLogin)) return
      if (!controller.signal.aborted) setState(previous => previous.key === key
        ? { key, profiles: { ...previous.profiles, [normalizedLogin]: url } } : previous)
    })
    return () => controller.abort()
    // The ordered, bounded login set and API origin are encoded in key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return useMemo(() => items.map(item => {
    const login = typeof item.login === 'string' ? normalizeTwitchLogin(item.login) : ''
    const url = newsroomProfileUrl(item.profileImageUrl) || (state.key === key && isPlausibleTwitchLogin(login) ? state.profiles[login] : undefined)
    return url === item.profileImageUrl ? item : { ...item, profileImageUrl: url }
  }), [items, state, key])
}
