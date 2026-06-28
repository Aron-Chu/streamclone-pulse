import type { ReactNode } from 'react'
import { cn } from './cn'
import { Sparkline } from './Sparkline'

export interface StatCardProps {
  label: ReactNode
  value: ReactNode
  icon?: ReactNode
  sub?: ReactNode
  accent?: 1 | 2 | 3 | 4 | 5
  delta?: { value: string; direction: 'up' | 'down' | 'flat' }
  sparkline?: number[]
  className?: string
}

export function StatCard({
  label,
  value,
  icon,
  sub,
  accent,
  delta,
  sparkline,
  className,
}: StatCardProps) {
  return (
    <div className={cn('sc-stat', accent && `sc-stat--accent-${accent}`, className)}>
      <div className="sc-stat__top">
        <span className="sc-stat__label">{label}</span>
        {icon ? (
          <span className="sc-stat__icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </div>
      <div className="sc-stat__value">{value}</div>
      {sparkline && sparkline.length > 1 ? (
        <Sparkline data={sparkline} tone={accent ?? 2} height={28} />
      ) : null}
      {sub || delta ? (
        <div className="sc-stat__sub">
          {delta ? (
            <span
              className={cn(
                'sc-stat__delta',
                delta.direction === 'up' && 'sc-stat__delta--up',
                delta.direction === 'down' && 'sc-stat__delta--down',
              )}
            >
              {delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '■'} {delta.value}
            </span>
          ) : null}
          {sub}
        </div>
      ) : null}
    </div>
  )
}
