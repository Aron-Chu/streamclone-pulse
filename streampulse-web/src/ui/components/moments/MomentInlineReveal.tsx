import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'

/** Matches the CSS collapse (faster than the 280ms open). */
export const MOMENT_INLINE_CLOSE_MS = 200

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The slot under a result row that a moment's detail opens into.
 *
 * Opening grows the slot from 0fr to 1fr while its content fades in; closing
 * collapses it faster, keeping the last content on screen (inert and hidden from
 * assistive technology) until the collapse ends. `animate={false}` swaps at once,
 * as does reduced motion. A slot that mounts already open (a deep link) does not
 * replay the opening.
 */
export function MomentInlineReveal({ open, animate = true, id, standalone = false, onInsidePress, children }: {
  open: boolean
  animate?: boolean
  /** Set on the open slot only, for the row's `aria-controls`. */
  id?: string
  /** A selection with no row above it in the loaded list. */
  standalone?: boolean
  /**
   * Fires for presses and clicks that start inside the slot. React events follow
   * the component tree, so this includes portals (menus, tooltips) its content renders.
   */
  onInsidePress?: (event: SyntheticEvent) => void
  children: ReactNode
}) {
  const last = useRef<ReactNode>(children)
  if (open) last.current = children
  const wrapper = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(open)
  const [expanded, setExpanded] = useState(open)
  // Reduced motion is read per render, so a preference change applies to the next open or close.
  const instant = !animate || reducedMotion()
  const present = open || (mounted && !instant)
  useLayoutEffect(() => {
    if (!open || expanded) return
    if (instant) { setExpanded(true); return }
    // Commit the collapsed row first so the change to 1fr is a transition.
    void wrapper.current?.offsetHeight
    setExpanded(true)
  }, [open, expanded, instant])
  useEffect(() => {
    if (open) { setMounted(true); return }
    if (!mounted && !expanded) return
    setExpanded(false)
    if (instant) { setMounted(false); return }
    const timer = setTimeout(() => setMounted(false), MOMENT_INLINE_CLOSE_MS)
    return () => clearTimeout(timer)
    // Only an open/close change starts or ends the collapse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, instant])
  useLayoutEffect(() => {
    if (wrapper.current) wrapper.current.inert = !open
  }, [open, present])
  if (!present) return null
  const shown = open && (expanded || instant)
  return <div ref={wrapper} id={open ? id : undefined}
    className={`moments-inline${shown ? ' is-open' : ''}${open ? '' : ' is-closing'}${standalone ? ' moments-inline--standalone' : ''}`}
    aria-hidden={open ? undefined : true} onPointerDownCapture={onInsidePress} onClickCapture={onInsidePress}>
    <div className="moments-inline__clip">{open ? children : last.current}</div>
  </div>
}
