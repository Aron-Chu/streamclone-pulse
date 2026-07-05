import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'

type SurfaceTier = 1 | 2 | 3

const tierClass: Record<SurfaceTier, string> = {
  1: 'analytics-surface--1',
  2: 'analytics-surface--2',
  3: 'analytics-surface--3',
}

export interface AnalyticsSurfaceProps<T extends ElementType = 'div'> {
  as?: T
  tier?: SurfaceTier
  className?: string
  children?: ReactNode
}

export function AnalyticsSurface<T extends ElementType = 'div'>({
  as,
  tier = 1,
  className = '',
  children,
  ...rest
}: AnalyticsSurfaceProps<T> & Omit<ComponentPropsWithoutRef<T>, keyof AnalyticsSurfaceProps<T>>) {
  const Tag = as ?? 'div'
  return (
    <Tag
      className={`analytics-surface ${tierClass[tier]}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </Tag>
  )
}
