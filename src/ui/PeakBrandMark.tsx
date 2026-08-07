import type { CSSProperties } from 'react'

/** Keep in sync with streampulse-web BrandMark / public/favicon.svg */
const PEAK_PATH =
  'M6 49 H14 L18.5 33 L23 46 L28.5 20 L32 5 L35.5 20 L41 46 L45.5 33 L50 49 H58'

export function PeakBrandMark({ size = 34, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0, borderRadius: Math.round(size * 0.28), ...style }}
    >
      <rect width="64" height="64" rx="14" fill="#050608" />
      <path
        d={PEAK_PATH}
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
