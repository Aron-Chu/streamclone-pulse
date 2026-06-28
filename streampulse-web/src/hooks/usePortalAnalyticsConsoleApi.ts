import { useEffect } from 'react'
import { configureAnalyticsApi, configureEmoteAssetBase } from '@streamclone/analytics-console'
import { getBackendUrl } from '../lib/apiClient'
import { createPortalAnalyticsApi } from '../lib/streamcloneAnalytics'

let configured = false

/** Wire Streamclone analytics console to portal-safe API paths once per session. */
export function usePortalAnalyticsConsoleApi(): void {
  useEffect(() => {
    if (configured) return
    configureAnalyticsApi(createPortalAnalyticsApi())
    configureEmoteAssetBase(() => getBackendUrl())
    configured = true
  }, [])
}
