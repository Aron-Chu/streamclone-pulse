import type { CSSProperties } from 'react'
import { formatHeatOffset } from '@streampulse/pulse-core'
import type { ExtensionEmote } from '../shared/messages.ts'
import type { CurrentMomentInsight } from '../vod/vodCurrentMoment.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { theme } from './theme.ts'

export function VodCurrentMomentCard({
  currentTimeSeconds,
  insight,
  chatPerMin,
  emotePerMin,
  score,
  topEmotes,
  backendUrl,
}: {
  currentTimeSeconds: number
  insight: CurrentMomentInsight
  chatPerMin?: number
  emotePerMin?: number
  score?: number
  topEmotes?: ExtensionEmote[]
  backendUrl: string
}) {
  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <span style={styles.badge}>Current moment</span>
        <span style={styles.time}>{formatHeatOffset(currentTimeSeconds)}</span>
      </div>
      <strong style={styles.label}>{insight.label}</strong>
      {insight.detail ? <span style={styles.detail}>{insight.detail}</span> : null}
      <div style={styles.metrics}>
        {chatPerMin != null && chatPerMin > 0 ? (
          <span>{chatPerMin} chat/min</span>
        ) : null}
        {score != null && score > 0 ? <span>{score} score</span> : null}
        {emotePerMin != null && emotePerMin > 0 ? (
          <span>{emotePerMin} emotes/min</span>
        ) : null}
      </div>
      {topEmotes && topEmotes.length > 0 ? (
        <div style={styles.emotes}>
          {topEmotes.slice(0, 5).map(emote => (
            <PulseEmoteImg
              key={emote.id ?? emote.name}
              emote={emote}
              backendUrl={backendUrl}
              width={24}
              height={24}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10,
    display: 'grid',
    gap: 8,
    padding: 12,
  },
  header: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 },
  badge: {
    background: 'rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.18)',
    borderRadius: 999,
    color: theme.accentInk,
    fontSize: 8,
    fontWeight: 900,
    letterSpacing: '0.06em',
    padding: '2px 7px',
    textTransform: 'uppercase',
  },
  time: { fontSize: 14, fontVariantNumeric: 'tabular-nums', fontWeight: 900 },
  label: { color: theme.textPrimary, fontSize: 13, fontWeight: 800 },
  detail: { color: theme.textSecondary, fontSize: 11, fontWeight: 600 },
  metrics: {
    color: theme.textMuted,
    display: 'flex',
    flexWrap: 'wrap',
    fontSize: 10,
    fontWeight: 700,
    gap: 10,
  },
  emotes: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 5 },
}
