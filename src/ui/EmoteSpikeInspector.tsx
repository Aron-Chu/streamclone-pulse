import type { CSSProperties } from 'react'
import type { LiveHeatPoint } from '@streamclone/pulse-core'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { formatCount } from './mostReacted.ts'
import { theme } from './theme.ts'

export interface EmoteSpikeInspectorProps {
  point: LiveHeatPoint
  backendUrl: string
}

function isSevenTVSpike(point: LiveHeatPoint): boolean {
  const reason = String(point.reason)
  return reason.includes('seventv') || reason.includes('7tv') || reason.includes('emote')
}

export function EmoteSpikeInspector({ point, backendUrl }: EmoteSpikeInspectorProps) {
  if (!isSevenTVSpike(point) || point.topEmotes.length === 0) {
    return null
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.title}>Emote spike</div>
      <div style={styles.subtitle}>{point.reasonLabel}</div>
      <ul style={styles.list}>
        {point.topEmotes.slice(0, 5).map(emote => (
            <li key={emote.key} style={styles.item}>
              <PulseEmoteImg emote={emote} backendUrl={backendUrl} width={18} height={18} style={styles.img} />
              <span style={styles.name}>{emote.name}</span>
              <span style={styles.count}>{formatCount(emote.count)}</span>
            </li>
          ))}
      </ul>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    background: 'rgba(139, 92, 246, 0.08)',
    border: '1px solid rgba(167, 139, 250, 0.2)',
    borderRadius: 8,
    marginTop: 10,
    padding: '10px 12px',
  },
  title: { color: theme.textPrimary, fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' },
  subtitle: { color: theme.textSecondary, fontSize: 11, marginBottom: 8, marginTop: 4 },
  list: { display: 'grid', gap: 6, listStyle: 'none', margin: 0, padding: 0 },
  item: { alignItems: 'center', display: 'flex', gap: 8 },
  img: { display: 'block', objectFit: 'contain' },
  name: { color: theme.textPrimary, flex: 1, fontSize: 12, fontWeight: 700 },
  count: { color: theme.textMuted, fontSize: 11, fontVariantNumeric: 'tabular-nums' },
}
