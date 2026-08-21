import type { CSSProperties } from 'react'
import { formatHeatOffset, floorOffsetToMinute } from '@streampulse/pulse-core'
import type { ExtensionRollup } from '../shared/messages.ts'
import { minuteEmoteTotal } from './chartRollupUtils.ts'
import { overlayGhostChipButton, overlayTextLinkButton } from './momentReasonStyles.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { theme } from './theme.ts'

export interface ChartMinuteInspectCardProps {
  rollup: ExtensionRollup
  backendUrl: string
  jumpLabel?: string
  jumpDisabled?: boolean
  onJump?: (offsetSeconds: number) => void
  onAnalytics?: (offsetSeconds: number) => void
  onClose: () => void
}

export function ChartMinuteInspectCard({
  rollup,
  backendUrl,
  jumpLabel = 'VOD',
  jumpDisabled = false,
  onJump,
  onAnalytics,
  onClose,
}: ChartMinuteInspectCardProps) {
  const jumpOffsetSeconds = floorOffsetToMinute(rollup.offsetSeconds)
  const timeLabel = formatHeatOffset(jumpOffsetSeconds)
  const emoteTotal = minuteEmoteTotal(rollup)
  const emotes = (rollup.topEmotes ?? []).slice(0, 3)

  return (
    <div style={styles.wrap} data-chart-minute-card="true">
      <span style={styles.accent} aria-hidden="true" />
      <div style={styles.body}>
        <div style={styles.top}>
          <span style={styles.time}>{timeLabel}</span>
          {emotes.length > 0 ? (
            <span style={styles.emotes}>
              {emotes.map(emote => (
                <PulseEmoteImg
                  key={`${emote.id ?? emote.name}:${emote.count}`}
                  emote={emote}
                  backendUrl={backendUrl}
                  width={18}
                  height={18}
                  style={styles.emoteImg}
                />
              ))}
            </span>
          ) : null}
          {onJump ? (
            <button
              type="button"
              className="pulse-action-chip"
              style={styles.jump}
              disabled={jumpDisabled}
              data-seek-offset={jumpOffsetSeconds}
              onClick={() => onJump(jumpOffsetSeconds)}
            >
              {jumpLabel}
            </button>
          ) : null}
          {onAnalytics ? (
            <button
              type="button"
              style={styles.analytics}
              onClick={() => onAnalytics(jumpOffsetSeconds)}
            >
              Analytics
            </button>
          ) : null}
          <button
            type="button"
            style={styles.close}
            aria-label="Close selection"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p style={styles.counts}>
          {rollup.chatCount} chat · {emoteTotal} emotes
        </p>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    alignItems: 'stretch',
    background: theme.panel,
    border: `1px solid ${theme.border}`,
    borderRadius: 10,
    display: 'flex',
    gap: 8,
    marginTop: 8,
    minWidth: 0,
    overflow: 'hidden',
    padding: '8px 10px 8px 0',
  },
  accent: {
    background: theme.accent2,
    borderRadius: 999,
    flexShrink: 0,
    margin: '2px 0 2px 8px',
    width: 3,
  },
  body: { display: 'grid', flex: 1, gap: 2, minWidth: 0 },
  top: {
    alignItems: 'center',
    display: 'flex',
    gap: 8,
    minWidth: 0,
  },
  time: {
    color: theme.textPrimary,
    flexShrink: 0,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 800,
  },
  emotes: {
    alignItems: 'center',
    display: 'inline-flex',
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  emoteImg: { display: 'block', flexShrink: 0, objectFit: 'contain' },
  jump: {
    ...overlayGhostChipButton,
    flexShrink: 0,
    fontSize: 10,
    fontWeight: 800,
    padding: '3px 8px',
  },
  analytics: {
    ...overlayTextLinkButton,
    flexShrink: 0,
    fontSize: 11,
  },
  close: {
    background: 'transparent',
    border: 0,
    color: theme.textMuted,
    cursor: 'pointer',
    flexShrink: 0,
    fontSize: 16,
    lineHeight: 1,
    padding: '0 2px',
  },
  counts: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: 600,
    margin: 0,
  },
}
