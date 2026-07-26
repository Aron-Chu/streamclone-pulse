import { useCallback, useEffect, useState } from 'react'
import { type HubRecentLogin, readHubRecentLogins } from '../lib/hubRecentChannels'

export function useHubRecentLogins(): HubRecentLogin[] {
  const [recent, setRecent] = useState<HubRecentLogin[]>(() => readHubRecentLogins())

  const refresh = useCallback(() => {
    setRecent(readHubRecentLogins())
  }, [])

  useEffect(() => {
    refresh()
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'sp.hub.recentLogins') refresh()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', refresh)
    }
  }, [refresh])

  return recent
}
