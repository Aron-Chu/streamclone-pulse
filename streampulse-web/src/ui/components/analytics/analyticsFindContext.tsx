/**
 * The top bar's channel search (R5-14, mockup hub.js): which page owns / and
 * Ctrl/⌘K. A page with a hero search (the hub) reports whether its field is
 * on screen and the live channels it already loaded; while the field is on
 * screen the hero takes the keys and the top-bar button stays hidden. Every
 * other analytics page has no hero, so the button is always there.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { HubLiveChannel } from '../../../lib/publicHub'

export interface AnalyticsFindHero {
  /** The hero's field is below the top bar, on screen. */
  inView: boolean
  live: readonly HubLiveChannel[]
}

interface AnalyticsFindValue {
  hero: AnalyticsFindHero | null
  setHero: (hero: AnalyticsFindHero | null) => void
}

const AnalyticsFindContext = createContext<AnalyticsFindValue | null>(null)

export function AnalyticsFindProvider({ children }: { children: ReactNode }) {
  const [hero, setHero] = useState<AnalyticsFindHero | null>(null)
  const value = useMemo(() => ({ hero, setHero }), [hero])
  return <AnalyticsFindContext.Provider value={value}>{children}</AnalyticsFindContext.Provider>
}

export function useAnalyticsFind(): AnalyticsFindValue | null {
  return useContext(AnalyticsFindContext)
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent)

/** True for the / and Ctrl/⌘K keys that open the channel search, outside text fields for /. */
export function isFindShortcut(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  const inField = Boolean(target && (/INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable))
  const cmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
  const slash = event.key === '/' && !inField && !event.metaKey && !event.ctrlKey && !event.altKey
  return cmdK || slash
}
