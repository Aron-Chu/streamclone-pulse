import { cn } from './cn'

export type ProgressTone = 'default' | 'success' | 'warning' | 'info'

export interface ProgressBarProps {
  value?: number
  max?: number
  tone?: ProgressTone
  indeterminate?: boolean
  className?: string
  'aria-label'?: string
}

export function ProgressBar({
  value = 0,
  max = 100,
  tone = 'default',
  indeterminate = false,
  className,
  'aria-label': ariaLabel,
}: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div
      className={cn('sc-progress', indeterminate && 'sc-progress--indeterminate', className)}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : max}
      aria-valuenow={indeterminate ? undefined : Math.round(value)}
    >
      <div
        className={cn('sc-progress__fill', tone !== 'default' && `sc-progress__fill--${tone}`)}
        style={indeterminate ? undefined : { width: `${pct}%` }}
      />
    </div>
  )
}
