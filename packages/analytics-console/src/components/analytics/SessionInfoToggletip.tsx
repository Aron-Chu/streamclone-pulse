import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const POP_GAP_PX = 6
const VIEW_MARGIN_PX = 8

/**
 * The (i) beside the session tabs (d3-v2 session-original `infoBtn`): a
 * toggletip that opens on click or Enter, never on hover. One short sentence;
 * Escape, an outside press or a resize closes it. The popover sits in the
 * body so the tabs box's overflow never clips it, centred under the button
 * and kept 8 px inside the window.
 */
export function SessionInfoToggletip({ tip, label }: { tip: string; label: string }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const popId = useId()

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    const button = buttonRef.current
    const pop = popRef.current
    if (!button || !pop) return
    const r = button.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const w = pop.offsetWidth
    const left = Math.max(VIEW_MARGIN_PX, Math.min(vw - w - VIEW_MARGIN_PX, r.left + r.width / 2 - w / 2))
    pop.style.left = `${Math.round(left + window.scrollX)}px`
    pop.style.top = `${Math.round(r.bottom + window.scrollY + POP_GAP_PX)}px`
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close(true)
    }
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && (popRef.current?.contains(target) || buttonRef.current?.contains(target))) return
      close(false)
    }
    const onResize = () => close(false)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('resize', onResize)
    }
  }, [close, open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="ssp-info"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        data-session-info
        onClick={() => setOpen(value => !value)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div ref={popRef} id={popId} className="ssp-pop" role="status" data-session-info-pop>
              {tip}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
