import { useEffect, useState } from 'react'
import { resolveTwitchRoute, type PulseExtensionMode } from '../routing/twitchRoute.ts'

export function useTwitchRouteMode(getUrl: () => string = () => window.location.href): PulseExtensionMode {
  const [mode, setMode] = useState<PulseExtensionMode>(() => resolveTwitchRoute(getUrl()))

  useEffect(() => {
    const sync = () => setMode(resolveTwitchRoute(getUrl()))
    sync()
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [getUrl])

  return mode
}
