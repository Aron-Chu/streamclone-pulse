import { useEffect, useState } from 'react'
import { defaultWebAnalyticsBaseUrlForApi } from '../shared/analyticsLinks.ts'
import { CANONICAL_PORTAL_ORIGIN } from '../shared/portalLinks.ts'
import { getBackendUrl } from '../shared/storage.ts'

/**
 * Portal origin for product links, derived from the configured API origin.
 *
 * Starts at production so the first render already has a usable href, and stays
 * there if storage is unreadable. Page surfaces only — the content bundle must
 * not pull `portalLinks`.
 */
export function usePortalOrigin(): string {
  const [origin, setOrigin] = useState(CANONICAL_PORTAL_ORIGIN)
  useEffect(() => {
    let live = true
    void getBackendUrl()
      .then(apiBaseUrl => { if (live) setOrigin(defaultWebAnalyticsBaseUrlForApi(apiBaseUrl)) })
      .catch(() => { /* keep the canonical origin */ })
    return () => { live = false }
  }, [])
  return origin
}
