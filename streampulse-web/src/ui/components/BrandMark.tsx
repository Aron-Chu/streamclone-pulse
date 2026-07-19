import type { CSSProperties } from 'react'

/** Canonical StreamPulse Peak mark. Keep this path aligned with the public SVG assets. */
export const PEAK_MARK_PATH = 'M8 50h48L40.5 22.5 32.5 36 24 18z'

export interface BrandMarkProps {
  className?: string
  /** Square pixel size. */
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
      data-brand-mark="peak"
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      <rect width="64" height="64" rx="14" fill="#050608" />
      <path fill="#2dd4bf" d={PEAK_MARK_PATH} />
      <circle cx="46" cy="16" r="3.5" fill="#5eead4" opacity="0.9" />
    </svg>
  )
}
