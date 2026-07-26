import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

export type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'live'
  | 'success'
  | 'warning'
  | 'info'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  dot?: boolean
  pulse?: boolean
  children: ReactNode
}

export function Badge({
  variant = 'secondary',
  dot = false,
  pulse = false,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span className={cn('sc-badge', `sc-badge--${variant}`, className)} {...rest}>
      {dot ? (
        <span className={cn('sc-badge__dot', pulse && 'sc-badge__dot--pulse')} aria-hidden="true" />
      ) : null}
      {children}
    </span>
  )
}
