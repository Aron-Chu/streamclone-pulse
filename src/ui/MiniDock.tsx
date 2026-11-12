import type { CSSProperties } from 'react'
import { displayMomentReasonLabel, momentClockDisplay, type LiveHeatPoint } from '@streampulse/pulse-core'
import { chatSeriesFromRollups, chartRollupSeries } from './chatActivityEmotes.ts'
import type { PulsePayload } from '../shared/messages.ts'
import { momentReasonLabelStyle } from './momentReasonStyles.ts'
import { theme } from './theme.ts'
import { SettingsGearIcon } from './SettingsGearIcon.tsx'

const MINI_HEAT_BARS = 12

export interface MiniDockProps {
  login: string
  payload: PulsePayload | null | undefined
  tracking: boolean
  isLive: boolean
  trackBusy: boolean
  sidebarFill?: boolean
  onExpand: () => void
  onSettings: () => void
  onHide: () => void
  onTrack?: () => void
  /** The first row of the panel's Top moments list, when the panel would show it. */
  topMoment?: LiveHeatPoint | null
  /** Does what the Top moments card's Jump does. */
  onJumpTopMoment?: (point: LiveHeatPoint) => void
}

export function MiniDock({
  login,
  payload,
  tracking,
  isLive,
  trackBusy,
  sidebarFill = false,
  onExpand,
  onSettings,
  onHide,
  onTrack,
  topMoment = null,
  onJumpTopMoment,
}: MiniDockProps) {
  const rollups = payload ? chartRollupSeries(payload) : []
  const heatValues = chatSeriesFromRollups(rollups).slice(-MINI_HEAT_BARS)
  // The dock sits on the channel's own page, so the name only goes in the tooltip.
  const statusLabel = tracking ? 'Tracking' : 'Not tracking'
  const statusTitle = tracking ? `Tracking ${login}` : `Not tracking ${login}`
  // The list row's reason line; a row without one shows none here either.
  const topDetail = topMoment ? displayMomentReasonLabel(topMoment.reason, topMoment.reasonLabel) : ''

  return (
    <section
      className={sidebarFill ? 'pulse-mini-dock pulse-mini-dock-sidebar' : 'pulse-mini-dock'}
      aria-label="StreamPulse mini dock"
    >
      <button
        type="button"
        className="pulse-mini-dock-main"
        onClick={onExpand}
        title="Expand Pulse panel"
      >
        <BrandMark compact />
        {topMoment ? (
          // Two lines, so the time never ellipses away in the narrow sidebar dock.
          <span className="pulse-mini-moment" data-mini-top-moment="true">
            <span className="pulse-mini-moment-label">Top moment</span>
            <span className="pulse-mini-moment-detail">
              <span className="pulse-mini-moment-time">{momentClockDisplay(topMoment).text}</span>
              {topDetail ? (
                <>
                  {' · '}
                  <span style={momentReasonLabelStyle(topMoment.reason, topMoment.reasonLabel)}>{topDetail}</span>
                </>
              ) : null}
            </span>
          </span>
        ) : (
          <>
            <span className="pulse-mini-brand">Pulse</span>
            <span className={tracking ? 'pulse-mini-status pulse-mini-status-live' : 'pulse-mini-status'}>
              <span
                className={`pulse-mini-dot${tracking ? ' pulse-mini-dot-live' : ''}${tracking && isLive ? ' pulse-live-dot' : ''}`}
                aria-hidden
              />
              <span className="pulse-mini-status-text" title={statusTitle}>{statusLabel}</span>
            </span>
            <MiniHeatStrip values={heatValues} />
          </>
        )}
      </button>

      <div className="pulse-mini-dock-actions" aria-label="Mini dock controls">
        {topMoment && onJumpTopMoment ? (
          <button
            type="button"
            style={JUMP_BUTTON_STYLE}
            data-mini-top-moment-jump="true"
            onClick={event => {
              event.stopPropagation()
              onJumpTopMoment(topMoment)
            }}
            title="Jump to the top moment"
          >
            <PlayIcon />
            Jump
          </button>
        ) : null}
        {!tracking && onTrack ? (
          <button
            type="button"
            style={styles.chipButton}
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
          className="pulse-settings-gear-btn"
          style={styles.iconButton}
          onClick={event => {
            event.stopPropagation()
            onSettings()
          }}
          title="Open settings"
          aria-label="Open settings"
        >
          <SettingsGearIcon size={14} />
        </button>
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
    <span className={compact ? 'pulse-mini-brand-mark pulse-mini-brand-mark-compact' : 'pulse-mini-brand-mark'}>
      <span className={compact ? 'pulse-mini-brand-dot pulse-mini-brand-dot-compact' : 'pulse-mini-brand-dot'} />
    </span>
  )
}

function MiniHeatStrip({ values }: { values: number[] }) {
  const display = values.length > 0 ? values : Array.from({ length: MINI_HEAT_BARS }, () => 0)
  const max = Math.max(1, ...display)

  if (display.every(value => value <= 0)) {
    return (
      <div className="pulse-mini-heat" aria-hidden>
        {Array.from({ length: MINI_HEAT_BARS }, (_, index) => (
          <span key={index} className="pulse-mini-heat-ghost" />
        ))}
      </div>
    )
  }

  return (
    <div className="pulse-mini-heat" aria-hidden>
      {display.map((value, index) => {
        const hot = value >= max * 0.88 && max > 0
        return (
          <span
            key={`${index}-${value}`}
            className="pulse-bar-grow pulse-mini-heat-bar"
            style={{
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

function PlayIcon() {
  return (
    <svg width="9" height="10" viewBox="0 0 9 10" fill="none" aria-hidden>
      <path d="M1.5 1.6v6.8a.6.6 0 0 0 .9.5l5.5-3.4a.6.6 0 0 0 0-1L2.4 1.1a.6.6 0 0 0-.9.5Z" fill="currentColor" />
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

// Inline on purpose: as classes, the `.pulse-mini-dock button[title]` hover
// rule would start tinting these buttons.
const styles: Record<string, CSSProperties> = {
  chipButton: {
    background: 'rgba(139, 92, 246, 0.16)',
    border: `1px solid ${theme.borderAccent}`,
    borderRadius: theme.radiusButton,
    color: theme.accentSoft,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 800,
    padding: '6px 8px',
    whiteSpace: 'nowrap',
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

// The chip look, with room for the play icon beside the label.
const JUMP_BUTTON_STYLE: CSSProperties = { ...styles.chipButton, alignItems: 'center', display: 'inline-flex', gap: 5 }
