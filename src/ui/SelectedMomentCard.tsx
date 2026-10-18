import { displayMomentReasonLabel, momentClockDisplay, reactionAnalyticalOffset, type LiveHeatPoint } from '@streampulse/pulse-core'
import type { ExtensionGameSegment } from '../shared/messages.ts'
import { MomentSelectionCard } from './MomentSelectionCard.tsx'
import { gameAtOffset, momentPictureView } from './momentPicture.ts'
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
  /** The stream's games, to name the one on screen at this moment. */
  games?: readonly ExtensionGameSegment[]
}

export function SelectedMomentCard({
  point,
  backendUrl,
  onJump,
  onAnalytics,
  onClear,
  jumpLabel = 'Jump',
  viewerUnavailableDetail,
  games,
}: SelectedMomentCardProps) {
  const clock = momentClockDisplay(point)
  const offsetLabel = clock.text
  const pointIdentity = liveHeatPointKey(undefined, point)

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
      contentKey={pointIdentity}
      ariaLabel={`Selected moment at ${offsetLabel}${clock.approximate ? ', start of minute bucket' : ''}`}
      picture={momentPictureView('card', point)}
      game={gameAtOffset(games, reactionAnalyticalOffset(point))}
    />
  )
}
