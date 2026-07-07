import type { CSSProperties } from 'react'
import { openHubAnalytics } from '../shared/analyticsLinks.ts'
import { theme } from './theme.ts'

export interface PulseNotTrackedPanelProps {
  login: string
  backendUrl: string
  hostedActiveCount: number | null
  hostedActiveLimit: number | null
}

function formatPoolLabel(activeCount: number | null, activeLimit: number | null): string | null {
  if (activeCount != null && activeLimit != null && activeLimit > 0) {
    return `Live IRC pool: ${activeCount}/${activeLimit} channels`
  }
  if (activeLimit != null && activeLimit > 0) {
    return `Live IRC pool: up to ${activeLimit} channels`
  }
  return null
}

export function pulseNotTrackedCopy(login: string): { title: string; body: string } {
  return {
    title: 'Not tracked live',
    body: `${login} is not in StreamPulse’s live IRC pool right now. Live chat analytics is only available for actively tracked channels while we scale capacity.`,
  }
}

export function PulseNotTrackedPanel({
  login,
  backendUrl,
  hostedActiveCount,
  hostedActiveLimit,
}: PulseNotTrackedPanelProps) {
  const poolLabel = formatPoolLabel(hostedActiveCount, hostedActiveLimit)
  const copy = pulseNotTrackedCopy(login)

  return (
    <section style={styles.block}>
      <h2 style={styles.title}>{copy.title}</h2>
      <p style={styles.text}>{copy.body}</p>
      {poolLabel ? <p style={styles.muted}>{poolLabel}</p> : null}
      <p style={styles.muted}>See which channels are actively tracked on the StreamPulse Analytics hub.</p>
      <div style={styles.actions}>
        <button
          type="button"
          style={styles.primaryButton}
          onClick={() => openHubAnalytics(backendUrl)}
        >
          Open Analytics hub
        </button>
      </div>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  block: {
    background: theme.panelElevated,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusPanel,
    marginBottom: 14,
    padding: '14px 16px',
  },
  title: { fontSize: 16, fontWeight: 800, lineHeight: 1.2, margin: '0 0 8px' },
  text: { color: theme.textSecondary, fontSize: 12, fontWeight: 600, lineHeight: 1.5, margin: '0 0 8px' },
  muted: { color: theme.textMuted, fontSize: 11, fontWeight: 600, lineHeight: 1.45, margin: '0 0 12px' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  primaryButton: {
    background: theme.accent,
    border: 0,
    borderRadius: theme.radiusButton,
    color: '#fff',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 800,
    padding: '8px 12px',
  },
}
