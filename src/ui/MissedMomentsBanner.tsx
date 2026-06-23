import type { CSSProperties } from 'react'
import type { PulseBackfillJob, PulseCoverage } from '../shared/messages.ts'
import { missedMomentsButtonLabel, missedMomentsButtonState } from './missedMoments.ts'
import { theme } from './theme.ts'

export interface MissedMomentsBannerProps {
  coverage: PulseCoverage
  busy: boolean
  refreshed: boolean
  job?: PulseBackfillJob | null
  onLoad: () => void
}

export function MissedMomentsBanner({
  coverage,
  busy,
  refreshed,
  job,
  onLoad,
}: MissedMomentsBannerProps) {
  const buttonState = missedMomentsButtonState(coverage, busy, refreshed)
  const label = missedMomentsButtonLabel(buttonState, job)
  const disabled = busy
    || buttonState === 'backfilling'
    || buttonState === 'waiting_vod'
    || buttonState === 'unavailable'
    || buttonState === 'refreshed'
    || buttonState === 'hidden'

  return (
    <section style={styles.banner} aria-live="polite">
      <p style={styles.message}>{coverage.message}</p>
      {buttonState !== 'hidden' ? (
        <button
          type="button"
          style={{
            ...styles.button,
            ...(disabled ? styles.buttonDisabled : {}),
          }}
          disabled={disabled}
          onClick={onLoad}
        >
          {label}
        </button>
      ) : null}
      {coverage.state === 'backfill_failed' && job?.error ? (
        <p style={styles.error}>{job.error}</p>
      ) : null}
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  banner: {
    margin: '0 0 12px',
    padding: '10px 12px',
    borderRadius: 10,
    border: `1px solid ${theme.border}`,
    background: 'rgba(139, 92, 246, 0.08)',
  },
  message: {
    margin: '0 0 8px',
    color: theme.textSecondary,
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.45,
  },
  button: {
    appearance: 'none',
    border: '1px solid rgba(167, 139, 250, 0.45)',
    background: 'rgba(139, 92, 246, 0.18)',
    color: theme.textPrimary,
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  },
  buttonDisabled: {
    opacity: 0.72,
    cursor: 'default',
  },
  error: {
    margin: '8px 0 0',
    color: '#fca5a5',
    fontSize: 11,
    lineHeight: 1.4,
  },
}
