/**
 * What the hub hero shares with the top bar while you scroll: the typed text
 * (one query in two boxes), whether the hero's search has gone under the bar
 * (the bar's box shows), and whether the hero's install card is on screen (the
 * bar's install button hides). A tiny store, not page state, so typing and
 * scrolling re-render only the boxes, never the hub.
 */
import { createContext, useContext, useState, useSyncExternalStore } from 'react'

export interface HubV5SearchState {
  value: string
  docked: boolean
  promoVisible: boolean
}

export interface HubV5SearchStore {
  get: () => HubV5SearchState
  set: (patch: Partial<HubV5SearchState>) => void
  subscribe: (listener: () => void) => () => void
  /** The box / and Ctrl/⌘K focus: the bar's once docked, else the hero's. */
  inputs: { hero: HTMLInputElement | null; dock: HTMLInputElement | null; openDock: (() => void) | null }
}

export function createHubV5SearchStore(): HubV5SearchStore {
  let state: HubV5SearchState = { value: '', docked: false, promoVisible: true }
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set: (patch) => {
      const next = { ...state, ...patch }
      if (next.value === state.value && next.docked === state.docked && next.promoVisible === state.promoVisible) return
      state = next
      listeners.forEach((l) => l())
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    inputs: { hero: null, dock: null, openDock: null },
  }
}

export const HubV5SearchContext = createContext<HubV5SearchStore | null>(null)

/** The page's store, or a private one when the hero renders alone (tests, stories). */
export function useHubV5SearchStore(): HubV5SearchStore {
  const shared = useContext(HubV5SearchContext)
  const [own] = useState(createHubV5SearchStore)
  return shared ?? own
}

export function useHubV5Search<T>(pick: (state: HubV5SearchState) => T): T {
  const store = useHubV5SearchStore()
  return useSyncExternalStore(store.subscribe, () => pick(store.get()), () => pick(store.get()))
}
