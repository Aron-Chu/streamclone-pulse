import { useSyncExternalStore } from 'react'

/**
 * Hydration-safe matchMedia subscription.
 * getServerSnapshot / unavailable-window default must match the CSS fallback layout
 * so SSR/prerender and first paint stay consistent (table = desktop default).
 */
export function useMatchMedia(query: string, serverMatches = false): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => {}
      }
      const mql = window.matchMedia(query)
      const handler = () => onStoreChange()
      mql.addEventListener('change', handler)
      return () => mql.removeEventListener('change', handler)
    },
    () => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return serverMatches
      }
      return window.matchMedia(query).matches
    },
    () => serverMatches,
  )
}

/** Compact Channel Screener cards — must stay aligned with figma-analytics.css @media (max-width: 599px). */
export const LIVE_CHANNELS_MATRIX_COMPACT_QUERY = '(max-width: 599px)'
