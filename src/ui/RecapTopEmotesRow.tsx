import type { CSSProperties } from 'react'
import type { ExtensionEmote } from '../shared/messages.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { theme } from './theme.ts'

const MAX_RECAP_EMOTES = 4

function formatEmoteCount(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(Math.max(0, value))
}

export interface RecapTopEmotesRowProps {
  backendUrl: string
  emotes: ExtensionEmote[]
  compact?: boolean
}

export function RecapTopEmotesRow({ backendUrl, emotes, compact = false }: RecapTopEmotesRowProps) {
  const visible = emotes.filter(emote => emote.count > 0).slice(0, MAX_RECAP_EMOTES)
  if (visible.length === 0) return null

  return (
    <div style={compact ? styles.wrapCompact : styles.wrap}>
      <div style={styles.header}>
        <span style={styles.title}>Top emotes this stream</span>
        <span style={styles.hint}>Plot emotes on the chart above.</span>
      </div>
      <div style={compact ? styles.gridCompact : styles.grid}>
        {visible.map((emote, index) => (
          <div
            key={emote.id ?? `${emote.name}-${index}`}
            style={styles.cell}
            title={emote.name}
          >
            <span style={styles.rank}>{index + 1}</span>
            <PulseEmoteImg
              backendUrl={backendUrl}
              emote={emote}
              width={compact ? 24 : 28}
              height={compact ? 24 : 28}
              style={styles.cellImg}
            />
            <span style={styles.cellName}>{emote.name}</span>
            <span style={styles.cellCount}>{formatEmoteCount(emote.count)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'grid', gap: 6 },
  wrapCompact: { display: 'grid', gap: 5 },
  header: { display: 'grid', gap: 2 },
  title: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  hint: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 600,
    lineHeight: 1.35,
  },
  grid: { display: 'grid', gap: 6, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  gridCompact: { display: 'grid', gap: 5, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  cell: {
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 9,
    color: theme.textPrimary,
    display: 'flex',
    gap: 7,
    minWidth: 0,
    overflow: 'hidden',
    padding: '5px 9px 5px 8px',
  },
  rank: {
    color: theme.textMuted,
    flexShrink: 0,
    fontSize: 9,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 800,
    minWidth: 10,
    textAlign: 'center',
  },
  cellImg: { display: 'block', flexShrink: 0, objectFit: 'contain' },
  cellName: {
    flex: 1,
    fontSize: 11,
    fontWeight: 700,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cellCount: {
    color: theme.textSecondary,
    flexShrink: 0,
    fontSize: 10,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 700,
  },
}
