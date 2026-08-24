import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { displayMomentReasonLabel, formatHeatOffset, type LiveHeatPoint } from '@streampulse/pulse-core'
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
  saveBusy?: boolean
  jumpLabel?: string
}

export function SelectedMomentCard({
  point,
  backendUrl,
  onJump,
  onSave,
  onAnalytics,
  saveBusy = false,
  jumpLabel = 'Jump',
}: SelectedMomentCardProps) {
  const offsetLabel = formatHeatOffset(point.offsetSeconds)
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
      style={styles.wrap}
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
      <div className={swapping ? 'pulse-moment-card-swap' : undefined}>
        <div style={styles.header}>
          <span style={styles.kicker}>Selected moment</span>
          <span style={styles.offset}>{offsetLabel}</span>
        </div>
        <p style={{ ...styles.reason, ...momentReasonLabelStyle(point.reason, point.reasonLabel, 'md') }}>
          {displayMomentReasonLabel(point.reason, point.reasonLabel)}
        </p>
        <p style={styles.counts}>
          {formatSelectedMomentActivity(point)}
        </p>
        {point.topEmotes.length > 0 ? (
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
        <div style={styles.actions}>
          <button
            type="button"
            className="pulse-action-chip pulse-action-chip-primary"
            style={styles.actionPrimary}
            onPointerDown={event => event.stopPropagation()}
            onClick={() => onJump(point)}
          >
            {jumpLabel}
          </button>
          {onSave ? (
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
            Open Analytics
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
  header: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
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
  counts: { color: theme.textSecondary, fontSize: 11, fontWeight: 600, margin: '2px 0 8px' },
  list: { display: 'grid', gap: 6, listStyle: 'none', margin: '0 0 10px', padding: 0 },
  item: { alignItems: 'center', display: 'flex', gap: 8 },
  img: { display: 'block', objectFit: 'contain' },
  name: { color: theme.textPrimary, flex: 1, fontSize: 12, fontWeight: 700 },
  uses: { color: theme.textMuted, fontSize: 11, fontVariantNumeric: 'tabular-nums' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 6 },
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
