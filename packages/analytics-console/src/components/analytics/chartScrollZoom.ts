import { useCallback, useSyncExternalStore } from 'react'

/*
 * Scroll zoom preference, shared by every chart navigator on the site (the
 * hub's Global activity chart and the stream chart) and remembered in this
 * browser. It is on by default: a plain wheel over a chart's plot zooms. Only
 * the Scroll zoom toggle changes it; Reset zoom, Escape and range changes
 * never do. Storage can be blocked (private windows, cleared or disabled site
 * data); then the choice lives in memory for the page and the default is on.
 */
export const CHART_SCROLL_ZOOM_STORAGE_KEY = 'sp.chart.scrollZoom.v1'

const listeners = new Set<() => void>()
/** The choice when storage cannot hold it; null while storage works. */
let memoryChoice: boolean | null = null
let storageListening = false

function storedChoice(): boolean | null {
  try {
    const value = window.localStorage.getItem(CHART_SCROLL_ZOOM_STORAGE_KEY)
    return value === 'off' ? false : value === 'on' ? true : null
  } catch {
    return null
  }
}

function snapshot(): boolean {
  if (typeof window === 'undefined') return true
  if (memoryChoice != null) return memoryChoice
  return storedChoice() ?? true
}

function serverSnapshot(): boolean {
  return true
}

function notify() {
  listeners.forEach(listener => listener())
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== CHART_SCROLL_ZOOM_STORAGE_KEY) return
  // Another tab chose; storage holds it again.
  memoryChoice = null
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!storageListening && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage)
    storageListening = true
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && storageListening) {
      window.removeEventListener('storage', onStorage)
      storageListening = false
    }
  }
}

export function setChartScrollZoom(on: boolean) {
  try {
    window.localStorage.setItem(CHART_SCROLL_ZOOM_STORAGE_KEY, on ? 'on' : 'off')
    memoryChoice = storedChoice() === on ? null : on
  } catch {
    memoryChoice = on
  }
  notify()
}

/** [on, set]: the remembered Scroll zoom choice, the same in every chart and tab. */
export function useChartScrollZoom(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  const set = useCallback((next: boolean) => setChartScrollZoom(next), [])
  return [on, set]
}

/** Test hook: forget an in-memory choice (storage itself is left alone). */
export function resetChartScrollZoomMemory() {
  memoryChoice = null
  notify()
}
