import type { CSSProperties } from 'react'
import { LIVE_HEAT_SUBTITLE } from '@streampulse/pulse-core'
import { PeakMark } from './PeakMark.tsx'
import { supporterFinish, type SupporterFinishId } from './supporterFinish.ts'
import { theme } from './theme.ts'

/**
 * The header's identity: recognition mark, title, status pill, lead line.
 *
 * Shared with the Supporter finish preview in settings. A previous preview
 * re-implemented this markup and drifted — wrong width, no status pill — so it
 * showed something the extension never renders. Rendering the same component in
 * both places is what keeps the preview honest.
 */
export type StreamPulseStatusTone = 'live' | 'idle' | 'local'

/** Unframed header; personal recognition belongs to the mark beside the title. */
export const streamPulseHeaderChrome: CSSProperties = {
  alignItems: 'flex-start',
  boxSizing: 'border-box',
  display: 'flex',
  flexShrink: 0,
  flexWrap: 'wrap',
  gap: 12,
  justifyContent: 'space-between',
  marginBottom: 14,
  padding: '12px 14px',
  width: '100%',
}

export const streamPulseHeaderChromeSidebar: CSSProperties = {
  alignItems: 'stretch',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  gap: 10,
  marginBottom: 10,
  padding: '10px 12px',
  width: '100%',
}

export function StreamPulseTitleBlock({
  title = 'Stream Pulse',
  finish = null,
  statusLabel,
  statusTone = 'idle',
}: {
  title?: string
  finish?: SupporterFinishId | null
  statusLabel: string
  statusTone?: StreamPulseStatusTone
}) {
  return (
    <>
      <div style={styles.titleRow}>
        {finish ? <span style={{ display: 'inline-flex', padding: 4, borderRadius: 6, background: `${supporterFinish[finish]}18` }}><PeakMark size={18} stroke={supporterFinish[finish]} /></span> : null}
        <h2 style={{ ...styles.title, overflowWrap: 'anywhere', minWidth: 0 }}>{title}</h2>
        <span style={styles[`${statusTone}Pill`]} aria-label={statusLabel}>{statusLabel}</span>
      </div>
      <p style={styles.lead}>{LIVE_HEAT_SUBTITLE}</p>
    </>
  )
}

const pillBase: CSSProperties = {
  borderRadius: 999,
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: '0.04em',
  padding: '2px 8px',
  textTransform: 'uppercase',
}

const styles: Record<string, CSSProperties> = {
  titleRow: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 },
  title: { color: '#fafafa', fontSize: 17, fontWeight: 800, letterSpacing: 0, lineHeight: 1.25, margin: 0 },
  lead: { color: theme.textSecondary, fontSize: 11, fontWeight: 600, lineHeight: 1.4, margin: '6px 0 0' },
  livePill: {
    ...pillBase,
    background: 'rgba(34, 197, 94, 0.14)',
    border: '1px solid rgba(34, 197, 94, 0.35)',
    color: 'rgba(187, 247, 208, 0.95)',
  },
  idlePill: {
    ...pillBase,
    background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.22)',
    border: '1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45)',
    color: 'var(--pulse-accent-soft, #c4b5fd)',
    fontSize: 10,
    fontWeight: 900,
    padding: '4px 10px',
  },
  localPill: {
    ...pillBase,
    background: 'rgba(245, 158, 11, 0.14)',
    border: '1px solid rgba(245, 158, 11, 0.4)',
    color: 'rgba(253, 230, 138, 0.95)',
  },
}
