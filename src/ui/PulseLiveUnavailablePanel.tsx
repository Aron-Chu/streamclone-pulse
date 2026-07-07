import type { CSSProperties } from 'react'
import { formatHeatOffset } from '@streamclone/pulse-core'
import type { PulseLiveAccessState } from './resolvePulseLiveAccess.ts'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { theme } from './theme.ts'

export interface PulseLiveUnavailablePanelProps {
  variant: Extract<PulseLiveAccessState, 'not_irc_tracked' | 'late_session'>
  login: string
  coverageStartOffsetSeconds: number
  hostedActiveCount: number | null
  hostedActiveLimit: number | null
  onOpenSettings?: () => void
}

function formatPoolLabel(activeCount: number | null, activeLimit: number | null): string {
  if (activeCount != null && activeLimit != null && activeLimit > 0) {
    return `${activeCount}/${activeLimit}`
  }
  if (activeLimit != null && activeLimit > 0) {
    return `up to ${activeLimit}`
  }
  return 'a limited number of'
}

export function PulseLiveUnavailablePanel({
  variant,
  login,
  coverageStartOffsetSeconds,
  hostedActiveCount,
  hostedActiveLimit,
  onOpenSettings,
}: PulseLiveUnavailablePanelProps) {
  const poolLabel = formatPoolLabel(hostedActiveCount, hostedActiveLimit)

  const title =
    variant === 'not_irc_tracked'
      ? 'Not in live IRC pool'
      : 'Pulse Live starts from stream open'

  const body =
    variant === 'not_irc_tracked'
      ? `${login} is live, but StreamPulse is not collecting IRC chat for this channel right now. Hosted Pulse tracks ${poolLabel} live channels at a time — chat and emote rollups are unavailable here.`
      : `StreamPulse is tracking this stream from ${formatHeatOffset(coverageStartOffsetSeconds)}, but you opened the channel late. Full live charts are available for protected watchlist channels or when you open a stream within the first 2 minutes.`

  return (
    <PulseSectionCard title={title}>
      <p style={styles.text}>{body}</p>
      {onOpenSettings ? (
        <div style={styles.actions}>
          <button type="button" style={styles.secondaryButton} onClick={onOpenSettings}>
            {variant === 'late_session' ? 'Protect for future streams' : 'Extension settings'}
          </button>
        </div>
      ) : null}
    </PulseSectionCard>
  )
}

const styles: Record<string, CSSProperties> = {
  text: { color: theme.textSecondary, fontSize: 12, fontWeight: 600, lineHeight: 1.5, margin: 0 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  secondaryButton: {
    background: theme.panel,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusButton,
    color: theme.textPrimary,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
    padding: '8px 12px',
  },
}
