import type { CSSProperties } from 'react'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { theme } from './theme.ts'

export interface PulseNotTrackedPanelProps {
  login: string
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
  hostedActiveCount,
  hostedActiveLimit,
}: PulseNotTrackedPanelProps) {
  const poolLabel = formatPoolLabel(hostedActiveCount, hostedActiveLimit)
  const copy = pulseNotTrackedCopy(login)

  return (
    <PulseSectionCard title={copy.title}>
      <p style={styles.text}>{copy.body}</p>
      {poolLabel ? <p style={styles.muted}>{poolLabel}</p> : null}
    </PulseSectionCard>
  )
}

const styles: Record<string, CSSProperties> = {
  text: { color: theme.textSecondary, fontSize: 12, fontWeight: 600, lineHeight: 1.5, margin: 0 },
  muted: { color: theme.textMuted, fontSize: 11, fontWeight: 600, lineHeight: 1.45, margin: 0 },
}
