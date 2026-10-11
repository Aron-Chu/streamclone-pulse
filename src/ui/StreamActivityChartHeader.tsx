import type { ReactNode } from 'react'
import { CHART_LANE, CHART_THEME } from './chartTheme.ts'

export interface StreamActivityChartHeaderProps {
  rightControl?: ReactNode
  leadingControl?: ReactNode
  expandControl?: ReactNode
  overlayLegend?: ReactNode
  focusedSeriesKey?: string | null
  onToggleSeriesFocus?: (seriesKey: string) => void
  showViewerLegend?: boolean
}

// Static layout lives in shadow.css (.pulse-chart-header*, .pulse-chart-legend-*).
function legendChipClassName(focused: boolean, dimmed: boolean): string {
  const parts = ['pulse-chart-legend-chip']
  if (focused) parts.push('pulse-chart-legend-chip-focused')
  if (dimmed) parts.push('pulse-chart-legend-chip-dimmed')
  return parts.join(' ')
}

export function StreamActivityChartHeader({
  rightControl,
  leadingControl,
  expandControl,
  overlayLegend,
  focusedSeriesKey = null,
  onToggleSeriesFocus,
  showViewerLegend = false,
}: StreamActivityChartHeaderProps) {
  const interactive = Boolean(onToggleSeriesFocus)

  function renderLegendItem(
    seriesKey: string,
    label: string,
    swatch: ReactNode,
  ) {
    const isFocused = focusedSeriesKey === seriesKey
    const isDimmed = focusedSeriesKey != null && !isFocused

    if (!interactive) {
      return (
        <span key={`${seriesKey}-${label}`} className="pulse-chart-legend-static">
          {swatch}
          {label}
        </span>
      )
    }

    return (
      <button
        key={`${seriesKey}-${label}`}
        type="button"
        className={legendChipClassName(isFocused, isDimmed)}
        data-chart-action="true"
        aria-pressed={isFocused}
        title={isFocused ? 'Click to show all series' : `Highlight ${label}`}
        onClick={() => onToggleSeriesFocus?.(seriesKey)}
      >
        {swatch}
        {label}
      </button>
    )
  }

  return (
    <div className="pulse-chart-header">
      <div className="pulse-chart-header-top">
        <div className="pulse-chart-header-title-row">
          <span className="pulse-chart-header-title">Stream activity</span>
        </div>
        {leadingControl || expandControl || rightControl ? (
          <div className="pulse-chart-header-controls">
            {leadingControl ? <div className="pulse-chart-header-slot">{leadingControl}</div> : null}
            {expandControl ? <div className="pulse-chart-header-slot">{expandControl}</div> : null}
            {rightControl}
          </div>
        ) : null}
      </div>
      <div className="pulse-chart-legend-row" aria-label="Chart series legend">
        {showViewerLegend
          ? renderLegendItem(
              'viewers',
              'Viewers',
              <span className="pulse-chart-legend-stroke" style={{ borderColor: CHART_THEME.viewer.color }} />,
            )
          : null}
        {renderLegendItem(
          'chat',
          'Chat',
          <span className="pulse-chart-legend-dot" style={{ background: CHART_LANE.chatBar }} />,
        )}
        {renderLegendItem(
          'emotes',
          'Emotes',
          <span className="pulse-chart-legend-dot" style={{ background: CHART_LANE.emoteBar }} />,
        )}
      </div>
      {overlayLegend ? <div className="pulse-chart-legend-overlays">{overlayLegend}</div> : null}
    </div>
  )
}
