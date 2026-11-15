import { formatMomentOffset } from '@streampulse/pulse-core'
import type { JumpResult } from './jumpMomentAction.ts'
import type { ExtensionGameSegment, ExtensionRollup } from '../shared/messages.ts'
import { MomentSelectionCard } from './MomentSelectionCard.tsx'
import { gameAtOffset, minutePictureView } from './momentPicture.ts'
import { formatCount } from './mostReacted.ts'
import { theme } from './theme.ts'

export interface ChartMinuteInspectCardProps {
  rollup: ExtensionRollup
  backendUrl: string
  jumpLabel: string
  onJump?: (offsetSeconds: number) => JumpResult
  onAnalytics?: (offsetSeconds: number) => void
  onClose?: () => void
  viewerUnavailableDetail: string
  /** The stream's games, to name the one on screen in this minute. */
  games?: readonly ExtensionGameSegment[]
}

/** A chart minute the viewer picked, in the selection card the Top moments card uses. */
export function ChartMinuteInspectCard({
  rollup,
  backendUrl,
  jumpLabel,
  onJump,
  onAnalytics,
  onClose,
  viewerUnavailableDetail,
  games,
}: ChartMinuteInspectCardProps) {
  const offset = Math.max(0, Math.round(rollup.offsetSeconds))
  const timeLabel = formatMomentOffset(offset)
  const viewers = rollup.viewerCount ?? 0
  const sampled = (rollup.viewerSamples ?? 0) > 0 || viewers > 0

  return (
    <MomentSelectionCard
      kind="minute"
      label="Selected minute"
      timeLabel={timeLabel}
      detail="Minute activity"
      detailStyle={DETAIL_STYLE}
      activityLine={[
        sampled ? `${formatCount(Math.max(0, viewers))} viewers` : 'Viewers not sampled',
        `${formatCount(Math.max(0, rollup.chatCount ?? 0))} chat/min`,
        `${formatCount(Math.max(0, rollup.totalEmoteCount ?? rollup.sevenTvEmoteCount ?? 0))} emotes/min`,
      ].join(' · ')}
      activityTitle={sampled ? undefined : viewerUnavailableDetail}
      viewerSampleState={sampled ? 'sampled' : 'not-sampled'}
      topEmotes={rollup.topEmotes ?? []}
      backendUrl={backendUrl}
      jumpLabel={jumpLabel}
      onJump={onJump ? () => onJump(offset) : undefined}
      onAnalytics={onAnalytics ? () => onAnalytics(offset) : undefined}
      onClose={onClose}
      contentKey={timeLabel}
      ariaLabel={`Selected minute at ${timeLabel}`}
      picture={minutePictureView('card', offset)}
      game={gameAtOffset(games, offset)}
      bookmark={{ kind: 'minute', offsetSeconds: offset, label: 'Minute activity' }}
    />
  )
}

/** The selection card's detail line, as the Top moments card colours its reason. */
const DETAIL_STYLE = { color: theme.accentSoft, fontSize: 11, fontWeight: 750 }
