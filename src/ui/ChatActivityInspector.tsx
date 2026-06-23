import type { CSSProperties } from 'react'
import { formatHeatOffset } from '@streamclone/pulse-core'
import type { ExtensionEmote } from '../shared/messages.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { formatCount } from './mostReacted.ts'
import { theme } from './theme.ts'

export interface ChatActivityInspectorProps {
  open: boolean
  backendUrl: string
  offsetSeconds: number | null
  emotes: ExtensionEmote[]
  onClose: () => void
}

export function ChatActivityInspector({
  open,
  backendUrl,
  offsetSeconds,
  emotes,
  onClose,
}: ChatActivityInspectorProps) {
  if (!open) return null

  const title =
    offsetSeconds != null
      ? `7TV emotes near ${formatHeatOffset(offsetSeconds)}`
      : 'Top 7TV emotes (recent window)'

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div style={styles.headerCopy}>
          <span style={styles.title}>{title}</span>
          <span style={styles.subtitle}>
            {emotes.length > 0
              ? 'Most used in this minute window'
              : 'No 7TV identity in this slice — aggregate spikes may still appear in chat.'}
          </span>
        </div>
        <button type="button" style={styles.closeButton} onClick={onClose} aria-label="Close emote inspector">
          ×
        </button>
      </div>
      {emotes.length > 0 ? (
        <ul style={styles.list}>
          {emotes.map((emote, index) => (
              <li key={emote.id ?? `${emote.name}-${index}`} className="pulse-inspector-emote-row" style={styles.item}>
                <span style={styles.rank}>{index + 1}</span>
                <PulseEmoteImg emote={emote} backendUrl={backendUrl} width={22} height={22} style={styles.img} />
                <span style={styles.name}>{emote.name}</span>
                <span style={styles.count}>{formatCount(emote.count)}</span>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  panel: {
    background: 'rgba(24, 24, 31, 0.92)',
    border: '1px solid rgba(167, 139, 250, 0.28)',
    borderRadius: 10,
    marginTop: 8,
    overflow: 'hidden',
  },
  header: {
    alignItems: 'flex-start',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    display: 'flex',
    gap: 8,
    justifyContent: 'space-between',
    padding: '10px 12px',
  },
  headerCopy: { display: 'grid', gap: 3, minWidth: 0 },
  title: {
    color: theme.textPrimary,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  subtitle: { color: theme.textMuted, fontSize: 10, fontWeight: 600, lineHeight: 1.35 },
  closeButton: {
    background: 'transparent',
    border: 0,
    color: theme.textSecondary,
    cursor: 'pointer',
    fontSize: 18,
    fontWeight: 700,
    lineHeight: 1,
    padding: '0 4px',
  },
  list: { display: 'grid', gap: 6, listStyle: 'none', margin: 0, padding: '10px 12px 12px' },
  item: { alignItems: 'center', display: 'grid', gap: 8, gridTemplateColumns: '18px 22px 1fr auto' },
  rank: { color: theme.textMuted, fontSize: 10, fontWeight: 800, textAlign: 'right' },
  img: { display: 'block', objectFit: 'contain' },
  nameFallback: { color: theme.textSecondary, fontSize: 9, fontWeight: 800 },
  name: { color: theme.textPrimary, fontSize: 12, fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  count: { color: '#c4b5fd', fontSize: 11, fontVariantNumeric: 'tabular-nums', fontWeight: 800 },
}
