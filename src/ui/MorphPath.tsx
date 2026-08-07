import type { CSSProperties } from 'react'
import { chartInteractionOpacityTransition } from './chartCrosshair.ts'

export const AFTER_CURSOR_OPACITY = 0.22

export type MorphPathProps = {
  idleLineD: string
  detailLineD: string
  idleAreaD?: string
  stroke: string
  afterCursorStroke?: string
  strokeWidth: number
  idleOpacity: number
  areaFill?: string
  areaOpacity?: number
  inspecting: boolean
  beforeClipId: string
  afterClipId: string
  seriesKey: string
  reducedMotion?: boolean
  className?: string
}

function transitionStyle(reducedMotion: boolean): CSSProperties {
  return { transition: chartInteractionOpacityTransition(reducedMotion) }
}

function pathAttributes(
  layer: 'idle' | 'before-cursor' | 'after-cursor' | 'area',
  seriesKey: string,
  className: string | undefined,
) {
  return {
    className,
    'data-morph-layer': layer,
    'data-morph-role': layer === 'area' ? 'area' : 'line',
    'data-morph-series': seriesKey,
  }
}

 /**
  * Render all inspection layers from immutable path strings. Hovering only
 * changes opacity and feather masks owned by the parent SVG; it never
 * changes a path's `d` attribute and never schedules a frame to mutate it.
 */
export function MorphPath({
  idleLineD,
  detailLineD,
  idleAreaD,
  stroke,
  afterCursorStroke = stroke,
  strokeWidth,
  idleOpacity,
  areaFill,
  areaOpacity = 0,
  inspecting,
  beforeClipId,
  afterClipId,
  seriesKey,
  reducedMotion = false,
  className,
}: MorphPathProps) {
  const detailOpacity = inspecting ? 1 : 0
  const resolvedAreaFill = areaFill ?? stroke
  const transition = transitionStyle(reducedMotion)
  const idlePathD = idleLineD || detailLineD
  const detailPathD = detailLineD || idleLineD

  return (
    <>
      {idleAreaD ? (
        <path
          {...pathAttributes('area', seriesKey, className)}
          d={idleAreaD}
          fill={resolvedAreaFill}
          opacity={idleOpacity > 0 ? areaOpacity : 0}
          pointerEvents="none"
          style={transition}
        />
      ) : null}
      <path
        {...pathAttributes('idle', seriesKey, className)}
        d={idlePathD}
        fill="none"
        stroke={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        opacity={idleOpacity}
        pointerEvents="none"
        style={transition}
      />
      <path
        {...pathAttributes('before-cursor', seriesKey, className)}
        d={detailPathD}
        mask={`url(#${beforeClipId})`}
        fill="none"
        stroke={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        opacity={detailOpacity}
        pointerEvents="none"
        style={transition}
      />
      <path
        {...pathAttributes('after-cursor', seriesKey, className)}
        d={detailPathD}
        mask={`url(#${afterClipId})`}
        fill="none"
        stroke={afterCursorStroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        opacity={inspecting ? AFTER_CURSOR_OPACITY : 0}
        pointerEvents="none"
        style={transition}
      />
    </>
  )
}
