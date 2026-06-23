import type { CSSProperties } from 'react'
import { formatHeatOffset, type LiveHeatPoint } from '@streamclone/pulse-core'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { formatCount } from './mostReacted.ts'
import { theme } from './theme.ts'

export interface SelectedMomentCardProps {
  point: LiveHeatPoint
  backendUrl: string
  onJump: (point: LiveHeatPoint) => void
  onSave: (point: LiveHeatPoint) => void
  onAnalytics: (point: LiveHeatPoint) => void
  saveBusy?: boolean
}

export function SelectedMomentCard({
  point,
  backendUrl,
  onJump,
  onSave,
  onAnalytics,
  saveBusy = false,
}: SelectedMomentCardProps) {
  const offsetLabel = formatHeatOffset(point.offsetSeconds)

  return (
    <div style={styles.wrap} aria-label={`Selected moment at ${offsetLabel}`}>
      <div style={styles.header}>
        <span style={styles.kicker}>Selected moment</span>
        <span style={styles.offset}>{offsetLabel}</span>
      </div>
      <p style={styles.reason}>{point.reasonLabel}</p>
      <p style={styles.counts}>
        {formatCount(point.chatCount)} chat · {formatCount(point.emoteCount)} emotes
      </p>
      {point.topEmotes.length > 0 ? (
        <ul style={styles.list}>
          {point.topEmotes.map(emote => (
            <li key={emote.key} style={styles.item}>
              <PulseEmoteImg emote={emote} backendUrl={backendUrl} width={18} height={18} style={styles.img} />
              <span style={styles.name}>{emote.name}</span>
              <span style={styles.uses}>{formatCount(emote.count)} uses</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div style={styles.actions}>
        <button type="button" style={styles.actionPrimary} onClick={() => onJump(point)}>
          Jump
        </button>
        <button type="button" style={styles.action} disabled={saveBusy} onClick={() => onSave(point)}>
          {saveBusy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" style={styles.action} onClick={() => onAnalytics(point)}>
          Open Analytics
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    background: 'rgba(139, 92, 246, 0.08)',
    border: '1px solid rgba(167, 139, 250, 0.2)',
    borderRadius: 8,
    marginBottom: 10,
    padding: '10px 12px',
  },
  header: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  kicker: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  offset: { color: theme.textSecondary, fontSize: 12, fontVariantNumeric: 'tabular-nums', fontWeight: 800 },
  reason: { color: theme.textPrimary, fontSize: 12, fontWeight: 800, margin: '6px 0 0' },
  counts: { color: theme.textMuted, fontSize: 11, fontWeight: 600, margin: '4px 0 8px' },
  list: { display: 'grid', gap: 6, listStyle: 'none', margin: '0 0 10px', padding: 0 },
  item: { alignItems: 'center', display: 'flex', gap: 8 },
  img: { display: 'block', objectFit: 'contain' },
  name: { color: theme.textPrimary, flex: 1, fontSize: 12, fontWeight: 700 },
  uses: { color: theme.textMuted, fontSize: 11, fontVariantNumeric: 'tabular-nums' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  actionPrimary: {
    background: 'rgba(139, 92, 246, 0.22)',
    border: '1px solid rgba(167, 139, 250, 0.45)',
    borderRadius: 8,
    color: '#ede9fe',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 800,
    padding: '6px 10px',
  },
  action: {
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 8,
    color: theme.textSecondary,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
    padding: '6px 10px',
  },
}
