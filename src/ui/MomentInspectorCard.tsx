import type { CSSProperties } from 'react'
import type { ExtensionEmote } from '../shared/messages.ts'
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
        ariaLabel={`${kind === 'minute' ? 'Selected minute' : 'Selected moment'} at ${timeLabel}`}
      />
    )
  }

  return (
    <div
      className="pulse-moment-inspector-card"
      style={styles.preview}
      data-chart-action="true"
      data-moment-inspector-card="true"
      data-moment-inspector-state="preview"
      data-chart-minute-card={kind === 'minute' ? 'true' : undefined}
      data-selected-moment-card={kind === 'moment' ? 'true' : undefined}
      aria-label={`Preview moment at ${timeLabel}`}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <div style={styles.previewHeader}>
        <span style={styles.previewKicker}>Preview moment</span>
        <span style={styles.previewTime} data-moment-inspector-clock="true">{timeLabel}</span>
      </div>
      <p style={styles.previewDetail}>{reasonLabel ?? detailLabel}</p>
      <p
        style={styles.previewActivity}
        data-moment-inspector-activity="true"
        data-viewer-sample-state={viewer.sampled ? 'sampled' : 'not-sampled'}
        title={viewer.sampled ? undefined : viewerUnavailableDetail}
      >
        {summary}
      </p>
      {topEmotes.length > 0 ? (
        <div style={styles.previewEmotes} data-moment-inspector-emotes="true" aria-label="Top emotes for preview moment">
          {topEmotes.slice(0, 3).map(emote => (
            <span
              key={emote.id ?? emote.name}
              style={styles.previewEmote}
              data-emote-name={emote.name}
              data-moment-inspector-emote-row="true"
              title={`${emote.name}: ${formatCount(emote.count)} uses`}
            >
              <PulseEmoteImg emote={emote} backendUrl={backendUrl} width={16} height={16} style={styles.previewImg} eager />
              <span style={styles.previewEmoteName}>{emote.name}</span>
              <span style={styles.previewEmoteCount}>×{formatCount(emote.count)}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  selectedDetail: { color: theme.accentSoft, fontSize: 11, fontWeight: 750 },
  preview: {
    background: 'rgba(13, 13, 18, 0.96)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    boxSizing: 'border-box',
    display: 'grid',
    gap: 4,
    minWidth: 0,
    padding: '8px 10px',
    width: '100%',
  },
  previewHeader: { alignItems: 'baseline', display: 'flex', gap: 8, justifyContent: 'space-between' },
  previewKicker: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  previewTime: { color: theme.textPrimary, fontSize: 11, fontVariantNumeric: 'tabular-nums', fontWeight: 800 },
  previewDetail: { color: theme.accentSoft, fontSize: 10.5, fontWeight: 750, margin: 0 },
  previewActivity: { color: theme.textSecondary, fontSize: 10, fontWeight: 600, margin: 0 },
  previewEmotes: { alignItems: 'center', display: 'flex', gap: 8, minWidth: 0, overflow: 'hidden', paddingTop: 3 },
  previewEmote: { alignItems: 'center', display: 'flex', gap: 4, minWidth: 0, overflow: 'hidden' },
  previewImg: { display: 'block', flexShrink: 0, objectFit: 'contain' },
  previewEmoteName: {
    color: theme.textPrimary,
    fontSize: 9.5,
    fontWeight: 700,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  previewEmoteCount: { color: theme.textMuted, flexShrink: 0, fontSize: 9, fontWeight: 700 },
}
