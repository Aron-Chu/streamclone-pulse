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
  /** The card's kicker: Top Moments shows its strongest moment until one is picked. */
  label?: string
}

export function SelectedMomentCard({
  point,
  backendUrl,
  onJump,
  onAnalytics,
  onClear,
  jumpLabel = 'Jump',
  viewerUnavailableDetail,
  label = 'Selected moment',
}: SelectedMomentCardProps) {
  const clock = momentClockDisplay(point)
  const offsetLabel = clock.text
  const pointIdentity = liveHeatPointKey(undefined, point)

  return (
    <MomentSelectionCard
      kind="moment"
      label={label}
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
      contentKey={pointIdentity}
      ariaLabel={`${label} at ${offsetLabel}${clock.approximate ? ', start of minute bucket' : ''}`}
    />
  )
}
