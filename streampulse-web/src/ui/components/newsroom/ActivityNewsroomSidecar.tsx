import { useEffect, useRef, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

export interface ActivityNewsroomSidecarProps {
  focused: boolean
  /** True only when a Newsroom story initiated the current locked bucket. */
  storyFocused?: boolean
  inspector: ReactNode
  liveDesk: ReactNode
  onBackToDesk: () => void
  announcement?: string
}

/** Owns the existing chart-side slot. It never mounts Live Desk beside the bucket inspector. */
export function ActivityNewsroomSidecar({
  focused,
  storyFocused = false,
  inspector,
  liveDesk,
  onBackToDesk,
  announcement = '',
}: ActivityNewsroomSidecarProps) {
  const backRef = useRef<HTMLButtonElement | null>(null)
  const previousStoryFocus = useRef(false)
  useEffect(() => {
    if (storyFocused && !previousStoryFocus.current) backRef.current?.focus()
    previousStoryFocus.current = storyFocused
  }, [storyFocused])
  return (
    <div className="activity-newsroom-sidecar" data-sidecar-view={focused ? 'inspector' : 'live-desk'}>
      <span className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</span>
      {focused ? (
        <>
          <div className="activity-newsroom-sidecar__toolbar">
            <button ref={backRef} type="button" onClick={onBackToDesk}>
              <ArrowLeft aria-hidden="true" />Back to Live Desk
            </button>
          </div>
          {inspector}
        </>
      ) : liveDesk}
    </div>
  )
}
