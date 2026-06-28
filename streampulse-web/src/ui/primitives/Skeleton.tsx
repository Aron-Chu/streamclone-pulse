import type { CSSProperties } from 'react'
import { cn } from './cn'

export interface SkeletonProps {
  width?: number | string
  height?: number | string
  radius?: number | string
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

export function Skeleton({
  width,
  height = '1rem',
  radius,
  className,
  style,
  'aria-label': ariaLabel,
}: SkeletonProps) {
  return (
    <span
      className={cn('sc-skeleton', className)}
      role={ariaLabel ? 'status' : 'presentation'}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      style={{
        width,
        height,
        borderRadius: radius,
        ...style,
      }}
    />
  )
}
