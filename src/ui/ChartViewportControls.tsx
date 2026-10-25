import { useRef, type ReactNode } from 'react'
import { viewportContainsOffset, viewportDurationSeconds, type ChartViewport } from './chartViewport.ts'
import { ChartPositionRail, shouldShowChartRail } from './ChartPositionRail.tsx'
import { PulseThemedSelect, type PulseSelectOption } from './PulseThemedSelect.tsx'

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
      className="pulse-vp-toolbar"
      data-chart-toolbar="true"
      data-chart-range-controls="true"
    >
      <div className="pulse-vp-range" data-chart-action="true">
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
          className="pulse-vp-aux"
          data-chart-range-actions="true"
          data-chart-action="true"
        >
          {auxiliaryControls}
        </div>
      ) : null}
      {expandControl ? (
        <div className="pulse-vp-expand" data-chart-action="true">
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
      className="pulse-vp-return"
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
      className="pulse-vp"
      data-chart-viewport-controls="true"
      data-chart-selection-state={selectedOffsetSeconds == null ? 'none' : selectedOutsideViewport ? 'off-screen' : 'in-view'}
    >
      <div className="pulse-vp-meta">
        <div className="pulse-vp-range-row">
          <span className="pulse-vp-range-label" data-chart-visible-range="true" aria-live="polite">
            {rangeLabel}
          </span>
          <ChartReturnToSelection
            visible={selectedOutsideViewport}
            onReturn={onReturnToSelected}
          />
        </div>
        {coverageHint ? (
          <span
            className="pulse-vp-hint"
            data-chart-coverage-hint="true"
            title={typeof coverageHint === 'string' ? coverageHint : undefined}
          >
            {coverageHint}
          </span>
        ) : null}
      </div>
      <div className="pulse-vp-row">
        <div ref={railRef} className="pulse-vp-rail" data-chart-action="true">
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
            className="pulse-chart-zoom-controls pulse-vp-zoom-controls"
            data-chart-zoom-expanded={isZoomed ? 'true' : 'false'}
            aria-label="Chart zoom controls"
            title={`${zoomLabel} zoom`}
          >
            <button
              type="button"
              className="pulse-chart-zoom-button pulse-vp-zoom"
              data-chart-zoom-out="true"
              data-chart-action="true"
              disabled={disabled || zoomOutDisabled}
              aria-label="Zoom out chart"
              onClick={onZoomOut}
            >
              −
            </button>
            <button
              type="button"
              className="pulse-chart-zoom-button pulse-chart-zoom-reset pulse-vp-reset"
              data-chart-zoom-reset="true"
              data-chart-action="true"
              disabled={disabled || resetDisabled}
              aria-label="Reset chart view"
              title="Reset chart view"
              onClick={() => { onReset(); railRef.current?.querySelector<HTMLElement>('[role="slider"]')?.focus() }}
            >
              <span aria-hidden="true">Reset</span>
            </button>
            <button
              type="button"
              className="pulse-chart-zoom-button pulse-vp-zoom"
              data-chart-zoom-in="true"
              data-chart-action="true"
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
