import type { CSSProperties } from 'react'
import {
  deriveLiveHeat,
  formatHeatOffset,
  LIVE_HEAT_COLLECTING_LABEL,
  LIVE_HEAT_MAX_EMOTES,
  LIVE_HEAT_SUBTITLE,
  LIVE_HEAT_TITLE,
  toLiveHeatInputFromExtension,
  type LiveHeatPoint,
} from '@streamclone/pulse-core'
import type { PulsePayload } from '../shared/messages.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { formatCount } from './mostReacted.ts'
import { EmoteSpikeInspector } from './EmoteSpikeInspector.tsx'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { theme } from './theme.ts'

export interface MostReactedSectionProps {
  payload: PulsePayload
  backendUrl: string
  onJump: (point: LiveHeatPoint) => void
}

function ScoreBadge({
  score,
  estimated,
  muted,
}: {
  score: number
  estimated?: boolean
  muted?: boolean
}) {
  return (
    <span
      style={{
        ...styles.scoreBadge,
        ...(muted ? styles.scoreBadgeMuted : styles.scoreBadgeActive),
      }}
      title={
        estimated
          ? 'Estimated from local rollups until heatmap scoring is available.'
          : 'Backend replay heatmap score.'
      }
    >
      {estimated ? `~${score}` : score}
    </span>
  )
}

function EmoteStack({
  point,
  backendUrl,
}: {
  point: LiveHeatPoint
  backendUrl: string
}) {
  if (point.topEmotes.length === 0) return null
  return (
    <div style={styles.emoteStack}>
      {point.topEmotes.slice(0, LIVE_HEAT_MAX_EMOTES).map(emote => (
        <span
          key={emote.key}
          className="pulse-top-emote-chip"
          style={styles.emoteItem}
          title={`${emote.name}${emote.provider ? ` · ${emote.provider}` : ''} · ${formatCount(emote.count)}`}
        >
          <PulseEmoteImg emote={emote} backendUrl={backendUrl} width={20} height={20} style={styles.emoteImg} showHoverPreview />
        </span>
      ))}
    </div>
  )
}

function MomentRow({
  point,
  backendUrl,
  onJump,
}: {
  point: LiveHeatPoint
  backendUrl: string
  onJump: (point: LiveHeatPoint) => void
}) {
  const offsetLabel = formatHeatOffset(point.offsetSeconds)
  const collecting = point.collecting

  const body = (
    <div
      className={collecting ? undefined : 'pulse-moment-row'}
      style={{
        ...styles.momentRow,
        ...(collecting ? styles.momentRowCollecting : styles.momentRowInteractive),
      }}
    >
      <div style={styles.momentRowInner}>
        <ScoreBadge score={point.score} estimated={point.estimated} muted={collecting} />
        <div style={styles.momentMain}>
          <span style={styles.momentTitleRow}>
            <span style={styles.offsetLabel}>{offsetLabel}</span>
            {collecting ? (
              <span style={styles.collectingBadge}>{LIVE_HEAT_COLLECTING_LABEL}</span>
            ) : (
              <span style={styles.reasonLabel}>{point.reasonLabel}</span>
            )}
          </span>
          <span style={styles.countsLine}>
            {formatCount(point.chatCount)} chat · {formatCount(point.emoteCount)} emotes
          </span>
        </div>
        <EmoteStack point={point} backendUrl={backendUrl} />
      </div>
    </div>
  )

  if (collecting) {
    return body
  }

  return (
    <button
      type="button"
      className="pulse-row-rise"
      style={styles.momentButton}
      onClick={() => onJump(point)}
      aria-label={`Jump to ${offsetLabel}, score ${point.score}, ${point.reasonLabel}`}
    >
      {body}
    </button>
  )
}

export function MostReactedSection({ payload, backendUrl, onJump }: MostReactedSectionProps) {
  const heat = deriveLiveHeat(toLiveHeatInputFromExtension(payload))
  const inspectorPoint = heat.points.find(point => !point.collecting) ?? heat.collectingPoint

  if (!heat.visible) return null

  return (
    <PulseSectionCard title={LIVE_HEAT_TITLE} subtitle={LIVE_HEAT_SUBTITLE}>
      {inspectorPoint ? <EmoteSpikeInspector point={inspectorPoint} backendUrl={backendUrl} /> : null}
      <div style={styles.momentList}>
        {heat.points.map(point => (
          <MomentRow
            key={point.minuteTs}
            point={point}
            backendUrl={backendUrl}
            onJump={onJump}
          />
        ))}
        {heat.collectingPoint ? (
          <MomentRow
            point={heat.collectingPoint}
            backendUrl={backendUrl}
            onJump={onJump}
          />
        ) : null}
      </div>
    </PulseSectionCard>
  )
}

const styles: Record<string, CSSProperties> = {
  momentList: { display: 'grid', gap: 8 },
  momentButton: {
    background: 'transparent',
    border: 0,
    color: 'inherit',
    cursor: 'pointer',
    display: 'block',
    padding: 0,
    textAlign: 'left',
    width: '100%',
  },
  momentRow: {
    borderRadius: 8,
    border: '1px solid rgba(255, 255, 255, 0.1)',
    padding: '8px 12px',
    transition: 'border-color 0.15s ease, background 0.15s ease',
  },
  momentRowInteractive: {
    background: 'rgba(255, 255, 255, 0.05)',
  },
  momentRowCollecting: {
    background: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    opacity: 0.6,
  },
  momentRowInner: {
    alignItems: 'center',
    display: 'flex',
    gap: 12,
    justifyContent: 'space-between',
    width: '100%',
  },
  scoreBadge: {
    borderRadius: 6,
    display: 'inline-block',
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 900,
    minWidth: 36,
    padding: '4px 6px',
    textAlign: 'center',
    fontVariantNumeric: 'tabular-nums',
  },
  scoreBadgeActive: {
    background: 'rgba(139, 92, 246, 0.15)',
    border: '1px solid rgba(167, 139, 250, 0.3)',
    color: '#ddd6fe',
  },
  scoreBadgeMuted: {
    background: 'rgba(255, 255, 255, 0.05)',
    color: theme.textMuted,
  },
  momentMain: { display: 'grid', flex: 1, gap: 3, minWidth: 0 },
  momentTitleRow: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 },
  offsetLabel: {
    color: theme.textSecondary,
    fontSize: 12,
    fontWeight: 800,
    fontVariantNumeric: 'tabular-nums',
  },
  reasonLabel: { color: theme.textMuted, fontSize: 11, fontWeight: 700 },
  countsLine: { color: theme.textMuted, fontSize: 11, fontWeight: 600 },
  collectingBadge: {
    background: 'rgba(245, 158, 11, 0.1)',
    border: '1px solid rgba(245, 158, 11, 0.3)',
    borderRadius: 999,
    color: '#fde68a',
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.04em',
    padding: '2px 8px',
    textTransform: 'uppercase',
  },
  emoteStack: { alignItems: 'center', display: 'flex', flexShrink: 0, gap: 4 },
  emoteItem: { alignItems: 'center', display: 'inline-flex' },
  emoteImg: { display: 'block', height: 20, objectFit: 'contain', width: 20 },
  emoteNameFallback: { color: theme.textSecondary, fontSize: 11, fontWeight: 700 },
}
