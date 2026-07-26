import { createContext, useContext } from 'react'

/** Shadow root (or document) for outside-click detection in themed menus. */
export const PulsePortalContext = createContext<ShadowRoot | Document | null>(null)

export function usePulsePortalRoot(): ShadowRoot | Document {
  const root = useContext(PulsePortalContext)
  if (root) return root
  if (typeof document !== 'undefined') return document
  return null as unknown as Document
}

/** True when event path includes the select root (Shadow DOM safe). */
export function eventPathIncludesNode(event: Event, node: Node | null): boolean {
  if (!node) return false
  if (typeof event.composedPath === 'function') {
    return event.composedPath().includes(node)
  }
  const target = event.target
  if (target && typeof node.contains === 'function') {
    return node.contains(target as Node)
  }
  return false
}
