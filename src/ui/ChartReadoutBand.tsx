import type { CSSProperties } from 'react'
import { formatHeatOffset } from '@streampulse/pulse-core'
import type { ExtensionEmote } from '../shared/messages.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { theme } from './theme.ts'

export type ChartReadoutMode = 'idle' | 'preview' | 'selected'

export interface ChartReadoutBandProps {
  mode: ChartReadoutMode
  offsetSeconds?: number | null
  viewerValue?: number | null
  chatValue?: number | null
  emoteValue?: number | null
  viewerVisible?: boolean
  topEmotes?: ExtensionEmote[]
  backendUrl: string
  emoteScope?: 'minute' | 'stream'
  onClearSelection?: () => void
}

const READOUT_NUMBER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
})

function formatReadoutNumber(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? READOUT_NUMBER.format(value)
    : '—'
}

export function ChartReadoutBand({
  mode,
  offsetSeconds,
  viewerValue,
  chatValue,
  emoteValue,
  viewerVisible = true,
  topEmotes = [],
  backendUrl,
  emoteScope = 'minute',
  onClearSelection,
}: ChartReadoutBandProps) {
  // Nothing hovered or picked: one quiet line in the band's usual height, not a row of blanks.
  if (mode === 'idle') {
    return (
      <div className="pulse-chart-readout-band" style={{ ...styles.band, ...styles.idleBand }} data-chart-readout="true" data-chart-readout-state="idle" aria-live="off">
        <span style={styles.idleHint}>Hover the chart to inspect a minute.</span>
      </div>
    )
  }
  const title = mode === 'selected' ? 'Selected' : 'Preview'
  const time = typeof offsetSeconds === 'number' && Number.isFinite(offsetSeconds)
    ? formatHeatOffset(offsetSeconds)
    : '—'
  const viewer = !viewerVisible
    ? '—'
    : typeof viewerValue === 'number' && Number.isFinite(viewerValue)
      ? formatReadoutNumber(viewerValue)
      : 'Unavailable'
  const visibleEmotes = topEmotes.slice(0, 3)
  const emoteScopeLabel = emoteScope === 'minute'
    ? 'Top emotes in this minute'
    : 'Stream top emotes; this minute has no emote breakdown'

  return (
    <div
      className="pulse-chart-readout-band"
      style={{
        ...styles.band,
        cursor: 'pointer',
      }}
      data-chart-readout="true"
      data-chart-readout-state={mode}
      aria-live={mode === 'selected' ? 'polite' : 'off'}
      onClick={event => {
        const target = event.target as HTMLElement | null
        if (target?.closest('button, a, input, select')) return
        onClearSelection?.()
      }}
    >
      <div
        key={`${mode}:${offsetSeconds ?? 'none'}`}
        className="pulse-chart-readout-content"
        style={styles.content}
      >
        <div style={styles.header}>
          <span style={styles.kicker}>{title}</span>
          <span style={styles.time}>{time}</span>
          {visibleEmotes.length > 0 ? (
            <span
              style={styles.emotes}
              aria-label={emoteScopeLabel}
              data-chart-readout-emotes="true"
              data-chart-readout-emote-scope={emoteScope}
              title={emoteScopeLabel}
            >
              {visibleEmotes.map(emote => (
                <span
                  key={`${emote.provider ?? 'emote'}:${emote.id ?? emote.name}`}
                  style={styles.emote}
                  data-chart-readout-emote="true"
                  title={`${emote.name}${emoteScope === 'stream' ? ' · stream total' : ''}`}
                >
                  <PulseEmoteImg
                    emote={emote}
                    backendUrl={backendUrl}
                    width={16}
                    height={16}
                    style={styles.emoteImage}
                    showHoverPreview={false}
                    previewFocusable={false}
                    eager
                  />
                </span>
              ))}
            </span>
          ) : null}
        </div>
        <div style={styles.metrics} data-chart-readout-metrics="true">
          <span style={styles.metric}>
            <span style={styles.metricLabel}>Viewers</span>
            <strong style={styles.metricValue}>{viewer}</strong>
          </span>
          <span style={styles.metric}>
            <span style={styles.metricLabel}>Chat/min</span>
            <strong style={styles.metricValue}>{formatReadoutNumber(chatValue)}</strong>
          </span>
          <span style={styles.metric}>
            <span style={styles.metricLabel}>Emotes/min</span>
            <strong style={styles.metricValue}>{formatReadoutNumber(emoteValue)}</strong>
          </span>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  band: {
    background: 'rgba(255, 255, 255, 0.025)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    boxSizing: 'border-box',
    display: 'grid',
    gap: 4,
    height: 60,
    minHeight: 60,
    overflow: 'hidden',
    padding: '6px 8px',
    width: '100%',
  },
  content: {
    display: 'grid',
    gap: 3,
    gridTemplateRows: '16px 27px',
    minWidth: 0,
  },
  header: {
    alignItems: 'center',
    display: 'flex',
    gap: 6,
    minWidth: 0,
    whiteSpace: 'nowrap',
  },
  kicker: {
    color: theme.accent2,
    flexShrink: 0,
    fontSize: 10,
    fontWeight: 800,
  },
  time: {
    color: theme.textPrimary,
    flexShrink: 0,
    fontSize: 11,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 800,
  },
  emotes: {
    alignItems: 'center',
    display: 'inline-flex',
    gap: 4,
    marginLeft: 'auto',
    minWidth: 0,
    overflow: 'hidden',
  },
  emote: {
    alignItems: 'center',
    display: 'inline-flex',
    flexShrink: 0,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  emoteImage: { display: 'block', height: 16, objectFit: 'contain', width: 16 },
  idleBand: { alignItems: 'center', justifyItems: 'center' },
  idleHint: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: 600,
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  metrics: {
    alignItems: 'center',
    display: 'grid',
    gap: 8,
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    minWidth: 0,
  },
  metric: {
    display: 'grid',
    gap: 1,
    lineHeight: 1.1,
    minWidth: 0,
  },
  metricLabel: {
    color: theme.textMuted,
    flexShrink: 0,
    fontSize: 10,
    fontWeight: 700,
  },
  metricValue: {
    color: theme.textSecondary,
    fontSize: 10,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 800,
    lineHeight: 1.2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
}
