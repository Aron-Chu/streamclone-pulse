import type { CSSProperties, ReactNode } from 'react'
import type { ExtensionEmote } from '../shared/messages.ts'
import { formatCount } from './mostReacted.ts'
import { overlayGhostChipButton, overlayTextLinkButton } from './momentReasonStyles.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { theme } from './theme.ts'

export type MomentSelectionEmote = Pick<
  ExtensionEmote,
  'id' | 'providerEmoteId' | 'name' | 'imageUrl' | 'count' | 'provider'
> & { key?: string }

export interface MomentSelectionCardProps {
  kind: 'minute' | 'moment'
  label: string
  timeLabel: string
  detail: ReactNode
  detailStyle?: CSSProperties
  activityLine: string
  activityTitle?: string
  viewerSampleState?: 'sampled' | 'not-sampled'
  topEmotes?: readonly MomentSelectionEmote[]
  backendUrl: string
  jumpLabel: string
  onJump?: () => void
  onAnalytics?: () => void
  onClose?: () => void
  className?: string
  bodyClassName?: string
  ariaLabel: string
  style?: CSSProperties
}

/** Shared presentation for committed ranked-moment and raw-minute selections. */
export function MomentSelectionCard({
  kind,
  label,
  timeLabel,
  detail,
  detailStyle,
  activityLine,
  activityTitle,
  viewerSampleState,
  topEmotes = [],
  backendUrl,
  jumpLabel,
  onJump,
  onAnalytics,
  onClose,
  className,
  bodyClassName,
  ariaLabel,
  style,
}: MomentSelectionCardProps) {
  return (
    <div
      className={['pulse-moment-selection-card', className].filter(Boolean).join(' ')}
      data-selected-moment-card={kind === 'moment' ? 'true' : undefined}
      data-chart-minute-card={kind === 'minute' ? 'true' : undefined}
      data-moment-inspector-card="true"
      data-moment-inspector-state="selected"
      data-chart-action="true"
      style={{ ...styles.wrap, ...style }}
      aria-label={ariaLabel}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <div className={bodyClassName}>
        <div style={styles.header}>
          <span style={styles.kicker}>{label}</span>
          <span style={styles.offset} data-moment-inspector-clock="true">{timeLabel}</span>
          {onClose ? (
            <button
              type="button"
              style={styles.close}
              aria-label={`Clear ${kind === 'minute' ? 'selected minute' : 'selected moment'}`}
              title="Clear selection"
              onClick={onClose}
            >
              ×
            </button>
          ) : null}
        </div>

        <p style={{ ...styles.detail, ...detailStyle }}>{detail}</p>
        <p
          style={styles.activity}
          data-moment-inspector-activity="true"
          data-viewer-sample-state={viewerSampleState}
          title={activityTitle}
        >
          {activityLine}
        </p>

        {topEmotes.length > 0 ? (
          <ul
            style={styles.list}
            aria-label={`Top emotes for selected ${kind}`}
            data-moment-inspector-emotes="true"
          >
            {topEmotes.slice(0, 3).map(emote => (
              <li
                key={emote.key ?? emote.id ?? emote.name}
                style={styles.item}
                data-emote-name={emote.name}
                data-moment-inspector-emote-row="true"
                title={`${emote.name}: ${formatCount(emote.count)} uses`}
              >
                <PulseEmoteImg
                  emote={emote}
                  backendUrl={backendUrl}
                  width={18}
                  height={18}
                  style={styles.img}
                  eager
                  showHoverPreview
                  previewFocusable
                />
                <span style={styles.name}>{emote.name}</span>
                <span style={styles.uses}>{formatCount(emote.count)} uses</span>
              </li>
            ))}
          </ul>
        ) : null}

        {onJump || onAnalytics ? (
          <div style={styles.actions}>
            {onJump ? (
              <button
                type="button"
                className="pulse-action-chip pulse-action-chip-primary"
                style={styles.actionPrimary}
                data-moment-inspector-action="jump"
                onClick={onJump}
              >
                <span aria-hidden="true" style={styles.playIcon} data-selected-moment-play-icon="true">▶</span>
                {jumpLabel}
              </button>
            ) : null}
            {onAnalytics ? (
              <button
                type="button"
                style={styles.action}
                data-moment-inspector-action="analytics"
                onClick={onAnalytics}
              >
                Open Analytics
                <span aria-hidden="true" style={styles.analyticsIcon}>↗</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    background: 'rgba(255, 255, 255, 0.025)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 8,
    boxSizing: 'border-box',
    minWidth: 0,
    padding: '10px 12px',
    width: '100%',
  },
  header: {
    alignItems: 'baseline',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    minWidth: 0,
  },
  kicker: {
    color: theme.textMuted,
    flex: '1 1 auto',
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.05em',
    minWidth: 0,
    textTransform: 'uppercase',
  },
  offset: {
    color: theme.textPrimary,
    flexShrink: 0,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 800,
  },
  close: {
    background: 'transparent',
    border: 0,
    color: theme.textMuted,
    cursor: 'pointer',
    flexShrink: 0,
    fontSize: 16,
    lineHeight: 1,
    margin: '-2px -2px -2px 0',
    padding: 2,
  },
  detail: { fontWeight: 700, margin: '4px 0 0' },
  activity: { color: theme.textSecondary, fontSize: 11, fontWeight: 600, margin: '2px 0 8px' },
  list: { display: 'grid', gap: 6, listStyle: 'none', margin: '0 0 10px', padding: 0 },
  item: { alignItems: 'center', display: 'flex', gap: 8, minWidth: 0 },
  img: { display: 'block', flexShrink: 0, objectFit: 'contain' },
  name: {
    color: theme.textPrimary,
    flex: 1,
    fontSize: 12,
    fontWeight: 700,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  uses: { color: theme.textMuted, flexShrink: 0, fontSize: 11, fontVariantNumeric: 'tabular-nums' },
  actions: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'nowrap',
    gap: 12,
    justifyContent: 'space-between',
    minWidth: 0,
    width: '100%',
  },
  actionPrimary: {
    ...overlayGhostChipButton,
    alignItems: 'center',
    background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.2)',
    borderColor: 'rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.46)',
    color: theme.accentInk,
    display: 'inline-flex',
    flexShrink: 0,
    fontSize: 10.5,
    fontWeight: 800,
    gap: 5,
    minHeight: 28,
    padding: '5px 10px',
  },
  playIcon: { fontSize: 9, lineHeight: 1 },
  action: {
    ...overlayTextLinkButton,
    alignItems: 'center',
    display: 'inline-flex',
    flexShrink: 0,
    fontSize: 10,
    gap: 3,
    marginLeft: 'auto',
    padding: '4px 0',
    whiteSpace: 'nowrap',
  },
  analyticsIcon: { fontSize: 11, lineHeight: 1 },
}
