import type { CSSProperties } from 'react'
import type { PulseBackfillJob } from '../shared/messages.ts'
import {
  coverageCardCopy,
  backendResolvedVod,
  missedMomentsButtonLabel,
  missedMomentsButtonState,
  type PulseCoverageSource,
} from './missedMoments.ts'
import { formatPulseApiError } from './pulseApiErrors.ts'
import { theme } from './theme.ts'
import { useReducedMotion } from './motion/useReducedMotion.ts'

export interface CoverageCardProps {
  source: PulseCoverageSource & { tracking?: boolean; streamId?: string; helixEnabled?: boolean }
  busy: boolean
  refreshed: boolean
  job?: PulseBackfillJob | null
  lastCheckedAt?: number | null
  checkError?: string | null
  debugDetail?: string | null
  onLoad: () => void
  onCheckVod?: () => void
  onOpenSettings?: () => void
  onOpenAnalytics?: () => void
}

export function CoverageCard({
  source,
  busy,
  refreshed,
  job,
  checkError,
  debugDetail,
  onLoad,
  onCheckVod,
  onOpenSettings,
}: CoverageCardProps) {
  const reducedMotion = useReducedMotion()
  const copy = coverageCardCopy(source)
  if (!copy) return null

  const buttonState = missedMomentsButtonState(source, busy, refreshed)
  const backfilling = buttonState === 'backfilling' || buttonState === 'loading'
  const waitingVod =
    buttonState === 'check_vod'
    || buttonState === 'waiting_vod'
    || buttonState === 'recheck_pulse_link'
  const failed = buttonState === 'failed' || Boolean(checkError)
  const loadReady = buttonState === 'load' && !busy
  const backendVod = backendResolvedVod(source)
  const localDiscoveryNote = debugDetail?.trim() || null

  const pct = job?.progress?.percent
  const hasRealProgress = typeof pct === 'number' && pct > 0
  const showBar = backfilling || (waitingVod && busy) || (loadReady && busy)

  const helixBlocked = source.helixEnabled === false
  const errorText = helixBlocked
    ? 'Streamclone backend is missing Twitch API credentials (TWITCH_OAUTH_CLIENT_ID / SECRET). VOD lookup cannot run.'
    : formatPulseApiError(checkError ?? (buttonState === 'failed' ? job?.error : null))

  let statusLine = copy.body
  if (backfilling) {
    statusLine = hasRealProgress
      ? `Loading VOD chat… ${Math.round(pct!)}%`
      : job?.message ?? 'Loading VOD chat via Twitch…'
  } else if (waitingVod) {
    statusLine = copy.body
  } else if (loadReady) {
    statusLine = copy.body.includes('Fill missing')
      ? copy.body
      : 'Fill missing start from Twitch VOD'
  }

  return (
    <section style={styles.card} aria-live="polite">
      <p style={styles.status}>{statusLine}</p>

      {waitingVod && copy.detail && !busy ? (
        <p style={styles.hint}>{copy.detail}</p>
      ) : null}

      {showBar ? (
        hasRealProgress ? (
          <div
            style={styles.progressTrack}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ ...styles.progressFill, width: `${Math.min(100, pct!)}%` }} />
          </div>
        ) : !reducedMotion ? (
          <div className="pulse-shimmer" style={styles.indeterminate} aria-hidden="true" />
        ) : (
          <div style={styles.progressTrack} aria-hidden="true">
            <span style={{ ...styles.progressFill, width: '35%' }} />
          </div>
        )
      ) : null}

      {loadReady ? (
        <button type="button" style={styles.loadLink} onClick={onLoad}>
          {missedMomentsButtonLabel('load')}
        </button>
      ) : null}

      {waitingVod && onCheckVod ? (
        <button type="button" style={styles.loadLink} onClick={onCheckVod} disabled={busy}>
          {busy ? 'Checking…' : missedMomentsButtonLabel(buttonState)}
        </button>
      ) : null}

      {localDiscoveryNote && (waitingVod || loadReady) ? (
        <p style={styles.debugDetail}>
          {backendVod ? 'Local page note: ' : ''}
          {localDiscoveryNote}
        </p>
      ) : null}

      {failed && errorText ? (
        <p style={styles.error}>{errorText}</p>
      ) : null}

      {onOpenSettings && (helixBlocked || checkError) ? (
        <button type="button" style={styles.loadLink} onClick={onOpenSettings}>
          Open settings
        </button>
      ) : null}

      {failed && buttonState === 'failed' ? (
        <button type="button" style={styles.loadLink} onClick={onLoad}>
          Retry backfill
        </button>
      ) : null}
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  card: {
    margin: '0 0 10px',
    padding: '8px 10px',
    borderRadius: 8,
    border: `1px solid ${theme.border}`,
    background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.06)',
  },
  status: {
    color: theme.textSecondary,
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.4,
    margin: '0 0 6px',
  },
  progressTrack: {
    background: theme.hoverFill,
    borderRadius: 999,
    height: 4,
    overflow: 'hidden',
  },
  progressFill: {
    background: theme.accent,
    borderRadius: 999,
    display: 'block',
    height: '100%',
  },
  indeterminate: {
    borderRadius: 999,
    height: 4,
  },
  loadLink: {
    appearance: 'none',
    background: 'transparent',
    border: 0,
    color: theme.accentText,
    cursor: 'pointer',
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.04em',
    marginTop: 6,
    padding: 0,
    textTransform: 'uppercase',
  },
  error: {
    color: theme.statusErrorText,
    fontSize: 11,
    lineHeight: 1.4,
    margin: '6px 0 0',
  },
  hint: {
    color: theme.textMuted,
    fontSize: 10,
    lineHeight: 1.45,
    margin: '0 0 6px',
  },
  debugDetail: {
    color: theme.accentText,
    fontSize: 10,
    lineHeight: 1.45,
    margin: '6px 0 0',
    opacity: 0.9,
  },
}

/** @deprecated Use CoverageCard */
export const MissedMomentsBanner = CoverageCard
