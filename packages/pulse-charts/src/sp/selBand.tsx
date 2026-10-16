/**
 * The selected band (F23; prod ChartMotionChrome's pin band): the selection
 * snapped to whole bars at the current level, drawn in data units inside the
 * scaled group, so pan and zoom move it with the bars. A new selection slides
 * there with prod's useSmoothedScalar on x and width
 * (CHART_MOTION.selectionSettleMs, frame dt 1-64 ms, snap within 0.25 px).
 * The first selection and a level change place it at once (the caller keys it
 * by level); reduced motion always jumps.
 */
import { CHART_MOTION } from '../chartTheme.ts'
import { useSmoothedScalar } from '../useSmoothedScalar.ts'

export interface SpSelBandProps {
  /** Snapped span in samples [a, b). */
  a: number
  b: number
  y0: number
  y1: number
  /** Px per sample at the settled view (for the 0.25 px snap and the 0.5 px inset). */
  sx: number
  settleMs?: number
  reduced: boolean
}

export function SpSelBand({ a, b, y0, y1, sx, settleMs, reduced }: SpSelBandProps) {
  const opts = { settleMs: settleMs ?? CHART_MOTION.selectionSettleMs, snapEpsilon: 0.25 / Math.max(1e-6, sx) }
  const x = useSmoothedScalar(a, !reduced, opts)
  const w = useSmoothedScalar(b - a, !reduced, opts)
  const inset = 0.5 / sx
  return (
    <rect
      className="spc-selband"
      data-chart-selband=""
      data-sliding={x !== a || w !== b - a ? '' : undefined}
      x={Math.round((x + inset) * 1e4) / 1e4}
      y={Math.round((y0 + 0.5) * 10) / 10}
      width={Math.round(Math.max(1 / sx, w - 2 * inset) * 1e4) / 1e4}
      height={Math.round(Math.max(1, y1 - y0 - 1) * 10) / 10}
      vectorEffect="non-scaling-stroke"
    />
  )
}

/** prefers-reduced-motion, read when the band renders. */
export const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
