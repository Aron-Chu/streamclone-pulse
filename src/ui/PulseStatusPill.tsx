import type { CSSProperties } from 'react'
import { theme } from './theme.ts'

export type PulseStatusKind =
  | 'tracking'
  | 'replay-synced'
  | 'syncing'
  | 'partial'
  | 'missing'
  | 'backend-error'
  | 'playback-sync-unavailable'
  | 'recap-ready'
  | 'recap-partial'

const LABELS: Record<PulseStatusKind, string> = {
  tracking: 'Tracking',
  'replay-synced': 'Replay synced',
  syncing: 'Syncing replay',
  partial: 'Partial coverage',
  missing: 'No replay data',
  'backend-error': 'Backend unavailable',
  'playback-sync-unavailable': 'Playback sync unavailable',
  'recap-ready': 'Recap ready',
  'recap-partial': 'Recap partial',
}

export function PulseStatusPill({ status }: { status: PulseStatusKind }) {
  return (
    <span style={styles.pill} data-status={status}>
      {LABELS[status]}
    </span>
  )
}

const styles: Record<string, CSSProperties> = {
  pill: {
    background: 'var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.06))',
    border: '1px solid var(--pulse-surface-border-subtle, rgba(255, 255, 255, 0.12))',
    borderRadius: 999,
    color: theme.textSecondary,
    display: 'inline-flex',
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.04em',
    padding: '3px 8px',
    textTransform: 'uppercase',
  },
}
