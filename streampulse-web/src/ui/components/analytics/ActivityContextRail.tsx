import { useEffect, useRef, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

export type ActivityContextRailMode = 'idle' | 'preview' | 'locked'

export interface ActivityContextRailProps {
  mode: ActivityContextRailMode
  idle: ReactNode
  inspector: ReactNode
  onClear: () => void
}

/** Keeps the working Live Wire mounted while the same chart-side slot previews a bucket. */
export function ActivityContextRail({ mode, idle, inspector, onClear }: ActivityContextRailProps) {
  const backRef = useRef<HTMLButtonElement | null>(null)
  const wirePaneRef = useRef<HTMLDivElement | null>(null)
  const inspectorPaneRef = useRef<HTMLDivElement | null>(null)
  const previousMode = useRef<ActivityContextRailMode>('idle')
  const inspectorVisible = mode !== 'idle'

  useEffect(() => {
    const setPaneInert = (element: HTMLDivElement | null, inert: boolean) => {
      if (inert) element?.setAttribute('inert', '')
      else element?.removeAttribute('inert')
    }
    setPaneInert(wirePaneRef.current, mode !== 'idle')
    setPaneInert(inspectorPaneRef.current, mode === 'idle')
  }, [mode])

  useEffect(() => {
    if (mode === 'locked' && previousMode.current !== 'locked') {
      backRef.current?.focus({ preventScroll: true })
    }
    previousMode.current = mode
  }, [mode])

  useEffect(() => {
    if (mode !== 'locked') return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClear()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [mode, onClear])

  return (
    <div className="activity-context-rail" data-activity-rail-view={mode}>
      <div className="activity-context-rail__stage">
        <div
          ref={wirePaneRef}
          className={`activity-context-rail__pane activity-context-rail__pane--wire${mode === 'idle' ? ' is-active' : ''}`}
          aria-hidden={mode === 'idle' ? undefined : true}
        >
          {idle}
        </div>
        <div
          ref={inspectorPaneRef}
          className={`activity-context-rail__pane activity-context-rail__pane--inspector${inspectorVisible ? ' is-active' : ''}`}
          aria-hidden={inspectorVisible ? undefined : true}
        >
          {mode === 'locked' ? (
            <div className="activity-context-rail__toolbar">
              <button ref={backRef} type="button" onClick={onClear}>
                <ArrowLeft aria-hidden="true" />Back to Live Wire
              </button>
            </div>
          ) : null}
          {inspector}
        </div>
      </div>
    </div>
  )
}
