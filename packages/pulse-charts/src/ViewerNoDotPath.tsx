export type ViewerNoDotPathProps = {
  lineD: string
  areaD: string
  gradientId: string
  color?: string
  lineOpacity?: number
  areaOpacity?: number
  strokeWidth?: number
  motionEnabled?: boolean
}

/**
 * Lightweight viewer-series renderer for surfaces that never draw sample
 * circles. Geometry owns gaps and lone-sample bucket strokes; this component
 * only paints the subtle area and continuous cyan path.
 */
export function ViewerNoDotPath({
  lineD,
  areaD,
  gradientId,
  color = '#22d3ee',
  lineOpacity = 0.88,
  areaOpacity = 0.11,
  strokeWidth = 2,
  motionEnabled = false,
}: ViewerNoDotPathProps) {
  const motionClass = motionEnabled ? ' sc-viewer-layer-motion' : ''
  return (
    <>
      <path
        data-viewer-layer="area"
        className={`sc-viewer-area${motionClass}`}
        d={areaD}
        fill={`url(#${gradientId})`}
        opacity={areaOpacity}
        pointerEvents="none"
      />
      <path
        data-viewer-layer="idle"
        data-chart-series="viewers"
        className={`sc-viewer-idle-line${motionClass}`}
        d={lineD}
        fill="none"
        stroke={color}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        opacity={lineOpacity}
        pointerEvents="none"
      />
    </>
  )
}
