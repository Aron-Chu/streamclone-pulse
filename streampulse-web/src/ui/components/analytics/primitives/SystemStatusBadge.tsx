export type SystemStatusState = 'ready' | 'degraded' | 'offline'

export interface SystemStatusBadgeProps {
  state: SystemStatusState
  label: string
  className?: string
  title?: string
}

export function SystemStatusBadge({ state, label, className = '', title }: SystemStatusBadgeProps) {
  return (
    <span
      className={`system-status-badge system-status-badge--${state}${className ? ` ${className}` : ''}`}
      role="status"
      title={title}
    >
      <span className="system-status-badge__dot" aria-hidden="true" />
      {label}
    </span>
  )
}
