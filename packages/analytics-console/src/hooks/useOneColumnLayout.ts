/**
 * Z01 (11-13, SESSION-MOMENTS-11): under 1280 px the session page is one column, and the console places the
 * Moments tabs right after the chart. Desktop (the xl three-column grid) is unchanged. Without matchMedia
 * (tests, server) it reads as desktop.
 */
import { useSyncExternalStore } from 'react'

export const ONE_COLUMN_QUERY = '(max-width: 1279px)'

function subscribe(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(ONE_COLUMN_QUERY)
  mq?.addEventListener?.('change', cb)
  return () => mq?.removeEventListener?.('change', cb)
}

function read(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && Boolean(window.matchMedia(ONE_COLUMN_QUERY)?.matches)
}

export function useOneColumnLayout(): boolean {
  return useSyncExternalStore(subscribe, read, () => false)
}
