import type { CSSProperties } from 'react'
import { formatHeatOffset } from '@streampulse/pulse-core'
import type { VodClipCandidate } from '../types/vodPulseTypes.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { theme } from './theme.ts'

export function VodBestClipCard({
  candidate,
  backendUrl,
  onSeek,
}: {
  candidate: VodClipCandidate
  backendUrl: string
  onSeek: (offsetSeconds: number) => void
}) {
  return (
    <div style={styles.wrap}>
      <span style={styles.title}>Best clip candidate</span>
      <div style={styles.body}>
        {candidate.thumbnailUrl ? (
          <img src={candidate.thumbnailUrl} alt="" style={styles.thumb} />
        ) : null}
        <div style={styles.meta}>
          <strong style={styles.time}>
            {formatHeatOffset(candidate.offsetSeconds)}
            {candidate.durationSeconds ? ` · ${candidate.durationSeconds}s` : ''}
          </strong>
          <span style={styles.label}>{candidate.label}</span>
          <span style={styles.reason}>{candidate.reason}</span>
          {candidate.topEmotes && candidate.topEmotes.length > 0 ? (
            <div style={styles.emotes}>
              {candidate.topEmotes.slice(0, 4).map(emote => (
                <PulseEmoteImg
                  key={emote.id ?? emote.name}
                  emote={emote}
                  backendUrl={backendUrl}
                  width={22}
                  height={22}
                />
              ))}
            </div>
          ) : null}
          <button type="button" style={styles.button} onClick={() => onSeek(candidate.offsetSeconds)}>
            Jump to moment
          </button>
        </div>
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
  body: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10,
    display: 'flex',
    gap: 10,
    padding: 10,
  },
  thumb: { borderRadius: 8, flexShrink: 0, height: 56, objectFit: 'cover', width: 96 },
  meta: { display: 'grid', flex: 1, gap: 4, minWidth: 0 },
  time: { color: theme.textPrimary, fontSize: 12, fontWeight: 800 },
  label: { color: theme.textSecondary, fontSize: 11, fontWeight: 700 },
  reason: { color: theme.textMuted, fontSize: 10, fontWeight: 600, lineHeight: 1.35 },
  emotes: { alignItems: 'center', display: 'flex', gap: 4 },
  button: {
    background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.22)',
    border: '1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45)',
    borderRadius: 8,
    color: theme.accentInk,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 800,
    marginTop: 4,
    padding: '6px 10px',
    width: 'fit-content',
  },
}
