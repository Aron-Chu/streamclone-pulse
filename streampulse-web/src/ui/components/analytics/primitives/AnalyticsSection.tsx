import type { ReactNode } from 'react'
import { AnalyticsSurface } from './AnalyticsSurface'

export interface AnalyticsSectionProps {
  id?: string
  title: string
  meta?: ReactNode
  systemLabel?: string
  loading?: boolean
  empty?: boolean
  emptyMessage?: string
  className?: string
  children?: ReactNode
}

export function AnalyticsSection({
  id,
  title,
  meta,
  systemLabel,
  loading,
  empty,
  emptyMessage = 'No data available yet.',
  className = '',
  children,
}: AnalyticsSectionProps) {
  return (
    <AnalyticsSurface
      as="section"
      id={id}
      tier={1}
      className={`analytics-section figma-block${className ? ` ${className}` : ''}`}
      aria-busy={loading || undefined}
    >
      <header className="analytics-section__head figma-block__head">
        {systemLabel ? (
          <p className="figma-block__eyebrow">{systemLabel}</p>
        ) : null}
        <div className="analytics-section__title-row">
          <h2 className="figma-block__title">{title}</h2>
          {meta ? <span className="analytics-section__meta">{meta}</span> : null}
        </div>
      </header>
      {loading ? (
        <div className="analytics-section__skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : empty ? (
        <p className="analytics-section__empty" role="status">
          {emptyMessage}
        </p>
      ) : (
        children
      )}
    </AnalyticsSurface>
  )
}
