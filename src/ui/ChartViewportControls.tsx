import type { CSSProperties } from 'react'
import { formatHeatOffset } from '@streampulse/pulse-core'
import type { ExtensionRollup } from '../shared/messages.ts'
import type { ChartViewport } from './chartViewport.ts'
import type { ChartViewportChangeCause } from './chartNavigation.ts'
import { ChartPositionRail, LONG_STREAM_OVERVIEW_SECONDS, shouldShowChartRail } from './ChartPositionRail.tsx'
import { theme } from './theme.ts'

export interface ChartViewportControlsProps {
  viewport: ChartViewport
  durationSeconds: number
  minuteRollups?: ExtensionRollup[]
  coverageStartSeconds?: number
  zoomed: boolean
  markersEnabled: boolean
  showZoomHint: boolean
  disabled?: boolean
  onViewportChange: (
    viewport: ChartViewport,
    cause?: ChartViewportChangeCause,
  ) => void
  onToggleMarkers: () => void
  onReset: () => void
  onDismissZoomHint: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  animateRail?: boolean
}

export function ChartViewportControls({
  viewport,
  durationSeconds,
  minuteRollups,
  coverageStartSeconds = 0,
  zoomed,
  markersEnabled,
  showZoomHint,
  disabled = false,
  onViewportChange,
  onToggleMarkers,
  onReset,
  onDismissZoomHint,
  onZoomIn,
  onZoomOut,
  animateRail = false,
}: ChartViewportControlsProps) {
  if (!shouldShowChartRail(viewport, durationSeconds)) return null

  const rangeLabel = `${formatHeatOffset(viewport.startSeconds)}–${formatHeatOffset(viewport.endSeconds)} / ${formatHeatOffset(durationSeconds)}`

  return (
    <>
      <div style={styles.railRow} data-chart-viewport-controls="true">
        <div style={styles.railLine} data-chart-rail-line="true">
          <ChartPositionRail
            viewport={viewport}
            durationSeconds={durationSeconds}
            minuteRollups={minuteRollups}
            coverageStartSeconds={coverageStartSeconds}
            onViewportChange={onViewportChange}
            disabled={disabled}
            plotInsetLeft={4}
            plotInsetRight={12}
            animateChanges={animateRail}
          />
        </div>
        <span style={styles.zoomCluster} data-chart-zoom-cluster="true">
          <button
            type="button"
            style={styles.zoomButton}
            data-chart-zoom-in="true"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={onZoomIn}
            disabled={disabled}
          >
            +
          </button>
          <button
            type="button"
            style={styles.zoomButton}
            data-chart-zoom-out="true"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={onZoomOut}
            disabled={disabled || !zoomed}
          >
            −
          </button>
          {zoomed ? (
            <button
              type="button"
              style={styles.resetButton}
              data-chart-zoom-reset="true"
              aria-label="Reset chart view"
              title="Show the full stream"
              onClick={onReset}
              disabled={disabled}
            >
              Reset view
            </button>
          ) : null}
        </span>
        {zoomed ? (
          <span style={styles.zoomedBadge} data-chart-zoomed="true">Zoomed</span>
        ) : null}
        <button
          type="button"
          style={{ ...styles.railAction, opacity: markersEnabled ? 1 : 0.7 }}
          title="Toggle reaction windows and spike markers on the chart"
          aria-pressed={markersEnabled}
          onClick={onToggleMarkers}
          disabled={disabled}
        >
          {markersEnabled ? 'Markers on' : 'Markers'}
        </button>
        <span style={styles.rangeLabel} data-chart-visible-range="true">
          {rangeLabel}
        </span>
      </div>
      {showZoomHint && durationSeconds >= LONG_STREAM_OVERVIEW_SECONDS ? (
        <p style={styles.gapNotice} data-chart-zoom-hint="true">
          Scroll to zoom · Shift + scroll or drag to pan · Ctrl/⌘ + scroll to zoom · Alt+arrows resize{' '}
          <button type="button" style={styles.hintAction} onClick={onDismissZoomHint}>
            Got it
          </button>
        </p>
      ) : null}
    </>
  )
}

const styles: Record<string, CSSProperties> = {
  railRow: {
    alignItems: 'center',
    boxSizing: 'border-box',
    columnGap: 8,
    display: 'flex',
    flexWrap: 'wrap',
    minWidth: 0,
    rowGap: 5,
    width: '100%',
  },
  // Portal parity: the zoom bar owns a full-width line under the plot instead
  // of competing with the action buttons for horizontal space.
  railLine: {
    alignItems: 'center',
    boxSizing: 'border-box',
    display: 'flex',
    flexBasis: '100%',
    minWidth: 0,
  },
  railAction: {
    background: 'transparent',
    border: 0,
    color: theme.accentTextSubtle,
    cursor: 'pointer',
    flex: '0 0 auto',
    font: 'inherit',
    fontSize: 10,
    fontWeight: 800,
    minHeight: 20,
    padding: '2px 0',
    whiteSpace: 'nowrap',
  },
  hintAction: {
    background: 'transparent',
    border: 0,
    color: theme.accentText,
    cursor: 'pointer',
    font: 'inherit',
    fontWeight: 800,
    padding: 0,
    textDecoration: 'underline',
  },
  zoomedBadge: {
    background: theme.accentSurface,
    border: `1px solid ${theme.borderAccent}`,
    borderRadius: 999,
    boxSizing: 'border-box',
    color: theme.accentText,
    flex: '0 0 auto',
    fontSize: 9,
    fontWeight: 800,
    padding: '3px 6px',
    whiteSpace: 'nowrap',
  },
  zoomCluster: {
    alignItems: 'center',
    boxSizing: 'border-box',
    display: 'inline-flex',
    flex: '0 0 auto',
    gap: 4,
    minWidth: 0,
  },
  zoomButton: {
    background: theme.inputBg,
    border: `1px solid ${theme.border}`,
    borderRadius: 6,
    boxSizing: 'border-box',
    color: theme.textPrimary,
    cursor: 'pointer',
    flex: '0 0 auto',
    font: 'inherit',
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1,
    minHeight: 26,
    minWidth: 28,
    padding: '3px 7px',
    whiteSpace: 'nowrap',
  },
  resetButton: {
    background: theme.inputBg,
    border: `1px solid ${theme.borderAccent}`,
    borderRadius: 6,
    boxSizing: 'border-box',
    color: theme.accentText,
    cursor: 'pointer',
    flex: '0 0 auto',
    font: 'inherit',
    fontSize: 10,
    fontWeight: 800,
    lineHeight: 1,
    minHeight: 26,
    padding: '3px 8px',
    whiteSpace: 'nowrap',
  },
  rangeLabel: {
    color: theme.textMuted,
    flex: '1 1 auto',
    fontSize: 9,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 700,
    minWidth: 116,
    textAlign: 'right',
    whiteSpace: 'nowrap',
  },
  gapNotice: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1.35,
    margin: 0,
  },
}
