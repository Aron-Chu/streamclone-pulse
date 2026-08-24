import type { CSSProperties, ReactNode } from 'react'
import { CHART_LANE, CHART_THEME } from './chartTheme.ts'
import { theme } from './theme.ts'

export interface StreamActivityChartHeaderProps {
  rightControl?: ReactNode
  expandControl?: ReactNode
  overlayLegend?: ReactNode
  focusedSeriesKey?: string | null
  onToggleSeriesFocus?: (seriesKey: string) => void
  showViewerLegend?: boolean
}

function legendChipClassName(focused: boolean, dimmed: boolean): string {
  const parts = ['pulse-chart-legend-chip']
  if (focused) parts.push('pulse-chart-legend-chip-focused')
  if (dimmed) parts.push('pulse-chart-legend-chip-dimmed')
  return parts.join(' ')
}

function legendChipStyle(focused: boolean, dimmed: boolean): CSSProperties {
  return {
    ...styles.chartLegendItem,
    ...(focused
      ? styles.chartLegendItemFocused
      : dimmed
        ? styles.chartLegendItemDimmed
        : styles.chartLegendItemDefault),
  }
}

export function StreamActivityChartHeader({
  rightControl,
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
    const chipStyle = legendChipStyle(isFocused, isDimmed)

    if (!interactive) {
      return (
        <span key={`${seriesKey}-${label}`} style={styles.chartLegendItemStatic}>
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
        style={chipStyle}
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
    <div style={styles.header}>
      <div style={styles.headerTop}>
        <div style={styles.titleRow}>
          <span style={styles.title}>Stream activity</span>
        </div>
        {expandControl || rightControl ? (
          <div style={styles.controls}>
            {expandControl ? <div style={styles.expandSlot}>{expandControl}</div> : null}
            {rightControl}
          </div>
        ) : null}
      </div>
      <div style={styles.chartLegend} aria-label="Chart series legend">
        {showViewerLegend
          ? renderLegendItem(
              'viewers',
              'Viewers',
              <span
                style={{
                  ...styles.chartLegendStroke,
                  borderColor: CHART_THEME.viewer.color,
                }}
              />,
            )
          : null}
        {renderLegendItem(
          'chat',
          'Chat',
          <span style={{ ...styles.chartLegendDot, background: CHART_LANE.chatBar }} />,
        )}
        {renderLegendItem(
          'emotes',
          'Emotes',
          <span style={{ ...styles.chartLegendDot, background: CHART_LANE.emoteBar }} />,
        )}
      </div>
      {overlayLegend ? <div style={styles.overlayLegendRow}>{overlayLegend}</div> : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  header: { display: 'grid', gap: 6, minWidth: 0, overflow: 'visible' },
  headerTop: {
    alignItems: 'flex-start',
    display: 'flex',
    gap: 8,
    justifyContent: 'space-between',
    minHeight: 16,
    minWidth: 0,
  },
  titleRow: {
    alignItems: 'center',
    display: 'flex',
    flex: '1 1 auto',
    gap: 8,
    minWidth: 0,
    overflow: 'hidden',
  },
  title: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.04em',
    lineHeight: '12px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  expandSlot: {
    alignItems: 'center',
    display: 'inline-flex',
    flexShrink: 0,
  },
  controls: {
    alignItems: 'center',
    display: 'inline-flex',
    flexShrink: 0,
    gap: 6,
  },
  chartLegend: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    minHeight: 14,
    minWidth: 0,
  },
  chartLegendItem: {
    alignItems: 'center',
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: 4,
    color: theme.textMuted,
    cursor: 'pointer',
    display: 'inline-flex',
    fontFamily: 'inherit',
    fontSize: 9,
    fontWeight: 700,
    gap: 4,
    padding: '2px 6px',
  },
  chartLegendItemStatic: {
    alignItems: 'center',
    color: theme.textMuted,
    display: 'inline-flex',
    fontSize: 9,
    fontWeight: 700,
    gap: 4,
    padding: '2px 6px',
  },
  chartLegendItemDefault: {},
  chartLegendItemFocused: {
    background: 'rgba(255,255,255,0.1)',
    borderColor: 'rgba(255,255,255,0.28)',
    color: theme.textPrimary,
  },
  chartLegendItemDimmed: {
    opacity: 0.4,
  },
  chartLegendDot: {
    borderRadius: 999,
    flexShrink: 0,
    height: 6,
    width: 6,
  },
  chartLegendStroke: {
    background: 'transparent',
    border: `1.5px solid ${CHART_LANE.chatTrend}`,
    borderRadius: 1,
    flexShrink: 0,
    height: 0,
    width: 10,
  },
  overlayLegendRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    minWidth: 0,
  },
}
