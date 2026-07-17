import type { CSSProperties } from 'react'
import { chatSeriesFromRollups, chartRollupSeries } from './chatActivityEmotes.ts'
import type { PulsePayload } from '../shared/messages.ts'
import { theme } from './theme.ts'

const MINI_HEAT_BARS = 12

export interface MiniDockProps {
  login: string
  payload: PulsePayload | null | undefined
  tracking: boolean
  isLive: boolean
  trackBusy: boolean
  sidebarFill?: boolean
  onExpand: () => void
  onHide: () => void
  onTrack?: () => void
}

export function MiniDock({
  login,
  payload,
  tracking,
  isLive,
  trackBusy,
  sidebarFill = false,
  onExpand,
  onHide,
  onTrack,
}: MiniDockProps) {
  const rollups = payload ? chartRollupSeries(payload) : []
  const heatValues = chatSeriesFromRollups(rollups).slice(-MINI_HEAT_BARS)
  const statusLabel = tracking
    ? isLive
      ? `Tracking ${login}`
      : `Tracking ${login}`
    : 'Not tracking'

  return (
    <section
      className="pulse-mini-dock"
      style={sidebarFill ? styles.shellSidebar : styles.shell}
      aria-label="StreamPulse mini dock"
    >
      <button
        type="button"
        className="pulse-mini-dock-main"
        style={styles.main}
        onClick={onExpand}
        title="Expand Pulse panel"
      >
        <BrandMark compact />
        <span style={styles.brand}>Pulse</span>
        <span style={tracking ? styles.statusLive : styles.statusIdle}>
          <span
            className={tracking && isLive ? 'pulse-live-dot' : undefined}
            style={tracking ? styles.dotLive : styles.dotIdle}
            aria-hidden
          />
          <span style={styles.statusText}>{statusLabel}</span>
        </span>
        <MiniHeatStrip values={heatValues} />
      </button>

      <div style={styles.actions} aria-label="Mini dock controls">
        {!tracking && onTrack ? (
          <button
            type="button"
            style={styles.trackButton}
            disabled={trackBusy}
            onClick={event => {
              event.stopPropagation()
              onTrack()
            }}
            title="Track this channel"
          >
            {trackBusy ? '…' : 'Track'}
          </button>
        ) : null}
        <button
          type="button"
          style={styles.iconButton}
          onClick={event => {
            event.stopPropagation()
            onExpand()
          }}
          title="Expand panel"
          aria-label="Expand panel"
        >
          <ExpandIcon />
        </button>
        <button
          type="button"
          style={styles.iconButton}
          onClick={event => {
            event.stopPropagation()
            onHide()
          }}
          title="Hide overlay"
          aria-label="Hide overlay"
        >
          <HideIcon />
        </button>
      </div>
    </section>
  )
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span style={compact ? styles.brandMarkCompact : styles.brandMark}>
      <span style={compact ? styles.brandDotCompact : styles.brandDot} />
    </span>
  )
}

function MiniHeatStrip({ values }: { values: number[] }) {
  const display = values.length > 0 ? values : Array.from({ length: MINI_HEAT_BARS }, () => 0)
  const max = Math.max(1, ...display)

  if (display.every(value => value <= 0)) {
    return (
      <div style={styles.heatEmpty} aria-hidden>
        {Array.from({ length: MINI_HEAT_BARS }, (_, index) => (
          <span key={index} style={styles.heatBarGhost} />
        ))}
      </div>
    )
  }

  return (
    <div style={styles.heatStrip} aria-hidden>
      {display.map((value, index) => {
        const hot = value >= max * 0.88 && max > 0
        return (
          <span
            key={`${index}-${value}`}
            className="pulse-bar-grow"
            style={{
              ...styles.heatBar,
              height: `${Math.max(18, Math.round((value / max) * 100))}%`,
              background: hot
                ? `linear-gradient(180deg, ${theme.rank1}, #fb7185)`
                : `linear-gradient(180deg, ${theme.accentSoft}, ${theme.accent})`,
              animationDelay: `${index * 16}ms`,
            }}
          />
        )
      })}
    </div>
  )
}

function ExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M4.5 2.5h7v7M11.5 2.5 2.5 11.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function HideIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3 3l8 8M11 3 3 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

const styles: Record<string, CSSProperties> = {
  shell: {
    alignItems: 'center',
    display: 'flex',
    gap: 8,
    height: '100%',
    minHeight: 52,
    padding: '6px 8px',
    width: '100%',
  },
  shellSidebar: {
    alignItems: 'center',
    display: 'flex',
    gap: 6,
    height: '100%',
    minHeight: 0,
    padding: '8px 10px',
    width: '100%',
  },
  main: {
    alignItems: 'center',
    background: theme.panel,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusPanel,
    color: theme.textPrimary,
    cursor: 'pointer',
    display: 'flex',
    flex: 1,
    font: theme.font,
    gap: 10,
    minWidth: 0,
    padding: '8px 12px',
    textAlign: 'left',
    transition: 'border-color 0.15s ease, background 0.15s ease',
  },
  brandMark: {
    alignItems: 'center',
    background: theme.accent,
    borderRadius: 10,
    display: 'inline-flex',
    flexShrink: 0,
    height: 34,
    justifyContent: 'center',
    minWidth: 34,
  },
  brandMarkCompact: {
    alignItems: 'center',
    background: theme.accent,
    borderRadius: 8,
    display: 'inline-flex',
    flexShrink: 0,
    height: 28,
    justifyContent: 'center',
    minWidth: 28,
  },
  brandDot: {
    background: theme.textPrimary,
    borderRadius: 999,
    display: 'block',
    height: 12,
    width: 12,
  },
  brandDotCompact: {
    background: theme.textPrimary,
    borderRadius: 999,
    display: 'block',
    height: 10,
    width: 10,
  },
  brand: {
    flexShrink: 0,
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: '-0.01em',
  },
  statusLive: {
    alignItems: 'center',
    color: theme.liveSoft,
    display: 'inline-flex',
    flexShrink: 1,
    fontSize: 11,
    fontWeight: 700,
    gap: 6,
    minWidth: 0,
  },
  statusIdle: {
    alignItems: 'center',
    color: theme.textMuted,
    display: 'inline-flex',
    flexShrink: 1,
    fontSize: 11,
    fontWeight: 600,
    gap: 6,
    minWidth: 0,
  },
  statusText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dotLive: {
    background: theme.live,
    borderRadius: 999,
    display: 'inline-block',
    flexShrink: 0,
    height: 7,
    width: 7,
  },
  dotIdle: {
    background: theme.textMuted,
    borderRadius: 999,
    display: 'inline-block',
    flexShrink: 0,
    height: 7,
    width: 7,
  },
  heatStrip: {
    alignItems: 'flex-end',
    display: 'flex',
    flex: '1 1 96px',
    gap: 3,
    height: 28,
    justifyContent: 'flex-end',
    marginLeft: 'auto',
    maxWidth: 168,
    minWidth: 72,
  },
  heatEmpty: {
    alignItems: 'flex-end',
    display: 'flex',
    flex: '1 1 96px',
    gap: 3,
    height: 28,
    justifyContent: 'flex-end',
    marginLeft: 'auto',
    maxWidth: 168,
    minWidth: 72,
  },
  heatBar: {
    borderRadius: 3,
    display: 'block',
    flex: '1 1 4px',
    maxWidth: 8,
    minWidth: 3,
    transformOrigin: 'bottom center',
  },
  heatBarGhost: {
    background: 'rgba(139, 92, 246, 0.14)',
    borderRadius: 3,
    display: 'block',
    flex: '1 1 4px',
    height: '22%',
    maxWidth: 8,
    minWidth: 3,
  },
  actions: {
    alignItems: 'center',
    display: 'flex',
    flexShrink: 0,
    gap: 2,
  },
  trackButton: {
    background: 'rgba(139, 92, 246, 0.16)',
    border: `1px solid ${theme.borderAccent}`,
    borderRadius: theme.radiusButton,
    color: theme.accentSoft,
    cursor: 'pointer',
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.04em',
    padding: '6px 8px',
    textTransform: 'uppercase',
  },
  iconButton: {
    alignItems: 'center',
    background: 'transparent',
    border: 0,
    borderRadius: 7,
    color: theme.textMuted,
    cursor: 'pointer',
    display: 'inline-flex',
    height: 28,
    justifyContent: 'center',
    padding: 0,
    width: 28,
  },
}
