/**
 * HubToggletip: the d3 hub's (i) button and its popover (plan §2.3; mockup shared.js
 * `infoBtn` + `popover`). Click or Enter opens it, never hover alone. One is open at a
 * time. Esc closes it and returns focus to the button (and stops there, so a layered Esc
 * does not also close the card); a pointer down outside or a resize closes it.
 *
 * The popover portals to <body> (absolute, page coordinates) so overflow-hidden rows and
 * tables never clip it, and it never moves layout (0 px shift).
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './hub-d3-tokens.css'

export const HUB_TOGGLETIP_MEASURED_LABEL = 'How this is measured'

export interface HubToggletipProps {
  /** The tip, 12 words at most. */
  tip: ReactNode
  /** Accessible name of the button. */
  label?: string
  /** Adds the "How this is measured" link; called after the popover closes. */
  onOpenMeasured?: () => void
  /** Popover alignment under the button. */
  align?: 'center' | 'right'
  className?: string
}

/** The one open toggletip's close function (one open at a time). */
let closeOpenToggletip: (() => void) | null = null

const GAP_PX = 6
const EDGE_PX = 8

export function HubToggletip({ tip, label = 'About this', onOpenMeasured, align = 'center', className }: HubToggletipProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const popId = useId()

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    setPosition(null)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const self = () => close(false)
    if (closeOpenToggletip && closeOpenToggletip !== self) closeOpenToggletip()
    closeOpenToggletip = self

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      event.preventDefault()
      close(true)
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && (popRef.current?.contains(target) || triggerRef.current?.contains(target))) return
      close(false)
    }
    const onResize = () => close(false)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onResize)
      if (closeOpenToggletip === self) closeOpenToggletip = null
    }
  }, [open, close])

  // Place before paint: under the button, centered (or right-aligned), kept 8 px inside the viewport.
  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const pop = popRef.current
    if (!trigger || !pop) return
    const rect = trigger.getBoundingClientRect()
    const width = pop.offsetWidth
    const viewport = document.documentElement.clientWidth || window.innerWidth
    let left = align === 'right' ? rect.right - width : rect.left + rect.width / 2 - width / 2
    left = Math.max(EDGE_PX, Math.min(viewport - width - EDGE_PX, left))
    setPosition({ left: left + window.scrollX, top: rect.bottom + window.scrollY + GAP_PX })
  }, [open, align])

  const onClick = () => {
    if (open) close(false)
    else setOpen(true)
  }

  const popover = open && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={popRef}
        id={popId}
        role="status"
        className="hub-d3-layer hub-tip-pop"
        data-hub-toggletip-pop=""
        style={position ? { left: position.left, top: position.top } : { left: 0, top: 0, visibility: 'hidden' }}
      >
        {tip}
        {onOpenMeasured ? (
          <>
            <br />
            <a
              href="#measured"
              onClick={(event) => {
                event.preventDefault()
                close(false)
                onOpenMeasured()
              }}
            >
              {HUB_TOGGLETIP_MEASURED_LABEL}
            </a>
          </>
        ) : null}
      </div>,
      document.body,
    )
    : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className ? `hub-tip ${className}` : 'hub-tip'}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        data-hub-toggletip=""
        onClick={onClick}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>
      {popover}
    </>
  )
}

/** Test helper: forget the open toggletip. */
export function resetHubToggletipForTests(): void {
  closeOpenToggletip = null
}
