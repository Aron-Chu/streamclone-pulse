import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { displayMomentReasonLabel, formatMomentClock, type LiveHeatPoint } from '@streampulse/pulse-core'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { formatSelectedMomentActivity } from './momentActivity.ts'
import { momentReasonLabelStyle, overlayGhostChipButton } from './momentReasonStyles.ts'
import { formatCount } from './mostReacted.ts'
import { theme } from './theme.ts'

export interface SelectedMomentCardProps {
  point: LiveHeatPoint
  backendUrl: string
  onJump: (point: LiveHeatPoint) => void
  onSave?: (point: LiveHeatPoint) => void
  onAnalytics: (point: LiveHeatPoint) => void
  onClear?: () => void
  saveBusy?: boolean
  jumpLabel?: string
  compact?: boolean
}

export function SelectedMomentCard({
  point,
  backendUrl,
  onJump,
  onSave,
  onAnalytics,
  onClear,
  saveBusy = false,
  jumpLabel = 'Jump',
  compact = false,
}: SelectedMomentCardProps) {
  const offsetLabel = formatMomentClock(point)
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
  }, [point.offsetSeconds])

  return (
    <div
      style={compact ? styles.compactWrap : styles.wrap}
      className={
        [
          entering ? 'pulse-moment-card-enter' : undefined,
          pulse ? 'pulse-moment-card-pulse' : undefined,
        ]
          .filter(Boolean)
          .join(' ') || undefined
      }
      aria-label={`Selected moment at ${offsetLabel}`}
    >
      <div className={swapping ? 'pulse-moment-card-swap' : undefined} style={compact ? styles.compactBody : undefined}>
        <div style={compact ? styles.compactHeader : styles.header}>
          <span style={styles.kicker}>Selected moment</span>
          <span style={styles.offset}>{offsetLabel}</span>
          {onClear ? (
            <button
              type="button"
              style={styles.close}
              aria-label="Clear selected moment"
              title="Clear selected moment"
              onPointerDown={event => event.stopPropagation()}
              onClick={onClear}
            >
              ×
            </button>
          ) : null}
        </div>
        <p style={{
          ...(compact ? styles.compactReason : styles.reason),
          ...momentReasonLabelStyle(point.reason, point.reasonLabel, compact ? 'sm' : 'md'),
        }}>
          {displayMomentReasonLabel(point.reason, point.reasonLabel)}
        </p>
        <p style={compact ? styles.compactCounts : styles.counts}>
          {formatSelectedMomentActivity(point)}
        </p>
        {!compact && point.topEmotes.length > 0 ? (
          <ul style={styles.list}>
            {point.topEmotes.map(emote => (
              <li key={emote.key} style={styles.item}>
                <PulseEmoteImg emote={emote} backendUrl={backendUrl} width={18} height={18} style={styles.img} />
                <span style={styles.name}>{emote.name}</span>
                <span style={styles.uses}>{formatCount(emote.count)} uses</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div style={compact ? styles.compactActions : styles.actions}>
          <button
            type="button"
            className="pulse-action-chip pulse-action-chip-primary"
            style={styles.actionPrimary}
            onPointerDown={event => event.stopPropagation()}
            onClick={() => onJump(point)}
          >
            {jumpLabel}
          </button>
          {!compact && onSave ? (
            <button
              type="button"
              className="pulse-action-chip"
              style={styles.action}
              disabled={saveBusy}
              onPointerDown={event => event.stopPropagation()}
              onClick={() => onSave(point)}
            >
              {saveBusy ? 'Saving…' : 'Save'}
            </button>
          ) : null}
          <button
            type="button"
            className="pulse-action-chip"
            style={styles.action}
            onPointerDown={event => event.stopPropagation()}
            onClick={() => onAnalytics(point)}
          >
            {compact ? 'Analytics' : 'Open Analytics'}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    background: 'rgba(255, 255, 255, 0.025)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 8,
    marginBottom: 8,
    minHeight: 132,
    padding: '10px 12px',
  },
  compactWrap: {
    alignItems: 'stretch',
    background: 'rgba(255, 255, 255, 0.025)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 8,
    boxSizing: 'border-box',
    height: 72,
    minHeight: 72,
    overflow: 'hidden',
    padding: '7px 9px',
  },
  compactBody: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gridTemplateRows: '16px 17px 22px',
    minWidth: 0,
  },
  header: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  compactHeader: {
    alignItems: 'center',
    display: 'flex',
    gap: 7,
    gridColumn: '1 / -1',
    minWidth: 0,
  },
  kicker: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  offset: {
    color: theme.textPrimary,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 800,
  },
  reason: { fontWeight: 700, margin: '4px 0 0' },
  compactReason: {
    alignSelf: 'center',
    margin: 0,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  counts: { color: theme.textSecondary, fontSize: 11, fontWeight: 600, margin: '2px 0 8px' },
  compactCounts: {
    alignSelf: 'center',
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 600,
    gridColumn: 2,
    gridRow: 2,
    margin: 0,
    minWidth: 0,
    overflow: 'hidden',
    textAlign: 'right',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  list: { display: 'grid', gap: 6, listStyle: 'none', margin: '0 0 10px', padding: 0 },
  item: { alignItems: 'center', display: 'flex', gap: 8 },
  img: { display: 'block', objectFit: 'contain' },
  name: { color: theme.textPrimary, flex: 1, fontSize: 12, fontWeight: 700 },
  uses: { color: theme.textMuted, fontSize: 11, fontVariantNumeric: 'tabular-nums' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  compactActions: {
    alignItems: 'center',
    display: 'flex',
    gap: 4,
    gridColumn: '1 / -1',
    gridRow: 3,
    minWidth: 0,
  },
  close: {
    background: 'transparent',
    border: 0,
    color: theme.textMuted,
    cursor: 'pointer',
    fontSize: 15,
    lineHeight: 1,
    marginLeft: 'auto',
    padding: '0 2px',
  },
  actionPrimary: {
    ...overlayGhostChipButton,
    background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.12)',
    borderColor: 'rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.28)',
    color: theme.accentInk,
    fontSize: 10,
    fontWeight: 800,
  },
  action: {
    ...overlayGhostChipButton,
    fontSize: 10,
  },
}
