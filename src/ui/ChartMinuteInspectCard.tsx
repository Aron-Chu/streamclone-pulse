import { formatHeatOffset } from '@streampulse/pulse-core'
import type { ExtensionRollup } from '../shared/messages.ts'
import { MomentInspectorCard } from './MomentInspectorCard.tsx'

export interface ChartMinuteInspectCardProps {
  rollup: ExtensionRollup
  backendUrl: string
  jumpLabel?: string
  jumpDisabled?: boolean
  interactionState?: 'preview' | 'selected'
  onJump?: (offsetSeconds: number) => void
  onAnalytics?: (offsetSeconds: number) => void
  /**
   * Omit for a hover preview. A card that appears on hover must not offer a
   * click target that disappears when the pointer moves.
   */
  onClose?: () => void
  viewerUnavailableDetail?: string
}

export function ChartMinuteInspectCard({
  rollup,
  backendUrl,
  jumpLabel = 'VOD',
  jumpDisabled = false,
  interactionState = 'selected',
  onJump,
  onAnalytics,
  onClose,
  viewerUnavailableDetail,
}: ChartMinuteInspectCardProps) {
  const canonicalOffsetSeconds = Math.max(0, Math.round(rollup.offsetSeconds))
  const emoteTotal = rollup.totalEmoteCount ?? rollup.sevenTvEmoteCount ?? 0

  return (
    <MomentInspectorCard
      kind="minute"
      interactionState={interactionState}
      timeLabel={formatHeatOffset(canonicalOffsetSeconds)}
      detailLabel="Minute activity"
      chatCount={rollup.chatCount ?? 0}
      emoteCount={emoteTotal}
      viewerCount={rollup.viewerCount}
      viewerSampled={(rollup.viewerSamples ?? 0) > 0}
      viewerUnavailableDetail={viewerUnavailableDetail}
      topEmotes={rollup.topEmotes}
      backendUrl={backendUrl}
      jumpLabel={jumpLabel}
      onJump={onJump && !jumpDisabled ? () => onJump(canonicalOffsetSeconds) : undefined}
      onAnalytics={onAnalytics ? () => onAnalytics(canonicalOffsetSeconds) : undefined}
      onClose={onClose}
    />
  )
}
