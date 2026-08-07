import type { CSSProperties } from 'react'

/**
 * Canonical StreamPulse peak-spike mark (hollow angular pulse peak).
 * Geometry matches chosen mark-peak-spike.png — keep in sync with
 * public/favicon.svg, public/brand-peak.svg, and src/ui/PeakBrandMark.tsx.
 */
export const PEAK_MARK_PATH =
  'M6 49 H14 L18.5 33 L23 46 L28.5 20 L32 5 L35.5 20 L41 46 L45.5 33 L50 49 H58'

export interface BrandMarkProps {
  className?: string
  /** Pixel size (width & height). Default 28. */
  size?: number
  style?: CSSProperties
  title?: string
}

export function BrandMark({ className, size = 28, style, title }: BrandMarkProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      <rect width="64" height="64" rx="14" fill="#050608" />
      <path
        d={PEAK_MARK_PATH}
        fill="none"
        stroke="#2dd4bf"
        strokeWidth={5}
        strokeLinejoin="miter"
        strokeMiterlimit={12}
        strokeLinecap="butt"
      />
    </svg>
  )
}
