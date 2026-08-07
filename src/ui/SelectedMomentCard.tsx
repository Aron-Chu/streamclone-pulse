import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { displayMomentReasonLabel, formatHeatOffset, type LiveHeatPoint } from '@streampulse/pulse-core'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { formatSelectedMomentActivity } from './momentActivity.ts'
import { momentReasonLabelStyle, overlayGhostChipButton } from './momentReasonStyles.ts'
import { formatCount } from './mostReacted.ts'
import { theme } from './theme.ts'
import { sevenTvEmoteUrl } from '../shared/emoteUrl.ts'

export interface SelectedMomentCardProps {
  point: LiveHeatPoint
  backendUrl: string
  onJump: (point: LiveHeatPoint) => void | Promise<void>
  onAnalytics: (point: LiveHeatPoint) => void
  jumpLabel?: string
  jumpDisabled?: boolean
  jumpHint?: string
}

export function SelectedMomentCard({
  point,
  backendUrl,
  onJump,
  onAnalytics,
  jumpLabel = 'Jump',
  jumpDisabled = false,
  jumpHint,
}: SelectedMomentCardProps) {
  const offsetLabel = formatHeatOffset(point.offsetSeconds)
  const jumpHintId = `pulse-jump-hint-${Math.round(point.offsetSeconds)}`
  const [localJumpBusy, setLocalJumpBusy] = useState(false)
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
      aria-label={`${point.estimated ? 'Selected minute' : 'Selected moment'} at ${offsetLabel}`}
    >
      <div className={swapping ? 'pulse-moment-card-swap' : undefined}>
        <div style={styles.header}>
          <span style={styles.kicker}>
            {point.estimated ? 'Selected minute' : 'Selected moment'}
          </span>
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
                {sevenTvEmoteUrlFor(emote.provider, emote.providerEmoteId) ? (
                  <a
                    href={sevenTvEmoteUrlFor(emote.provider, emote.providerEmoteId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.emoteLink}
                    title={`Open ${emote.name} on 7TV`}
                    aria-label={`Open 7TV emote ${emote.name}`}
                    onPointerDown={event => event.stopPropagation()}
                    onClick={event => event.stopPropagation()}
                  >
                    <PulseEmoteImg emote={emote} backendUrl={backendUrl} width={18} height={18} style={styles.img} />
                    <span style={styles.name} title={emote.name}>{emote.name}</span>
                  </a>
                ) : (
                  <>
                    <PulseEmoteImg emote={emote} backendUrl={backendUrl} width={18} height={18} style={styles.img} />
                    <span style={styles.name} title={emote.name}>{emote.name}</span>
                  </>
                )}
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
            disabled={localJumpBusy || jumpDisabled}
            aria-busy={localJumpBusy}
            aria-describedby={jumpHint ? jumpHintId : undefined}
            onPointerDown={event => event.stopPropagation()}
            onClick={() => {
              if (localJumpBusy || jumpDisabled) return
              setLocalJumpBusy(true)
              void (async () => {
                try {
                  await onJump(point)
                } finally {
                  setLocalJumpBusy(false)
                }
              })()
            }}
          >
            {localJumpBusy ? 'Jumping…' : jumpLabel}
          </button>
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
        {jumpHint ? (
          <p id={jumpHintId} style={styles.jumpHint} data-jump-availability>
            {jumpHint}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function sevenTvEmoteUrlFor(provider: string | undefined, providerEmoteId: string | undefined): string | undefined {
  const normalized = provider?.trim().toLowerCase()
  return normalized === '7tv' || normalized === 'seventv' ? sevenTvEmoteUrl(providerEmoteId) : undefined
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    background: theme.panel,
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    marginBottom: 8,
    minHeight: 132,
    minWidth: 0,
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
  item: { alignItems: 'center', display: 'flex', gap: 8, minWidth: 0 },
  emoteLink: {
    alignItems: 'center',
    color: 'inherit',
    display: 'flex',
    flex: 1,
    gap: 8,
    minWidth: 0,
    overflow: 'hidden',
    textDecoration: 'none',
  },
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
  uses: { color: theme.textMuted, flexShrink: 0, fontSize: 11, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  actions: { display: 'flex', flexWrap: 'nowrap', gap: 6, alignItems: 'center' },
  jumpHint: {
    color: theme.textMuted,
    fontSize: 9,
    lineHeight: 1.35,
    margin: '6px 0 0',
  },
  actionPrimary: {
    ...overlayGhostChipButton,
    background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.12)',
    borderColor: 'rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.28)',
    color: theme.accentText,
    fontSize: 10,
    fontWeight: 800,
  },
  action: {
    ...overlayGhostChipButton,
    fontSize: 10,
  },
}
