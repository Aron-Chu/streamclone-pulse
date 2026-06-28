import type { ReactNode } from 'react'
import { cn } from './cn'

export interface EmptyStateProps {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
  /** Use role="alert" for error variants so screen readers announce it. */
  tone?: 'neutral' | 'error'
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  tone = 'neutral',
}: EmptyStateProps) {
  return (
    <div
      className={cn('sc-empty', className)}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {icon ? (
        <span className="sc-empty__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <p className="sc-empty__title">{title}</p>
      {description ? <p className="sc-empty__desc">{description}</p> : null}
      {action}
    </div>
  )
}
