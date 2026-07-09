import type { CSSProperties } from 'react'
import { formatHeatOffset, type LiveHeatReason } from '@streampulse/pulse-core'
import type { ExtensionEmote } from '../shared/messages.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { formatCount } from './mostReacted.ts'
import { formatSelectedMomentActivity } from './momentActivity.ts'
import { overlayGhostChipButton, overlayTextLinkButton } from './momentReasonStyles.ts'
import { theme } from './theme.ts'

function formatInspectorActivity(args: {
  chatCount?: number
  emoteCount?: number
  viewerCount?: number
  viewerDelta?: number
  reason?: LiveHeatReason | string
}): string {
  return formatSelectedMomentActivity({
    reason: (args.reason ?? 'manual') as LiveHeatReason,
    chatCount: args.chatCount ?? 0,
    emoteCount: args.emoteCount ?? 0,
    viewerCount: args.viewerCount,
    viewerDelta: args.viewerDelta,
  })
}

export interface ChatActivityInspectorProps {
  open: boolean
  backendUrl: string
  offsetSeconds: number | null
  emotes: ExtensionEmote[]
  chatCount?: number
  emoteCount?: number
  viewerCount?: number
  viewerDelta?: number
  reason?: LiveHeatReason | string
  onJump?: () => void
  onAnalytics?: () => void
  onClear: () => void
  variant?: 'inline' | 'overlay' | 'compact'
  jumpLabel?: string
}

export function ChatActivityInspector({
  open,
  backendUrl,
  offsetSeconds,
  emotes,
  chatCount = 0,
  emoteCount = 0,
  viewerCount,
  viewerDelta,
  reason,
  onJump,
  onAnalytics,
  onClear,
  variant = 'inline',
  jumpLabel = 'Jump',
}: ChatActivityInspectorProps) {
  if (!open || offsetSeconds == null) return null

  const title = `Minute at ${formatHeatOffset(offsetSeconds)}`
  const topEmotes = emotes.slice(0, 3)
  const activityLine = formatInspectorActivity({ chatCount, emoteCount, viewerCount, viewerDelta, reason })

  if (variant === 'compact') {
    return (
      <div className="pulse-animate-in" style={styles.panelCompact}>
        <div style={styles.compactAccent} aria-hidden="true" />
        <div style={styles.compactRow}>
          <div style={styles.compactCopy}>
            <span style={styles.compactTime}>{formatHeatOffset(offsetSeconds)}</span>
            <span style={styles.compactCounts}>{activityLine}</span>
          </div>
          {topEmotes.length > 0 ? (
            <div style={styles.compactChips} aria-label="Top emotes this minute">
              {topEmotes.map((emote, index) => (
                <span key={emote.id ?? `${emote.name}-${index}`} style={styles.compactChip}>
                  <PulseEmoteImg
                    emote={emote}
                    backendUrl={backendUrl}
                    width={16}
                    height={16}
                    style={styles.img}
                  />
                </span>
              ))}
            </div>
          ) : null}
          <div style={styles.compactActions}>
            {onJump ? (
              <button
                type="button"
                style={styles.compactActionGhost}
                onMouseDown={event => event.stopPropagation()}
                onClick={event => {
                  event.stopPropagation()
                  onJump()
                }}
              >
                {jumpLabel}
              </button>
            ) : null}
            {onAnalytics ? (
              <button
                type="button"
                style={styles.compactActionLink}
                onMouseDown={event => event.stopPropagation()}
                onClick={event => {
                  event.stopPropagation()
                  onAnalytics()
                }}
              >
                Analytics
              </button>
            ) : null}
            <button type="button" style={styles.compactClose} onClick={onClear} aria-label="Clear chart selection">
              ×
            </button>
          </div>
        </div>
      </div>
    )
  }

  const panelStyle = variant === 'overlay' ? styles.panelOverlay : styles.panel

  if (variant === 'overlay') {
    return (
      <div style={panelStyle}>
        <div style={styles.overlayRow}>
          <div style={styles.overlayCopy}>
            <span style={styles.overlayTitle}>{title}</span>
            <span style={styles.overlayCounts}>{activityLine}</span>
          </div>
          {topEmotes.length > 0 ? (
            <div style={styles.overlayChips} aria-label="Top emotes this minute">
              {topEmotes.map((emote, index) => (
                <span key={emote.id ?? `${emote.name}-${index}`} style={styles.overlayChip}>
                  <PulseEmoteImg emote={emote} backendUrl={backendUrl} width={18} height={18} style={styles.img} />
                  <span style={styles.overlayChipCount}>{formatCount(emote.count)}</span>
                </span>
              ))}
            </div>
          ) : (
            <span style={styles.overlayEmpty}>No emotes yet</span>
          )}
          <div style={styles.overlayActions}>
            {onJump ? (
              <button type="button" style={styles.overlayActionGhost} onClick={onJump}>
                {jumpLabel}
              </button>
            ) : null}
            {onAnalytics ? (
              <button type="button" style={styles.overlayActionPrimary} onClick={onAnalytics}>
                Open analytics
              </button>
            ) : null}
            <button type="button" style={styles.overlayClose} onClick={onClear} aria-label="Clear chart selection">
              ×
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={panelStyle}>
      <div style={styles.header}>
        <div style={styles.headerCopy}>
          <span style={styles.title}>{title}</span>
          <span style={styles.subtitle}>{activityLine} this minute</span>
        </div>
        <button type="button" style={styles.closeButton} onClick={onClear} aria-label="Clear chart selection">
          ×
        </button>
      </div>

      {emotes.length > 0 ? (
        <ul style={styles.list}>
          {emotes.map((emote, index) => (
            <li key={emote.id ?? `${emote.name}-${index}`} className="pulse-inspector-emote-row" style={styles.item}>
              <span style={styles.rank}>{index + 1}</span>
              <PulseEmoteImg emote={emote} backendUrl={backendUrl} width={22} height={22} style={styles.img} />
              <span style={styles.name}>{emote.name}</span>
              <span style={styles.count}>{formatCount(emote.count)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={styles.empty}>No emote breakdown for this minute yet.</p>
      )}

      <div style={styles.actions}>
        {onJump ? (
          <button type="button" style={styles.actionGhost} onClick={onJump}>
            {jumpLabel}
          </button>
        ) : null}
        {onAnalytics ? (
          <button type="button" style={styles.actionPrimary} onClick={onAnalytics}>
            Open analytics
          </button>
        ) : null}
        <button type="button" style={styles.actionGhost} onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  panel: {
    background: 'rgba(24, 24, 31, 0.92)',
    border: '1px solid rgba(167, 139, 250, 0.28)',
    borderRadius: 10,
    marginTop: 8,
    overflow: 'hidden',
  },
  panelCompact: {
    background: 'rgba(255, 255, 255, 0.025)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    display: 'flex',
    marginTop: 6,
    overflow: 'hidden',
    pointerEvents: 'auto',
    position: 'relative',
    zIndex: 2,
  },
  compactAccent: {
    background: 'rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.55)',
    flexShrink: 0,
    width: 2,
  },
  compactRow: {
    alignItems: 'center',
    display: 'flex',
    flex: 1,
    gap: 8,
    justifyContent: 'space-between',
    minHeight: 38,
    minWidth: 0,
    padding: '7px 10px',
  },
  compactCopy: {
    display: 'grid',
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  compactTime: {
    color: theme.textPrimary,
    fontSize: 11,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 800,
    whiteSpace: 'nowrap',
  },
  compactCounts: {
    color: theme.textSecondary,
    fontSize: 10,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  compactChips: {
    alignItems: 'center',
    display: 'inline-flex',
    flexShrink: 0,
    gap: 3,
  },
  compactChip: {
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 4,
    display: 'inline-flex',
    padding: 1,
  },
  compactActions: {
    alignItems: 'center',
    display: 'inline-flex',
    flexShrink: 0,
    gap: 4,
  },
  compactClose: {
    background: 'transparent',
    border: 0,
    color: theme.textMuted,
    cursor: 'pointer',
    fontSize: 15,
    fontWeight: 700,
    lineHeight: 1,
    padding: '2px 4px',
  },
  compactActionGhost: {
    ...overlayGhostChipButton,
    fontSize: 9,
    padding: '3px 7px',
  },
  compactActionLink: {
    ...overlayTextLinkButton,
    fontSize: 10,
    fontWeight: 800,
  },
  panelOverlay: {
    backdropFilter: 'blur(8px)',
    background: 'rgba(13, 13, 18, 0.94)',
    border: '1px solid rgba(167, 139, 250, 0.35)',
    borderRadius: 8,
    bottom: 4,
    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.4)',
    left: 4,
    maxHeight: 72,
    overflow: 'hidden',
    pointerEvents: 'auto',
    position: 'absolute',
    right: 4,
    zIndex: 4,
  },
  overlayRow: {
    alignItems: 'center',
    display: 'flex',
    gap: 8,
    minHeight: 56,
    padding: '6px 8px',
  },
  overlayCopy: {
    display: 'grid',
    flexShrink: 0,
    gap: 2,
    minWidth: 0,
  },
  overlayTitle: {
    color: theme.textPrimary,
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  overlayCounts: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  overlayChips: {
    alignItems: 'center',
    display: 'flex',
    flex: 1,
    gap: 6,
    justifyContent: 'center',
    minWidth: 0,
    overflow: 'hidden',
  },
  overlayChip: {
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    display: 'inline-flex',
    flexShrink: 0,
    gap: 4,
    padding: '3px 6px',
  },
  overlayChipCount: {
    color: '#c4b5fd',
    fontSize: 10,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 800,
  },
  overlayEmpty: {
    color: theme.textMuted,
    flex: 1,
    fontSize: 9,
    fontWeight: 600,
    textAlign: 'center',
  },
  overlayActions: {
    alignItems: 'center',
    display: 'inline-flex',
    flexShrink: 0,
    gap: 4,
  },
  overlayAction: {
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 6,
    color: theme.textSecondary,
    cursor: 'pointer',
    fontSize: 9,
    fontWeight: 700,
    padding: '4px 7px',
    whiteSpace: 'nowrap',
  },
  overlayActionGhost: {
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 6,
    color: theme.textSecondary,
    cursor: 'pointer',
    fontSize: 9,
    fontWeight: 700,
    padding: '4px 7px',
    whiteSpace: 'nowrap',
  },
  overlayActionPrimary: {
    background: 'rgba(139, 92, 246, 0.18)',
    border: '1px solid rgba(167, 139, 250, 0.35)',
    borderRadius: 6,
    color: '#ddd6fe',
    cursor: 'pointer',
    fontSize: 9,
    fontWeight: 800,
    padding: '4px 8px',
    whiteSpace: 'nowrap',
  },
  overlayClose: {
    background: 'transparent',
    border: 0,
    color: theme.textSecondary,
    cursor: 'pointer',
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1,
    padding: '2px 4px',
  },
  header: {
    alignItems: 'flex-start',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    display: 'flex',
    gap: 8,
    justifyContent: 'space-between',
    padding: '8px 10px',
  },
  headerCopy: { display: 'grid', gap: 3, minWidth: 0 },
  title: {
    color: theme.textPrimary,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  subtitle: { color: theme.textMuted, fontSize: 10, fontWeight: 600, lineHeight: 1.35 },
  closeButton: {
    background: 'transparent',
    border: 0,
    color: theme.textSecondary,
    cursor: 'pointer',
    fontSize: 18,
    fontWeight: 700,
    lineHeight: 1,
    padding: '0 4px',
  },
  list: {
    display: 'grid',
    gap: 4,
    listStyle: 'none',
    margin: 0,
    maxHeight: 96,
    overflowY: 'auto',
    padding: '8px 10px 0',
  },
  item: { alignItems: 'center', display: 'grid', gap: 8, gridTemplateColumns: '18px 22px 1fr auto' },
  rank: { color: theme.textMuted, fontSize: 10, fontWeight: 800, textAlign: 'right' },
  img: { display: 'block', objectFit: 'contain' },
  name: { color: theme.textPrimary, fontSize: 12, fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  count: { color: '#c4b5fd', fontSize: 11, fontVariantNumeric: 'tabular-nums', fontWeight: 800 },
  empty: { color: theme.textMuted, fontSize: 10, fontWeight: 600, margin: '8px 10px 0', padding: 0 },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    padding: '8px 10px 10px',
  },
  actionPrimary: {
    background: 'rgba(139, 92, 246, 0.22)',
    border: '1px solid rgba(167, 139, 250, 0.45)',
    borderRadius: 8,
    color: '#ede9fe',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 800,
    padding: '6px 10px',
  },
  action: {
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 8,
    color: theme.textSecondary,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
    padding: '6px 10px',
  },
  actionGhost: {
    background: 'transparent',
    border: 0,
    color: theme.textMuted,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
    marginLeft: 'auto',
    padding: '6px 4px',
  },
}
