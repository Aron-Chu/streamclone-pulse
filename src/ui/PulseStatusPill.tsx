import type { CSSProperties } from 'react'
import { theme } from './theme.ts'

export type PulseStatusKind =
  | 'tracking'
  | 'replay-synced'
  | 'syncing'
  | 'partial'
  | 'missing'
  | 'backend-error'
  | 'archive-conflict'
  | 'playback-sync-unavailable'
  | 'recap-ready'
  | 'recap-partial'

interface PulseStatusPresentation {
  label: string
  description: string
  color: string
  background: string
  border: string
  dot: string
}

/**
 * Status pills appear next to replay copy, where a neutral pill made every
 * state look equivalent. Keep the wording stable for tests and deep links,
 * but give each state a small visual signal that can be scanned quickly.
 */
export const PULSE_STATUS_PRESENTATION: Record<PulseStatusKind, PulseStatusPresentation> = {
  tracking: {
    label: 'Tracking',
    description: 'Live analytics are tracking this stream.',
    color: '#bbf7d0',
    background: 'rgba(34, 197, 94, 0.14)',
    border: 'rgba(74, 222, 128, 0.38)',
    dot: '#4ade80',
  },
  'replay-synced': {
    label: 'Replay synced',
    description: 'Replay analytics are available for this stream.',
    color: '#99f6e4',
    background: 'rgba(20, 184, 166, 0.14)',
    border: 'rgba(45, 212, 191, 0.38)',
    dot: '#2dd4bf',
  },
  syncing: {
    label: 'Syncing replay',
    description: 'Replay analytics are still being prepared.',
    color: '#ddd6fe',
    background: 'rgba(139, 92, 246, 0.16)',
    border: 'rgba(167, 139, 250, 0.4)',
    dot: '#a78bfa',
  },
  partial: {
    label: 'Partial coverage',
    description: 'Only part of the replay has analytics coverage.',
    color: '#fde68a',
    background: 'rgba(245, 158, 11, 0.14)',
    border: 'rgba(251, 191, 36, 0.38)',
    dot: '#fbbf24',
  },
  missing: {
    label: 'No replay data',
    description: 'Replay analytics are not available yet.',
    color: '#d4d4d8',
    background: 'rgba(113, 113, 122, 0.14)',
    border: 'rgba(161, 161, 170, 0.32)',
    dot: '#a1a1aa',
  },
  'backend-error': {
    label: 'Backend unavailable',
    description: 'StreamPulse could not load replay analytics.',
    color: '#fecaca',
    background: 'rgba(239, 68, 68, 0.14)',
    border: 'rgba(248, 113, 113, 0.38)',
    dot: '#f87171',
  },
  'archive-conflict': {
    label: 'Archive verification failed',
    description: 'The replay identity could not be verified.',
    color: '#fecaca',
    background: 'rgba(239, 68, 68, 0.14)',
    border: 'rgba(248, 113, 113, 0.38)',
    dot: '#f87171',
  },
  'playback-sync-unavailable': {
    label: 'Playback sync unavailable',
    description: 'Analytics could not be aligned to Twitch playback.',
    color: '#fed7aa',
    background: 'rgba(249, 115, 22, 0.14)',
    border: 'rgba(251, 146, 60, 0.38)',
    dot: '#fb923c',
  },
  'recap-ready': {
    label: 'Recap ready',
    description: 'The stream recap is ready to explore.',
    color: '#99f6e4',
    background: 'rgba(20, 184, 166, 0.14)',
    border: 'rgba(45, 212, 191, 0.38)',
    dot: '#2dd4bf',
  },
  'recap-partial': {
    label: 'Recap partial',
    description: 'The stream recap is available with incomplete coverage.',
    color: '#fde68a',
    background: 'rgba(245, 158, 11, 0.14)',
    border: 'rgba(251, 191, 36, 0.38)',
    dot: '#fbbf24',
  },
}

export function PulseStatusPill({ status }: { status: PulseStatusKind }) {
  const presentation = PULSE_STATUS_PRESENTATION[status]

  return (
    <span
      className={`pulse-status-pill pulse-status-pill-${status}`}
      style={{
        ...styles.pill,
        background: presentation.background,
        borderColor: presentation.border,
        color: presentation.color,
      }}
      data-status={status}
      title={presentation.description}
      aria-label={presentation.label}
      aria-live="polite"
      aria-atomic="true"
      role="status"
    >
      <span
        className={`pulse-status-pill-dot pulse-status-pill-dot-${status}`}
        aria-hidden="true"
        style={{
          ...styles.dot,
          background: presentation.dot,
          boxShadow: `0 0 0 2px ${presentation.background}`,
        }}
      />
      {presentation.label}
    </span>
  )
}

const styles: Record<string, CSSProperties> = {
  pill: {
    alignItems: 'center',
    border: '1px solid transparent',
    borderRadius: 999,
    display: 'inline-flex',
    fontSize: 10,
    fontWeight: 800,
    gap: 6,
    letterSpacing: '0.04em',
    lineHeight: '14px',
    minHeight: 20,
    padding: '3px 8px 3px 7px',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  dot: {
    borderRadius: 999,
    display: 'inline-block',
    flex: '0 0 auto',
    height: 6,
    width: 6,
  },
}
