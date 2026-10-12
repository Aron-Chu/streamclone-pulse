import { createContext, useContext } from 'react'

/** Shadow root (or document) for outside-click detection in themed menus. */
export const PulsePortalContext = createContext<ShadowRoot | Document | null>(null)

export function usePulsePortalRoot(): ShadowRoot | Document {
  const root = useContext(PulsePortalContext)
  if (root) return root
  if (typeof document !== 'undefined') return document
  return null as unknown as Document
}

/** A pointerdown's path and target as seen from inside the shadow root. */
export type PressPath = Pick<Event, 'composedPath' | 'target'>

const innerPaths = new WeakMap<Event, EventTarget[]>()
const recordingRoots = new WeakSet<ShadowRoot>()

/**
 * Run `onOutside` for a pointerdown that `isInside` does not claim.
 *
 * Store builds use a closed shadow root, which retargets document events to the
 * host: their composed path never shows the control that was pressed. One
 * capture listener per root records each press's real path, and every
 * subscriber reads that record. Sharing it matters because a press can
 * re-render a subscriber and replace its listener mid-dispatch.
 */
export function onOutsidePointerDown(
  root: ShadowRoot | Document | null,
  isInside: (press: PressPath) => boolean,
  onOutside: (event: PointerEvent) => void,
): () => void {
  if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot && !recordingRoots.has(root)) {
    recordingRoots.add(root)
    root.addEventListener('pointerdown', event => { innerPaths.set(event, event.composedPath()) }, true)
  }
  const handle = (event: PointerEvent) => {
    const path = innerPaths.get(event) ?? (typeof event.composedPath === 'function' ? event.composedPath() : [])
    if (!isInside({ composedPath: () => path, target: path[0] ?? event.target })) onOutside(event)
  }
  document.addEventListener('pointerdown', handle)
  return () => document.removeEventListener('pointerdown', handle)
}

/** True when event path includes the select root (Shadow DOM safe). */
export function eventPathIncludesNode(event: PressPath, node: Node | null): boolean {
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
