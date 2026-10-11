import { formatHeatOffset } from '@streampulse/pulse-core'
import type { ExtensionEmote } from '../shared/messages.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import type { ChartBarSummary } from './PulseOverviewChart.tsx'

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
  /** The averaged bar under the pointer or pin, while bars span several minutes. */
  bar?: ChartBarSummary | null
}

const READOUT_NUMBER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
})

const EMOTE_IMAGE_STYLE = { display: 'block', height: 16, objectFit: 'contain', width: 16 } as const

function formatReadoutNumber(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? READOUT_NUMBER.format(value)
    : '—'
}

// Static layout lives in shadow.css (.pulse-chart-readout-*, .pulse-readout-*).
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
  bar: barProp,
}: ChartReadoutBandProps) {
  const bar = mode === 'idle' ? null : barProp ?? null
  const title = mode === 'selected'
    ? 'Selected'
    : mode === 'preview'
      ? 'Preview'
      : 'Chart inspection'
  const time = bar
    ? `${formatHeatOffset(bar.startSeconds)}–${formatHeatOffset(bar.endSeconds)}`
    : typeof offsetSeconds === 'number' && Number.isFinite(offsetSeconds)
      ? formatHeatOffset(offsetSeconds)
      : '—'
  // Bar series: 0 chat, 1 emotes, 2 viewers (no viewer sample in the bar: peakAt -1).
  const viewerSample = bar ? (bar.peakAt[2]! < 0 ? null : Math.round(bar.avg[2]!)) : viewerValue
  const viewer = !viewerVisible
    ? '—'
    : typeof viewerSample === 'number' && Number.isFinite(viewerSample)
      ? formatReadoutNumber(viewerSample)
      : 'Unavailable'
  const visibleEmotes = mode === 'idle' || bar ? [] : topEmotes.slice(0, 3)
  const emoteScopeLabel = emoteScope === 'minute'
    ? 'Top emotes in this minute'
    : 'Stream top emotes; this minute has no emote breakdown'
  const metric = (label: string, value: string, peak?: number) => (
    <span className="pulse-readout-metric">
      <span className="pulse-readout-label">{label}</span>
      <strong className="pulse-readout-value">
        {value}
        {peak == null ? null : <small className="pulse-readout-peak"> pk {formatReadoutNumber(peak)}</small>}
      </strong>
    </span>
  )

  return (
    <div
      className="pulse-chart-readout-band"
      style={mode !== 'idle' ? { cursor: 'pointer' } : undefined}
      data-chart-readout="true"
      data-chart-readout-state={mode}
      aria-live={mode === 'selected' ? 'polite' : 'off'}
      onClick={event => {
        if (mode === 'idle') return
        const target = event.target as HTMLElement | null
        if (target?.closest('button, a, input, select')) return
        onClearSelection?.()
      }}
    >
      <div
        key={bar ? `${mode}:bar:${bar.step}:${bar.startSeconds}` : `${mode}:${offsetSeconds ?? 'idle'}`}
        className="pulse-chart-readout-content"
      >
        <div className="pulse-readout-header">
          <span className="pulse-readout-kicker">{title}</span>
          <span className="pulse-readout-time">{time}</span>
          {bar ? (
            <span
              className="pulse-readout-kicker pulse-readout-note"
              data-chart-readout-bar={bar.step}
              data-chart-readout-bar-partial={bar.observed < bar.expected ? 'true' : undefined}
            >
              {bar.step}-min avg{bar.observed < bar.expected ? ` · ${bar.observed}/${bar.expected} min` : ''}
            </span>
          ) : null}
          {visibleEmotes.length > 0 ? (
            <span
              className="pulse-readout-emotes"
              aria-label={emoteScopeLabel}
              data-chart-readout-emotes="true"
              data-chart-readout-emote-scope={emoteScope}
              title={emoteScopeLabel}
            >
              {visibleEmotes.map(emote => (
                <span
                  key={`${emote.provider ?? 'emote'}:${emote.id ?? emote.name}`}
                  className="pulse-readout-emote"
                  data-chart-readout-emote="true"
                  title={`${emote.name}${emoteScope === 'stream' ? ' · stream total' : ''}`}
                >
                  <PulseEmoteImg
                    emote={emote}
                    backendUrl={backendUrl}
                    width={16}
                    height={16}
                    style={EMOTE_IMAGE_STYLE}
                    showHoverPreview={false}
                    previewFocusable={false}
                    eager
                  />
                </span>
              ))}
            </span>
          ) : null}
          {mode === 'idle' ? (
            <span className="pulse-readout-hint">Hover the chart to inspect a minute.</span>
          ) : null}
        </div>
        <div className="pulse-readout-metrics" data-chart-readout-metrics="true">
          {metric('Viewers', viewer)}
          {metric('Chat/min', formatReadoutNumber(bar ? bar.avg[0] : chatValue), bar?.peak[0])}
          {metric('Emotes/min', formatReadoutNumber(bar ? bar.avg[1] : emoteValue), bar?.peak[1])}
        </div>
      </div>
    </div>
  )
}
