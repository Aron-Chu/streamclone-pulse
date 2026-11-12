import type { CSSProperties } from 'react'
import { formatHeatOffset } from '@streampulse/pulse-core'
import type { PulseLiveAccessState } from './resolvePulseLiveAccess.ts'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { theme } from './theme.ts'

export interface PulseLiveUnavailablePanelProps {
  variant: Extract<PulseLiveAccessState, 'not_irc_tracked' | 'late_session'>
  login: string
  coverageStartOffsetSeconds: number
  /** Hosted pool counts. Unused: this panel only shows against your own stack, which has no hosted pool. */
  hostedActiveCount?: number | null
  hostedActiveLimit?: number | null
  onOpenSettings?: () => void
}

export function PulseLiveUnavailablePanel({
  variant,
  login,
  coverageStartOffsetSeconds,
  onOpenSettings,
}: PulseLiveUnavailablePanelProps) {
  const title =
    variant === 'not_irc_tracked'
      ? 'Not tracked live'
      : 'Pulse Live starts from stream open'

  const body =
    variant === 'not_irc_tracked'
      ? `${login} is live, but your StreamPulse stack isn’t reading this channel’s chat, so there’s no chart or moments here.`
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
