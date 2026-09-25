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
      data-pulse-hub-cta="true"
      style={compact ? styles.compact : styles.default}
      aria-label="Open analytics hub"
      title="Browse full stream history, tracked channels, and deeper analytics"
      onClick={() => openHubAnalytics(backendUrl)}
    >
      <span style={styles.label}>Open Analytics Hub →</span>
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
    letterSpacing: 0,
    lineHeight: 1.25,
  },
}
