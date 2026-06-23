import type { CSSProperties } from 'react'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { theme } from './theme.ts'

export interface CurrentStreamCardProps {
  onFromStart: () => void
  onPulse: () => void
}

export function CurrentStreamCard({ onFromStart, onPulse }: CurrentStreamCardProps) {
  return (
    <PulseSectionCard
      title="Current stream"
      subtitle="Live broadcast you're watching"
      meta={<span style={styles.liveBadge}>Current live</span>}
      style={styles.section}
    >
      <div style={styles.actions}>
        <button type="button" style={styles.actionPrimary} onClick={onFromStart}>
          From start
        </button>
        <button type="button" style={styles.action} onClick={onPulse}>
          Pulse
        </button>
      </div>
    </PulseSectionCard>
  )
}

const styles: Record<string, CSSProperties> = {
  section: { marginTop: 16 },
  liveBadge: {
    background: 'rgba(220, 38, 38, 0.18)',
    border: '1px solid rgba(248, 113, 113, 0.35)',
    borderRadius: 999,
    color: '#fecaca',
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.04em',
    padding: '3px 8px',
    textTransform: 'uppercase',
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  actionPrimary: {
    background: 'rgba(139, 92, 246, 0.22)',
    border: '1px solid rgba(167, 139, 250, 0.45)',
    borderRadius: 8,
    color: '#ede9fe',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 800,
    padding: '8px 12px',
  },
  action: {
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 8,
    color: theme.textSecondary,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
    padding: '8px 12px',
  },
}
