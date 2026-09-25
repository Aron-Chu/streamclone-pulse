import { useEffect, useRef, useState } from 'react'
import { displayMomentReasonLabel, momentClockDisplay, type LiveHeatPoint } from '@streampulse/pulse-core'
import { MomentSelectionCard } from './MomentSelectionCard.tsx'
import { formatSelectedMomentActivity } from './momentActivity.ts'
import { momentReasonLabelStyle } from './momentReasonStyles.ts'
import { liveHeatPointKey } from './mostReacted.ts'

export interface SelectedMomentCardProps {
  point: LiveHeatPoint
  backendUrl: string
  onJump: (point: LiveHeatPoint) => void
  onAnalytics: (point: LiveHeatPoint) => void
  onClear?: () => void
  jumpLabel?: string
  compact?: boolean
  interactionState?: 'preview' | 'selected'
  viewerUnavailableDetail?: string
}

export function SelectedMomentCard({
  point,
  backendUrl,
  onJump,
  onAnalytics,
  onClear,
  jumpLabel = 'Jump',
  viewerUnavailableDetail,
}: SelectedMomentCardProps) {
  const clock = momentClockDisplay(point)
  const offsetLabel = clock.text
  const pointIdentity = liveHeatPointKey(undefined, point)
  const [pulse, setPulse] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [entering, setEntering] = useState(true)
  const mountedRef = useRef(false)

  useEffect(() => {
    const enterTimer = window.setTimeout(() => setEntering(false), 180)
    return () => window.clearTimeout(enterTimer)
  }, [])

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    setSwapping(true)
    setPulse(true)
    const swapTimer = window.setTimeout(() => setSwapping(false), 180)
    const pulseTimer = window.setTimeout(() => setPulse(false), 220)
    return () => {
      window.clearTimeout(swapTimer)
      window.clearTimeout(pulseTimer)
    }
  }, [pointIdentity])

  return (
    <MomentSelectionCard
      kind="moment"
      label="Selected moment"
      timeLabel={offsetLabel}
      detail={displayMomentReasonLabel(point.reason, point.reasonLabel)}
      detailStyle={momentReasonLabelStyle(point.reason, point.reasonLabel, 'md')}
      activityLine={formatSelectedMomentActivity(point)}
      activityTitle={viewerUnavailableDetail}
      topEmotes={point.topEmotes}
      backendUrl={backendUrl}
      jumpLabel={jumpLabel}
      onJump={() => onJump(point)}
      onAnalytics={() => onAnalytics(point)}
      onClose={onClear}
      style={{ marginBottom: 8 }}
      className={
        [
          entering ? 'pulse-moment-card-enter' : undefined,
          pulse ? 'pulse-moment-card-pulse' : undefined,
        ]
          .filter(Boolean)
          .join(' ') || undefined
      }
      bodyClassName={swapping ? 'pulse-moment-card-swap' : undefined}
      ariaLabel={`Selected moment at ${offsetLabel}${clock.approximate ? ', start of minute bucket' : ''}`}
    />
  )
}
