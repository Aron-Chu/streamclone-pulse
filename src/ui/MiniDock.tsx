import { useEffect, useRef, useState } from 'react'
import { displayMomentReasonLabel, formatMomentClock, momentClockDisplay, type LiveHeatPoint } from '@streampulse/pulse-core'
import { chatSeriesFromRollups, chartRollupSeries } from './chatActivityEmotes.ts'
import type { PulsePayload } from '../shared/messages.ts'
import { momentReasonLabelStyle } from './momentReasonStyles.ts'
import { theme } from './theme.ts'
import { SettingsGearIcon } from './SettingsGearIcon.tsx'
import { MomentTime } from './MomentTime.tsx'
import type { JumpNote, JumpPromise, JumpResult } from './jumpMomentAction.ts'

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
  /** Does what the Top moments card's Jump does, and answers with what happened. */
  onJumpTopMoment?: (point: LiveHeatPoint) => JumpResult
  /** Opens Analytics at the top moment: the note's button after a Jump that failed (U1). */
  onAnalyticsTopMoment?: (point: LiveHeatPoint) => void
  /** Where Jump goes, as the card's Jump says it: 'Jump in player' or 'Jump in VOD'. */
  jumpLabel?: string
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
  onAnalyticsTopMoment,
  jumpLabel = 'Jump in player',
}: MiniDockProps) {
  // What Jump did, read on the second line for a few seconds (U).
  const [note, setNote] = useState<JumpNote | null>(null)
  const dockRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!note) return
    const timer = setTimeout(() => {
      // Open Analytics goes with the note: focus on it moves to Jump, the control that stays.
      if (dockRef.current!.querySelector('.pulse-mini-note-link:focus')) dockRef.current!.querySelector<HTMLElement>('.pulse-mini-jump')?.focus()
      setNote(null)
    }, 5000)
    return () => clearTimeout(timer)
  }, [note])
  const rollups = payload ? chartRollupSeries(payload) : []
  const heatValues = chatSeriesFromRollups(rollups).slice(-MINI_HEAT_BARS)
  // The dock sits on the channel's own page, so the name only goes in the tooltip.
  const statusLabel = tracking ? 'Tracking' : 'Not tracking'
  const statusTitle = tracking ? `Tracking ${login}` : `Not tracking ${login}`
  // The list row's reason line; a row without one shows none here either.
  const topDetail = topMoment ? displayMomentReasonLabel(topMoment.reason, topMoment.reasonLabel) : ''
  const clock = topMoment && momentClockDisplay(topMoment)
  const jumpName = topMoment ? `${jumpLabel} to the top moment at ${formatMomentClock(topMoment)}` : ''
  const shownNote = topMoment && note

  return (
    <section
      ref={dockRef}
      className={`pulse-mini-dock${sidebarFill ? ' pulse-mini-dock-sidebar' : ''}${shownNote ? ' pulse-mini-dock-noted' : ''}`}
      aria-label="StreamPulse mini dock"
    >
      <button
        type="button"
        className="pulse-mini-dock-main"
        onClick={onExpand}
        title="Expand Pulse panel"
        aria-label="Expand Pulse panel"
      >
        <BrandMark compact />
        {topMoment ? (
          // Two lines, so the time never ellipses away in the narrow sidebar dock.
          <span className="pulse-mini-moment" data-mini-top-moment="true">
            <span className="pulse-mini-moment-label">Top moment</span>
            <span className="pulse-mini-moment-detail">
              <span className="pulse-mini-moment-time"><MomentTime text={clock!.text} about={clock!.approximate} /></span>
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

      {/* Outside the buttons, whose text is not read out; always present, so a new note is announced in full. */}
      <span className="pulse-sr-only" role="status">{shownNote?.text}</span>
      <div className="pulse-mini-dock-actions" aria-label="Mini dock controls">
        {topMoment && onJumpTopMoment ? (
          <button
            type="button"
            className="pulse-mini-chip pulse-mini-jump"
            data-mini-top-moment-jump="true"
            onClick={event => {
              event.stopPropagation()
              void (onJumpTopMoment(topMoment) as JumpPromise)?.then(next => next && setNote(next))
            }}
            title={jumpName}
            aria-label={jumpName}
          >
            <PlayIcon />
            Jump
          </button>
        ) : null}
        {!tracking && onTrack ? (
          <button
            type="button"
            className="pulse-mini-chip"
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
          className="pulse-settings-gear-btn pulse-mini-icon"
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
          className="pulse-mini-icon"
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
          className="pulse-mini-icon"
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
      {shownNote ? (
        // What Jump did, across the dock's whole second line for a few seconds (U1); a '·' joins it to Open Analytics.
        <div className="pulse-mini-note-row">
          <span className={`pulse-mini-note${shownNote.ok ? '' : ' pulse-note-warn'}`} aria-hidden="true">{shownNote.text}</span>
          {!shownNote.ok && onAnalyticsTopMoment ? (
            <button type="button" className="pulse-mini-note-link" onClick={() => onAnalyticsTopMoment(topMoment)}>Open Analytics</button>
          ) : null}
        </div>
      ) : null}
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

