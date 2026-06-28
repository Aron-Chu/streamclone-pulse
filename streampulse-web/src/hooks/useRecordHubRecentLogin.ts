import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { isPlausibleTwitchLogin, normalizeTwitchLogin } from '../lib/normalizeTwitchLogin'
import { recordHubRecentLogin } from '../lib/hubRecentChannels'

/** Persist channel login when user opens analytics console routes. */
export function useRecordHubRecentLogin(): void {
  const { login = '' } = useParams<{ login: string }>()

  useEffect(() => {
    const normalized = normalizeTwitchLogin(login)
    if (!isPlausibleTwitchLogin(normalized)) return
    recordHubRecentLogin(normalized)
  }, [login])
}
