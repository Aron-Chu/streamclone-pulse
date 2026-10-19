import type { CSSProperties } from 'react'
import type { ExtensionEmote } from '../shared/messages.ts'
import type { MomentPictureView } from '../shared/momentFramesContract.ts'
import type { BookmarkTarget } from './momentBookmarks.tsx'
import type { MomentGame } from './momentPicture.ts'
import { formatCount } from './mostReacted.ts'
import { MomentSelectionCard } from './MomentSelectionCard.tsx'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { theme } from './theme.ts'

export interface MomentInspectorCardProps {
  kind: 'minute' | 'moment'
  interactionState?: 'preview' | 'selected'
  timeLabel: string
  detailLabel: string
  reason?: string
  reasonLabel?: string
  chatCount: number
  emoteCount: number
  viewerCount?: number
  viewerSampled?: boolean
  viewerUnavailableDetail?: string
  topEmotes?: ExtensionEmote[]
  backendUrl: string
  jumpLabel?: string
  onJump?: () => void
  onAnalytics?: () => void
  onClose?: () => void
  /** Selected cards only: what the player showed then, and the game on stream. */
  picture?: MomentPictureView
  game?: MomentGame
  /** Selected cards only: what the card's bookmark saves. */
  bookmark?: BookmarkTarget
}

function viewerState(viewerCount: number | undefined, viewerSampled: boolean) {
  const hasValue = typeof viewerCount === 'number' && Number.isFinite(viewerCount) && viewerCount >= 0
  const sampled = viewerSampled || Boolean(hasValue && viewerCount > 0)
  return { sampled, count: sampled ? Math.max(0, hasValue ? viewerCount : 0) : undefined }
}

function activityLine(
  chatCount: number,
  emoteCount: number,
  viewerCount: number | undefined,
  viewerSampled: boolean,
): string {
  const viewer = viewerState(viewerCount, viewerSampled)
  return [
    viewer.sampled ? `${formatCount(viewer.count ?? 0)} viewers` : 'Viewers not sampled',
    `${formatCount(Math.max(0, chatCount))} chat`,
    `${formatCount(Math.max(0, emoteCount))} emotes`,
  ].join(' · ')
}

/** Shared inspector contract; committed selections and hover previews render separately. */
export function MomentInspectorCard({
  kind,
  interactionState = 'selected',
  timeLabel,
  detailLabel,
  reasonLabel,
  chatCount,
  emoteCount,
  viewerCount,
  viewerSampled = false,
  viewerUnavailableDetail = 'Viewer count was not sampled for this minute',
  topEmotes = [],
  backendUrl,
  jumpLabel = 'Jump',
  onJump,
  onAnalytics,
  onClose,
  picture,
  game,
  bookmark,
}: MomentInspectorCardProps) {
  const viewer = viewerState(viewerCount, viewerSampled)
  const summary = activityLine(chatCount, emoteCount, viewerCount, viewerSampled)

  if (interactionState === 'selected') {
    return (
      <MomentSelectionCard
        kind={kind}
        label={kind === 'minute' ? 'Selected minute' : 'Selected moment'}
        timeLabel={timeLabel}
        detail={reasonLabel ?? detailLabel}
        detailStyle={styles.selectedDetail}
        activityLine={summary}
        activityTitle={viewer.sampled ? undefined : viewerUnavailableDetail}
        viewerSampleState={viewer.sampled ? 'sampled' : 'not-sampled'}
        topEmotes={topEmotes}
        backendUrl={backendUrl}
        jumpLabel={jumpLabel}
        onJump={onJump}
        onAnalytics={onAnalytics}
        onClose={onClose}
        contentKey={timeLabel}
        ariaLabel={`${kind === 'minute' ? 'Selected minute' : 'Selected moment'} at ${timeLabel}`}
        picture={picture}
        game={game}
        bookmark={bookmark}
      />
    )
  }

  return (
    <div
      className="pulse-moment-inspector-card pulse-insp"
      data-chart-action="true"
      data-moment-inspector-card="true"
      data-moment-inspector-state="preview"
      data-chart-minute-card={kind === 'minute' ? 'true' : undefined}
      data-selected-moment-card={kind === 'moment' ? 'true' : undefined}
      aria-label={`Preview moment at ${timeLabel}`}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <div className="pulse-insp-header">
        <span className="pulse-insp-kicker">Preview moment</span>
        <span className="pulse-insp-time" data-moment-inspector-clock="true">{timeLabel}</span>
      </div>
      <p className="pulse-insp-detail">{reasonLabel ?? detailLabel}</p>
      <p
        className="pulse-insp-activity"
        data-moment-inspector-activity="true"
        data-viewer-sample-state={viewer.sampled ? 'sampled' : 'not-sampled'}
        title={viewer.sampled ? undefined : viewerUnavailableDetail}
      >
        {summary}
      </p>
      {topEmotes.length > 0 ? (
        <div className="pulse-insp-emotes" data-moment-inspector-emotes="true" aria-label="Top emotes for preview moment">
          {topEmotes.slice(0, 3).map(emote => (
            <span
              key={emote.id ?? emote.name}
              className="pulse-insp-emote"
              data-emote-name={emote.name}
              data-moment-inspector-emote-row="true"
              title={`${emote.name}: ${formatCount(emote.count)} uses`}
            >
              <PulseEmoteImg emote={emote} backendUrl={backendUrl} width={16} height={16} style={styles.previewImg} eager />
              <span className="pulse-insp-emote-name">{emote.name}</span>
              <span className="pulse-insp-emote-count">×{formatCount(emote.count)}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Passed on as inline style: the selection card's detail line and PulseEmoteImg. */
const styles: Record<string, CSSProperties> = {
  selectedDetail: { color: theme.accentSoft, fontSize: 11, fontWeight: 750 },
  previewImg: { display: 'block', flexShrink: 0, objectFit: 'contain' },
}
