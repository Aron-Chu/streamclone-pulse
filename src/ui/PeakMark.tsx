import { PEAK_STROKE } from './supporterFinish.ts'

/**
 * The StreamPulse Peak, optically adjusted for small sizes.
 *
 * brand-peak.svg draws 10 vertices across a 64-unit box. Scaled to 14–18px that
 * lands near 0.3px per unit and the shoulders collapse into the apex, so this
 * keeps the silhouette (rail, shoulder, dip, apex) on an 18-unit grid with
 * half-pixel vertices instead of scaling the original path down.
 *
 * The 24-month badge drops the apex by 1.5 units to clear the tenure arc drawn
 * above it.
 */
export const PEAK_PATH = 'M1 13.5 H3.5 L5.5 9 L7 11.5 L9 3 L11 11.5 L12.5 9 L14.5 13.5 H17'
export const PEAK_PATH_LOWERED = 'M1 13.5 H3.5 L5.5 9 L7 11.5 L9 4.5 L10.8 11.5 L12.5 9 L14.5 13.5 H17'

export function PeakMark({
  size = 14,
  stroke = PEAK_STROKE,
  strokeWidth = 1.6,
  lowered = false,
  className,
}: {
  size?: number
  stroke?: string
  strokeWidth?: number
  lowered?: boolean
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      className={className}
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none' }}
    >
      <path
        d={lowered ? PEAK_PATH_LOWERED : PEAK_PATH}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
