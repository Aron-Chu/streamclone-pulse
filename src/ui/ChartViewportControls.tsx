import { useRef, type CSSProperties, type ReactNode } from 'react'
import { viewportContainsOffset, viewportDurationSeconds, type ChartViewport } from './chartViewport.ts'
import { ChartPositionRail, shouldShowChartRail } from './ChartPositionRail.tsx'
import { PulseThemedSelect, type PulseSelectOption } from './PulseThemedSelect.tsx'
import { theme } from './theme.ts'

export interface ChartToolbarProps<T extends string = string> {
  rangeValue: T
  rangeOptions: readonly PulseSelectOption<T>[]
  rangeDisabled?: boolean
  onRangeChange: (value: T) => void
  auxiliaryControls?: ReactNode
  expandControl?: ReactNode
}

/** The chart's data-range and expansion controls share one stable toolbar row. */
export function ChartToolbar<T extends string>({
  rangeValue,
  rangeOptions,
  rangeDisabled = false,
  onRangeChange,
  auxiliaryControls,
  expandControl,
}: ChartToolbarProps<T>) {
  return (
    <div
      style={styles.toolbar}
      data-chart-toolbar="true"
      data-chart-range-controls="true"
    >
      <div style={styles.rangeControl} data-chart-action="true">
        <PulseThemedSelect
          label="Range"
          value={rangeValue}
          options={rangeOptions}
          disabled={rangeDisabled}
          ariaLabel="Chart time range"
          onChange={onRangeChange}
        />
      </div>
      {auxiliaryControls ? (
        <div
          style={styles.auxiliaryControls}
          data-chart-range-actions="true"
          data-chart-action="true"
        >
          {auxiliaryControls}
        </div>
      ) : null}
      {expandControl ? (
        <div style={styles.expandControl} data-chart-action="true">
          {expandControl}
        </div>
      ) : null}
    </div>
  )
}

export interface ChartViewportControlsProps {
  viewport: ChartViewport
  durationSeconds: number
  coverageStartSeconds?: number
  rangeLabel: string
  coverageHint?: ReactNode
  hasMeaningfulData?: boolean
  disabled?: boolean
  zoomInDisabled?: boolean
  zoomOutDisabled?: boolean
  resetDisabled?: boolean
  selectedOffsetSeconds?: number | null
  /** Narrow sidebars keep the rail full width; keyboard rail controls remain available. */
  hideZoomButtons?: boolean
  onViewportChange: (viewport: ChartViewport) => void
  onInteractionChange?: (active: boolean) => void
  onJumpToOffset?: (offsetSeconds: number) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
  onReturnToSelected?: () => void
}

export function ChartReturnToSelection({
  visible,
  onReturn,
}: {
  visible: boolean
  onReturn?: () => void
}) {
  if (!visible || !onReturn) return null
  return (
    <button
      type="button"
      data-chart-action="true"
      data-chart-return-to-selection="true"
      style={styles.returnToSelection}
      aria-label="Return to selected minute"
      onClick={onReturn}
    >
      Return to selected
    </button>
  )
}

/**
 * Coverage text and viewport controls live together directly under the plot.
 * The rail stays mounted for short, usable timelines and buttons become
 * disabled when there is no meaningful action instead of disappearing.
 */
export function ChartViewportControls({
  viewport,
  durationSeconds,
  coverageStartSeconds = 0,
  rangeLabel,
  coverageHint,
  hasMeaningfulData = true,
  disabled = false,
  zoomInDisabled = false,
  zoomOutDisabled = false,
  resetDisabled = false,
  selectedOffsetSeconds = null,
  onViewportChange,
  onInteractionChange,
  onJumpToOffset,
  onZoomIn,
  onZoomOut,
  onReset,
  onReturnToSelected,
}: ChartViewportControlsProps) {
  const railRef = useRef<HTMLDivElement>(null)
  if (!hasMeaningfulData || !shouldShowChartRail(viewport, durationSeconds, coverageStartSeconds)) return null

  const selectedOutsideViewport = selectedOffsetSeconds != null
    && !viewportContainsOffset(viewport, selectedOffsetSeconds)
  const viewportDuration = viewportDurationSeconds(viewport)
  const availableDuration = Math.max(0, durationSeconds - coverageStartSeconds)
  const isZoomed = availableDuration > 0 && viewportDuration < availableDuration - 1
  const zoomLabel = viewportDuration > 0
    ? `${Math.min(999, availableDuration / viewportDuration).toFixed(1)}x`
    : '1.0x'

  return (
    <div
      style={styles.viewportControls}
      data-chart-viewport-controls="true"
      data-chart-selection-state={selectedOffsetSeconds == null ? 'none' : selectedOutsideViewport ? 'off-screen' : 'in-view'}
    >
      <div style={styles.viewportMeta}>
        <div style={styles.rangeRow}>
          <span style={styles.rangeLabel} data-chart-visible-range="true" aria-live="polite">
            {rangeLabel}
          </span>
          <ChartReturnToSelection
            visible={selectedOutsideViewport}
            onReturn={onReturnToSelected}
          />
        </div>
        {coverageHint ? (
          <span
            style={styles.coverageHint}
            data-chart-coverage-hint="true"
            title={typeof coverageHint === 'string' ? coverageHint : undefined}
          >
            {coverageHint}
          </span>
        ) : null}
      </div>
      <div style={styles.viewportRow}>
        <div ref={railRef} style={styles.rail} data-chart-action="true">
          <ChartPositionRail
            viewport={viewport}
            durationSeconds={durationSeconds}
            onViewportChange={onViewportChange}
            onInteractionChange={onInteractionChange}
            onJumpToOffset={onJumpToOffset}
            disabled={disabled}
            coverageStartSeconds={coverageStartSeconds}
            ariaLabel="Chart zoom and position"
            hideRangeLabel
            selectedOffsetSeconds={selectedOffsetSeconds}
          />
        </div>
        {isZoomed ? (
          <div
            className="pulse-chart-zoom-controls"
            style={styles.zoomControls}
            data-chart-zoom-expanded={isZoomed ? 'true' : 'false'}
            aria-label="Chart zoom controls"
            title={`${zoomLabel} zoom`}
          >
            <button
              type="button"
              className="pulse-chart-zoom-button"
              data-chart-zoom-out="true"
              data-chart-action="true"
              style={styles.zoomButton}
              disabled={disabled || zoomOutDisabled}
              aria-label="Zoom out chart"
              onClick={onZoomOut}
            >
              −
            </button>
            <button
              type="button"
              className="pulse-chart-zoom-button pulse-chart-zoom-reset"
              data-chart-zoom-reset="true"
              data-chart-action="true"
              style={styles.resetButton}
              disabled={disabled || resetDisabled}
              aria-label="Reset chart view"
              title="Reset chart view"
              onClick={() => { onReset(); railRef.current?.querySelector<HTMLElement>('[role="slider"]')?.focus() }}
            >
              <span aria-hidden="true">Reset</span>
            </button>
            <button
              type="button"
              className="pulse-chart-zoom-button"
              data-chart-zoom-in="true"
              data-chart-action="true"
              style={styles.zoomButton}
              disabled={disabled || zoomInDisabled}
              aria-label="Zoom in chart"
              onClick={onZoomIn}
            >
              +
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  toolbar: {
    alignItems: 'center',
    display: 'flex',
    gap: 5,
    minHeight: 30,
    minWidth: 0,
    width: '100%',
  },
  rangeControl: {
    display: 'inline-flex',
    flexShrink: 0,
  },
  auxiliaryControls: {
    alignItems: 'center',
    display: 'inline-flex',
    flex: '0 0 auto',
    gap: 4,
    minWidth: 0,
    overflow: 'visible',
    whiteSpace: 'nowrap',
  },
  expandControl: {
    display: 'inline-flex',
    flex: '0 0 auto',
    marginLeft: 'auto',
  },
  viewportControls: {
    display: 'grid',
    gap: 3,
    minWidth: 0,
    width: '100%',
  },
  viewportMeta: {
    display: 'grid',
    gap: 2,
    minHeight: 14,
    minWidth: 0,
  },
  rangeRow: {
    alignItems: 'center',
    display: 'flex',
    gap: 6,
    minWidth: 0,
  },
  rangeLabel: {
    color: theme.textSecondary,
    fontSize: 10,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 700,
    lineHeight: '14px',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  returnToSelection: {
    background: 'rgba(251, 191, 36, 0.1)',
    border: '1px solid rgba(251, 191, 36, 0.3)',
    borderRadius: 5,
    color: '#fde68a',
    cursor: 'pointer',
    flex: '0 0 auto',
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.025em',
    lineHeight: 1,
    padding: '3px 5px',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  coverageHint: {
    color: theme.textMuted,
    display: 'block',
    fontSize: 9,
    fontWeight: 600,
    lineHeight: '12px',
    minHeight: 12,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  viewportRow: {
    alignItems: 'stretch',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 0,
  },
  rail: {
    flex: '1 1 auto',
    minWidth: 0,
    width: '100%',
  },
  zoomControls: {
    alignItems: 'center',
    display: 'inline-flex',
    flex: '0 0 auto',
    gap: 4,
    justifyContent: 'flex-end',
  },
  zoomButton: {
    alignItems: 'center',
    background: 'rgba(139, 92, 246, 0.12)',
    border: '1px solid rgba(167, 139, 250, 0.32)',
    borderRadius: 6,
    color: '#ddd6fe',
    cursor: 'pointer',
    display: 'inline-flex',
    fontSize: 14,
    fontWeight: 900,
    height: 24,
    justifyContent: 'center',
    lineHeight: 1,
    padding: 0,
    width: 24,
  },
  resetButton: {
    background: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 6,
    color: theme.textMuted,
    cursor: 'pointer',
    fontSize: 9,
    fontWeight: 800,
    height: 24,
    width: 44,
    minWidth: 44,
    padding: '0 7px',
    whiteSpace: 'nowrap',
  },
}
