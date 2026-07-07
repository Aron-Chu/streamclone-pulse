import type { CSSProperties } from 'react'
import { formatHeatOffset } from '@streamclone/pulse-core'
import type { VodMoment } from '../types/vodPulseTypes.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { theme } from './theme.ts'

export function VodTopMomentsList({
  moments,
  backendUrl,
  onSeek,
}: {
  moments: VodMoment[]
  backendUrl: string
  onSeek: (offsetSeconds: number) => void
}) {
  if (moments.length === 0) return null
  return (
    <div style={styles.wrap}>
      <span style={styles.title}>Top moments</span>
      <div style={styles.list}>
        {moments.map((moment, index) => (
          <button
            key={`${moment.offsetSeconds}-${moment.score ?? 0}-${index}`}
            type="button"
            style={styles.row}
            onClick={() => onSeek(moment.offsetSeconds)}
          >
            <span style={styles.rank}>{index + 1}</span>
            <span style={styles.main}>
              <span style={styles.time}>{formatHeatOffset(moment.offsetSeconds)}</span>
              <span style={styles.label}>{moment.label}</span>
            </span>
            {moment.score != null && moment.score > 0 ? (
              <span style={styles.score}>{moment.score}</span>
            ) : null}
            {moment.topEmotes && moment.topEmotes.length > 0 ? (
              <span style={styles.emotes}>
                {moment.topEmotes.slice(0, 3).map(emote => (
                  <PulseEmoteImg
                    key={emote.id ?? emote.name}
                    emote={emote}
                    backendUrl={backendUrl}
                    width={18}
                    height={18}
                  />
                ))}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'grid', gap: 6 },
  title: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  list: { display: 'grid', gap: 4 },
  row: {
    alignItems: 'center',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    color: theme.textPrimary,
    cursor: 'pointer',
    display: 'flex',
    gap: 8,
    padding: '6px 8px',
    textAlign: 'left',
    width: '100%',
  },
  rank: {
    color: theme.textMuted,
    flexShrink: 0,
    fontSize: 9,
    fontWeight: 800,
    width: 12,
  },
  main: { display: 'grid', flex: 1, gap: 1, minWidth: 0 },
  time: { fontSize: 11, fontVariantNumeric: 'tabular-nums', fontWeight: 800 },
  label: { color: theme.textMuted, fontSize: 10, fontWeight: 600 },
  score: { color: theme.accentInk, flexShrink: 0, fontSize: 10, fontWeight: 800 },
  emotes: { alignItems: 'center', display: 'flex', flexShrink: 0, gap: 3 },
}
