import type { CSSProperties } from 'react'
import { openHubAnalytics } from '../shared/analyticsLinks.ts'

export interface AnalyticsHubCtaProps {
  backendUrl: string
  compact?: boolean
}

export function AnalyticsHubCta({ backendUrl, compact = false }: AnalyticsHubCtaProps) {
  return (
    <div
      className="pulse-analytics-hub-cta-wrap"
      style={compact ? styles.wrapCompact : styles.wrap}
      data-testid="analytics-hub-cta-wrap"
    >
      <button
        type="button"
        className="pulse-analytics-hub-cta"
        style={styles.button}
        title="Browse full stream history, tracked channels, and deeper analytics"
        onClick={() => openHubAnalytics(backendUrl)}
      >
        <span style={styles.label}>Open Analytics Hub →</span>
      </button>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: 'flex',
    marginBottom: 6,
    marginTop: 8,
    width: '100%',
  },
  wrapCompact: {
    display: 'flex',
    marginBottom: 4,
    marginTop: 6,
    width: '100%',
  },
  button: {
    maxWidth: '100%',
    width: '100%',
  },
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: '0.03em',
    lineHeight: 1.25,
    textAlign: 'center',
  },
}
