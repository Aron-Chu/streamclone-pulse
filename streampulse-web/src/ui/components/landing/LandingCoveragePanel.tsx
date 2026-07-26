// @ts-nocheck
import type { LandingPulsePayload } from './landingExtensionTypes.ts'
import { formatHeatOffset } from '@streampulse/pulse-core'
import { PulseSectionCard } from '@pulse-ext/ui/PulseSectionCard.tsx'
import { theme } from '@pulse-ext/ui/theme.ts'
import type { CSSProperties } from 'react'

export function LandingCoveragePanel({ payload }: { payload: LandingPulsePayload }) {
  const coverage = payload.coverage
  const start = formatHeatOffset(coverage?.coverageStartOffsetSeconds ?? payload.coverageStartOffsetSeconds ?? 0)
  const window = formatHeatOffset(payload.currentOffsetSeconds ?? 0)

  return (
    <PulseSectionCard
      title="Data coverage"
      meta={
        <span style={styles.livePill}>
          <span className="pulse-live-dot" style={styles.dot} aria-hidden />
          Live analytics active
        </span>
      }
    >
      <p style={styles.copy}>
        {coverage?.message
          ?? 'Live chat and emote rollups update each minute, with the visible coverage window reported by the backend.'}
      </p>
      <div style={styles.grid}>
        <div style={styles.row}>
          <span style={styles.label}>Viewer source</span>
          <strong style={styles.value}>{coverage?.chatSourceDetail ?? 'live rollups'}</strong>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>Coverage start</span>
          <strong style={styles.value}>{start}</strong>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>Live window</span>
          <strong style={styles.value}>{window}</strong>
        </div>
      </div>
      <p style={styles.note}>Late-start windows stay visible; StreamPulse does not fabricate earlier chat.</p>
    </PulseSectionCard>
  )
}

const styles: Record<string, CSSProperties> = {
  livePill: {
    alignItems: 'center',
    background: 'rgba(16, 185, 129, 0.15)',
    border: '1px solid rgba(52, 211, 153, 0.35)',
    borderRadius: 999,
    color: '#6ee7b7',
    display: 'inline-flex',
    fontSize: 10,
    fontWeight: 800,
    gap: 6,
    padding: '3px 8px',
  },
  dot: { background: theme.live, borderRadius: '50%', height: 6, width: 6 },
  copy: { color: theme.textSecondary, fontSize: 12, lineHeight: 1.45, margin: '0 0 10px' },
  grid: { display: 'grid', gap: 8 },
  row: {
    alignItems: 'baseline',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: { color: theme.textMuted, fontSize: 11 },
  value: { color: theme.textPrimary, fontSize: 12, fontWeight: 700 },
  note: { color: theme.textMuted, fontSize: 11, lineHeight: 1.4, margin: '10px 0 0' },
}
