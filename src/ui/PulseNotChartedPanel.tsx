import type { CSSProperties } from 'react'
import { NOT_CHARTED_REASON, NOT_CHARTED_TITLE } from '../shared/notCharted.ts'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { theme } from './theme.ts'

export interface PulseNotChartedPanelProps {
  /** Shows Chat again for this visit. Absent where there is no Chat tab. */
  onBackToChat?: () => void
}

/** One card for a channel off the list and a live channel StreamPulse isn't reading. */
export function PulseNotChartedPanel({ onBackToChat }: PulseNotChartedPanelProps) {
  return (
    <PulseSectionCard title={NOT_CHARTED_TITLE}>
      <p style={textStyle}>{NOT_CHARTED_REASON} This one isn’t charted right now.</p>
      {onBackToChat ? (
        <div className="pulse-footer-actions">
          <button type="button" className="pulse-secondary-button" onClick={onBackToChat}>
            Back to chat
          </button>
        </div>
      ) : null}
    </PulseSectionCard>
  )
}

const textStyle: CSSProperties = { color: theme.textSecondary, fontSize: 12, fontWeight: 600, lineHeight: 1.5, margin: 0 }
