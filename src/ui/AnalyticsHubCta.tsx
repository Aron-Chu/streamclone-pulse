import type { CSSProperties } from 'react'
import { openHubAnalytics } from '../shared/analyticsLinks.ts'

export interface AnalyticsHubCtaProps {
  backendUrl: string
  compact?: boolean
}

export function AnalyticsHubCta({ backendUrl, compact = false }: AnalyticsHubCtaProps) {
  return (
    <button
      type="button"
      className="pulse-analytics-hub-cta"
      style={compact ? styles.compact : styles.default}
      title="Browse full stream history, tracked channels, and deeper analytics"
      onClick={() => openHubAnalytics(backendUrl)}
    >
      <span style={styles.label}>Open Analytics Hub →</span>
      <small style={styles.subtitle}>Full history, tracked channels, and deeper analytics</small>
    </button>
  )
}

const styles: Record<string, CSSProperties> = {
  default: {
    marginBottom: 6,
    marginTop: 8,
    width: '100%',
  },
  compact: {
    marginBottom: 4,
    marginTop: 6,
    width: '100%',
  },
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: '0.03em',
    lineHeight: 1.25,
  },
  subtitle: {
    color: 'rgba(221, 214, 254, 0.82)',
    display: 'block',
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1.35,
    marginTop: 3,
  },
}
