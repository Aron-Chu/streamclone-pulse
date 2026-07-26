import type { CSSProperties } from 'react'
import { theme } from './theme.ts'

export const PULSE_SIDEBAR_SKELETON_MIN_HEIGHT = 380

export function pulseSidebarSkeletonStatusCopy(hostedBackend: boolean): {
  title: string
  detail: string
} {
  return {
    title: 'Loading Pulse',
    detail: hostedBackend
      ? 'Fetching live analytics from StreamPulse…'
      : 'Waiting for Pulse data from your Streamclone stack…',
  }
}

export interface PulseSidebarSkeletonProps {
  hostedBackend?: boolean
}

export function PulseSidebarSkeleton({ hostedBackend = true }: PulseSidebarSkeletonProps) {
  const copy = pulseSidebarSkeletonStatusCopy(hostedBackend)
  return (
    <div style={styles.root} aria-busy="true" aria-label="Loading Pulse">
      <div style={styles.metricsRow}>
        <div className="pulse-shimmer" style={styles.metricBlock} />
        <div className="pulse-shimmer" style={styles.metricBlock} />
        <div className="pulse-shimmer" style={styles.metricBlock} />
      </div>
      <div className="pulse-shimmer" style={styles.chartBlock} />
      <div className="pulse-shimmer" style={styles.sectionTitle} />
      <div className="pulse-shimmer" style={styles.momentCard} />
      <div className="pulse-shimmer" style={styles.momentRow} />
      <div className="pulse-shimmer" style={styles.momentRow} />
      <div className="pulse-shimmer" style={styles.momentRow} />
      <p style={styles.statusTitle}>{copy.title}</p>
      <p style={styles.statusText}>{copy.detail}</p>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  root: {
    display: 'grid',
    gap: 8,
    minHeight: PULSE_SIDEBAR_SKELETON_MIN_HEIGHT,
    padding: '4px 0 8px',
  },
  metricsRow: {
    display: 'grid',
    gap: 6,
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  },
  metricBlock: {
    borderRadius: 6,
    height: 44,
    opacity: 0.85,
  },
  chartBlock: {
    borderRadius: 8,
    height: 148,
    marginTop: 4,
    opacity: 0.9,
  },
  sectionTitle: {
    borderRadius: 4,
    height: 12,
    marginTop: 6,
    opacity: 0.75,
    width: '42%',
  },
  momentCard: {
    borderRadius: 8,
    height: 88,
    opacity: 0.88,
  },
  momentRow: {
    borderRadius: 6,
    height: 36,
    opacity: 0.8,
  },
  statusTitle: {
    color: theme.textPrimary,
    fontSize: 12,
    fontWeight: 800,
    margin: '8px 0 0',
  },
  statusText: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.4,
    margin: 0,
  },
}
