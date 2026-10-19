/**
 * "Show on chart" (d3-v2 session-original.html #showBtn / #showPanel,
 * 2026-10-14 and 10-15, Aron): the chart's markers. Moments (the pin rail and
 * its leader lines), Averages (the dotted average line) and Live edge (the
 * newest measured minute). Every marker is off on each load and never
 * remembered. The button carries the on-count; its checklist opens under it
 * and closes on Escape (focus back to the button), an outside press, or Tab
 * out of the list.
 */
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent as ReactFocusEvent } from 'react'

export interface SessionMarkers {
  moments: boolean
  avg: boolean
  live: boolean
}

export const SESSION_MARKERS_OFF: Readonly<SessionMarkers> = Object.freeze({ moments: false, avg: false, live: false })

const ROWS: readonly { key: keyof SessionMarkers; label: string; sub: string }[] = [
  { key: 'moments', label: 'Moments', sub: 'pins and leader lines' },
  { key: 'avg', label: 'Averages', sub: 'dotted line per lane' },
  { key: 'live', label: 'Live edge', sub: 'the newest measured minute' },
]

export function SessionShowOnChart({
  markers,
  onChange,
  liveAvailable,
}: {
  markers: SessionMarkers
  onChange(next: SessionMarkers): void
  /** Live edge is listed only while the stream has one. */
  liveAvailable: boolean
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const rows = ROWS.filter(row => row.key !== 'live' || liveAvailable)
  const on = rows.filter(row => markers[row.key]).length
  const close = useCallback((focus: boolean) => {
    setOpen(false)
    if (focus) buttonRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      const active = document.activeElement
      close(!!active && (panelRef.current?.contains(active) || active === buttonRef.current))
    }
    const onDown = (event: PointerEvent) => {
      const t = event.target as Node | null
      if (t && (panelRef.current?.contains(t) || buttonRef.current?.contains(t))) return
      close(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [close, open])

  // Tabbing out of the list closes it (A2).
  const onPanelBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    const to = event.relatedTarget as Node | null
    if (to && !panelRef.current?.contains(to) && to !== buttonRef.current) close(false)
  }

  return (
    <span className="ssc-show" data-session-show-on-chart="">
      <button
        ref={buttonRef}
        type="button"
        className="ssc-qb"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={'Show on chart' + (on ? ', ' + on + ' on' : '')}
        data-session-show-toggle=""
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        Show on chart
        {on ? <span className="ssc-cnt" aria-hidden="true">{on}</span> : null}
        <svg className="ssc-chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div
        ref={panelRef}
        id={panelId}
        className="ssc-panel"
        role="group"
        aria-label="Show on chart"
        data-chart-wheel-exempt=""
        hidden={!open}
        onBlur={onPanelBlur}
      >
        {rows.map(row => (
          <label key={row.key}>
            <input
              type="checkbox"
              checked={markers[row.key]}
              data-session-marker={row.key}
              onChange={event => onChange({ ...markers, [row.key]: event.currentTarget.checked })}
            />
            <span>
              {row.label}
              <span className="ssc-sub2">{row.sub}</span>
            </span>
          </label>
        ))}
      </div>
    </span>
  )
}
