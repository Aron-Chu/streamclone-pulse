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

function legendChipClassName(focused: boolean, dimmed: boolean): string {
  const parts = ['pulse-chart-legend-chip pulse-ch-chip']
  if (focused) parts.push('pulse-chart-legend-chip-focused pulse-ch-chip-focused')
  if (dimmed) parts.push('pulse-chart-legend-chip-dimmed pulse-ch-chip-dimmed')
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
        <span key={`${seriesKey}-${label}`} className="pulse-ch-static">
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
    <div className="pulse-ch">
      <div className="pulse-ch-top">
        <div className="pulse-ch-title-row">
          <span className="pulse-ch-title">Stream activity</span>
        </div>
        {leadingControl || expandControl || rightControl ? (
          <div className="pulse-ch-controls">
            {leadingControl ? <div className="pulse-ch-slot">{leadingControl}</div> : null}
            {expandControl ? <div className="pulse-ch-slot">{expandControl}</div> : null}
            {rightControl}
          </div>
        ) : null}
      </div>
      <div className="pulse-ch-legend" aria-label="Chart series legend">
        {showViewerLegend
          ? renderLegendItem(
              'viewers',
              'Viewers',
              <span className="pulse-ch-stroke" style={{ borderColor: CHART_THEME.viewer.color }} />,
            )
          : null}
        {renderLegendItem(
          'chat',
          'Chat',
          <span className="pulse-ch-dot" style={{ background: CHART_LANE.chatBar }} />,
        )}
        {renderLegendItem(
          'emotes',
          'Emotes',
          <span className="pulse-ch-dot" style={{ background: CHART_LANE.emoteBar }} />,
        )}
      </div>
      {overlayLegend ? <div className="pulse-ch-overlay-legend">{overlayLegend}</div> : null}
    </div>
  )
}
