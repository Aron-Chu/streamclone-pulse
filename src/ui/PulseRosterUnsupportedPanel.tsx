import type { CSSProperties } from 'react'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { theme } from './theme.ts'

export interface PulseRosterUnsupportedPanelProps {
  login: string
}

export function pulseRosterUnsupportedCopy(login: string): { title: string; body: string; footer: string } {
  return {
    title: 'Outside tracked roster',
    body: `${login} is not on StreamPulse's actively tracked channel roster, so live Pulse chat analytics is not available here. We focus IRC rollups on a limited set of high-activity channels while capacity scales.`,
    footer: 'Check back if this channel is added to the roster later.',
  }
}

export function PulseRosterUnsupportedPanel({ login }: PulseRosterUnsupportedPanelProps) {
  const copy = pulseRosterUnsupportedCopy(login)

  return (
    <PulseSectionCard title={copy.title}>
      <p style={styles.text}>{copy.body}</p>
      <p style={styles.muted}>{copy.footer}</p>
    </PulseSectionCard>
  )
}

const styles: Record<string, CSSProperties> = {
  text: { color: theme.textSecondary, fontSize: 12, fontWeight: 600, lineHeight: 1.5, margin: 0 },
  muted: { color: theme.textMuted, fontSize: 11, fontWeight: 600, lineHeight: 1.45, margin: 0 },
}
