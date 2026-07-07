import type { CSSProperties, MouseEvent } from 'react'
import { formatHeatOffset } from '@streamclone/pulse-core'
import type { VodTimelinePoint } from '../types/vodPulseTypes.ts'
import { normalizeTimelineValues, seekOffsetFromGraphClick, timelineYValue } from '../vod/vodCurrentMoment.ts'
import { theme } from './theme.ts'

export interface VodPulseTimelineProps {
  points: VodTimelinePoint[]
  currentTimeSeconds: number
  durationSeconds: number
  topMomentOffsets?: number[]
  onSeek: (offsetSeconds: number) => void
  playbackSynced?: boolean
}

const WIDTH = 280
const HEIGHT = 56
const PAD = 4

export function VodPulseTimeline({
  points,
  currentTimeSeconds,
  durationSeconds,
  topMomentOffsets = [],
  onSeek,
  playbackSynced = true,
}: VodPulseTimelineProps) {
  if (points.length < 2 || durationSeconds <= 0) {
    return (
      <div style={styles.empty} role="img" aria-label="Chat activity timeline unavailable">
        Not enough timeline data yet.
      </div>
    )
  }

  const normalized = normalizeTimelineValues(points)
  const maxY = Math.max(1, ...points.map(timelineYValue))
  const path = normalized
    .map((value, index) => {
      const x = PAD + (index / Math.max(1, normalized.length - 1)) * (WIDTH - PAD * 2)
      const y = HEIGHT - PAD - value * (HEIGHT - PAD * 2)
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')

  const playheadX =
    PAD + (Math.min(durationSeconds, Math.max(0, currentTimeSeconds)) / durationSeconds) * (WIDTH - PAD * 2)

  const markers = topMomentOffsets.slice(0, 6).map(offset => ({
    offset,
    x: PAD + (offset / durationSeconds) * (WIDTH - PAD * 2),
  }))

  function handleClick(event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    onSeek(seekOffsetFromGraphClick(event.clientX, rect, durationSeconds))
  }

  return (
    <div style={styles.wrap}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        role="img"
        aria-label="VOD chat activity timeline"
        style={styles.svg}
        onClick={handleClick}
      >
        <line x1={PAD} y1={HEIGHT - PAD} x2={WIDTH - PAD} y2={HEIGHT - PAD} stroke="rgba(255,255,255,0.08)" />
        <path d={path} fill="none" stroke={theme.live} strokeWidth="1.5" />
        {markers.map(marker => (
          <circle
            key={marker.offset}
            cx={marker.x}
            cy={HEIGHT - PAD - 4}
            r="2.5"
            fill={theme.accent}
            opacity={0.85}
          />
        ))}
        {playbackSynced ? (
          <line
            x1={playheadX}
            y1={PAD}
            x2={playheadX}
            y2={HEIGHT - PAD}
            stroke={theme.accentInk}
            strokeWidth="1.5"
            opacity={0.9}
          />
        ) : null}
      </svg>
      <div style={styles.footer}>
        <span>{formatHeatOffset(0)}</span>
        <span style={styles.peakLabel}>peak {Math.round(maxY)}</span>
        <span>{formatHeatOffset(durationSeconds)}</span>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'grid', gap: 4 },
  svg: { cursor: 'pointer', display: 'block' },
  footer: {
    color: theme.textMuted,
    display: 'flex',
    fontSize: 9,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 700,
    justifyContent: 'space-between',
  },
  peakLabel: { color: theme.textSecondary },
  empty: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px dashed rgba(255,255,255,0.1)',
    borderRadius: 8,
    color: theme.textMuted,
    fontSize: 11,
    padding: '10px 12px',
  },
}
