import type { CSSProperties, ReactNode } from 'react'
import { CHART_LANE } from './chartTheme.ts'
import { theme } from './theme.ts'

export interface StreamActivityChartHeaderProps {
  rightControl?: ReactNode
  toolbar?: ReactNode
  overlayLegend?: ReactNode
}

export function StreamActivityChartHeader({
  rightControl,
  toolbar,
  overlayLegend,
}: StreamActivityChartHeaderProps) {
  return (
    <div style={styles.header}>
      <div style={styles.headerTop}>
        <span style={styles.title}>Stream activity</span>
        {rightControl ? <div style={styles.controls}>{rightControl}</div> : null}
      </div>
      <div style={styles.chartLegend} aria-hidden="true">
        <span style={styles.chartLegendItem}>
          <span style={{ ...styles.chartLegendDot, background: CHART_LANE.chatBar }} />
          Chat
        </span>
        <span style={styles.chartLegendItem}>
          <span style={{ ...styles.chartLegendDot, background: CHART_LANE.emoteBar }} />
          Emotes
        </span>
        <span style={styles.chartLegendItem}>
          <span style={styles.chartLegendStroke} />
          Chat trend
        </span>
        <span style={styles.chartLegendItem}>
          <span style={{ ...styles.chartLegendStroke, borderColor: CHART_LANE.emoteBar }} />
          Emote trend
        </span>
      </div>
      {toolbar ? <div style={styles.toolbar}>{toolbar}</div> : null}
      {overlayLegend ? <div style={styles.overlayLegendRow}>{overlayLegend}</div> : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  header: { display: 'grid', gap: 6, minWidth: 0, overflow: 'visible' },
  headerTop: {
    alignItems: 'center',
    display: 'flex',
    gap: 8,
    justifyContent: 'space-between',
    minWidth: 0,
  },
  title: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  controls: {
    alignItems: 'center',
    display: 'inline-flex',
    flexShrink: 0,
    gap: 6,
  },
  chartLegend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    minWidth: 0,
  },
  chartLegendItem: {
    alignItems: 'center',
    color: theme.textMuted,
    display: 'inline-flex',
    fontSize: 9,
    fontWeight: 700,
    gap: 4,
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
  toolbar: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  overlayLegendRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    minWidth: 0,
  },
}
