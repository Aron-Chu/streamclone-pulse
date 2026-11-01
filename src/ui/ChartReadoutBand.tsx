import type { CSSProperties } from 'react'
import { formatHeatOffset } from '@streampulse/pulse-core'
import type { ExtensionEmote } from '../shared/messages.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'

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
      <div className="pulse-chart-readout-band pulse-rb pulse-rb-idle" data-chart-readout="true" data-chart-readout-state="idle" aria-live="off">
        <span className="pulse-rb-hint">Hover the chart to inspect a minute.</span>
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
      className="pulse-chart-readout-band pulse-rb pulse-rb-picked"
      data-chart-readout="true"
      data-chart-readout-state={mode}
      aria-live={mode === 'selected' ? 'polite' : 'off'}
      // Updated in place, so a new pick reads out whole, as a remount used to.
      aria-atomic="true"
      onClick={event => {
        const target = event.target as HTMLElement | null
        if (target?.closest('button, a, input, select')) return
        onClearSelection?.()
      }}
    >
      <div className="pulse-chart-readout-content pulse-rb-content">
        <div className="pulse-rb-header">
          <span className="pulse-rb-kicker">{title}</span>
          <span className="pulse-rb-time">{time}</span>
          {visibleEmotes.length > 0 ? (
            <span
              className="pulse-rb-emotes"
              aria-label={emoteScopeLabel}
              data-chart-readout-emotes="true"
              data-chart-readout-emote-scope={emoteScope}
              title={emoteScopeLabel}
            >
              {visibleEmotes.map(emote => (
                <span
                  key={`${emote.provider ?? 'emote'}:${emote.id ?? emote.name}`}
                  className="pulse-rb-emote"
                  data-chart-readout-emote="true"
                  title={`${emote.name}${emoteScope === 'stream' ? ' · stream total' : ''}`}
                >
                  <PulseEmoteImg
                    emote={emote}
                    backendUrl={backendUrl}
                    width={16}
                    height={16}
                    style={emoteImageStyle}
                    showHoverPreview={false}
                    previewFocusable={false}
                    eager
                  />
                </span>
              ))}
            </span>
          ) : null}
        </div>
        <div className="pulse-rb-metrics" data-chart-readout-metrics="true">
          <span className="pulse-rb-metric">
            <span className="pulse-rb-label">Viewers</span>
            <strong className="pulse-rb-value">{viewer}</strong>
          </span>
          <span className="pulse-rb-metric">
            <span className="pulse-rb-label">Chat/min</span>
            <strong className="pulse-rb-value">{formatReadoutNumber(chatValue)}</strong>
          </span>
          <span className="pulse-rb-metric">
            <span className="pulse-rb-label">Emotes/min</span>
            <strong className="pulse-rb-value">{formatReadoutNumber(emoteValue)}</strong>
          </span>
        </div>
      </div>
    </div>
  )
}

/** PulseEmoteImg merges this into its own inline style. */
const emoteImageStyle: CSSProperties = { display: 'block', height: 16, objectFit: 'contain', width: 16 }
