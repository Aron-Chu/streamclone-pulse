import { useState, type CSSProperties, type ReactNode } from 'react'
import { compact, deltaLabel } from '../analytics/hubFormat'

/** Chart accent token keys available in the .hubx scope. */
export type HubAccent = 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4' | 'chart-5'

function accentVar(accent: HubAccent): string {
  return `hsl(var(--${accent}))`
}

/* ----------------------------------------------------------------- Card */
export interface CardProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
  id?: string
  ariaLabelledby?: string
  as?: 'div' | 'section' | 'article'
}

export function Card({ children, className, style, id, ariaLabelledby, as = 'section' }: CardProps) {
  const Tag = as
  return (
    <Tag className={`hx-card${className ? ` ${className}` : ''}`} style={style} id={id} aria-labelledby={ariaLabelledby}>
      {children}
    </Tag>
  )
}

export interface CardHeaderProps {
  title: ReactNode
  titleId?: string
  desc?: ReactNode
  action?: ReactNode
  row?: boolean
}

export function CardHeader({ title, titleId, desc, action, row }: CardHeaderProps) {
  if (row || action) {
    return (
      <div className="hx-card__header hx-card__header--row">
        <div>
          <h3 className="hx-card__title" id={titleId}>
            {title}
          </h3>
          {desc ? <div className="hx-card__desc">{desc}</div> : null}
        </div>
        {action}
      </div>
    )
  }
  return (
    <div className="hx-card__header">
      <h3 className="hx-card__title" id={titleId}>
        {title}
      </h3>
      {desc ? <div className="hx-card__desc">{desc}</div> : null}
    </div>
  )
}

export interface CardContentProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
  flush?: boolean
  tight?: boolean
}

export function CardContent({ children, className, style, flush, tight }: CardContentProps) {
  const cls = ['hx-card__content', flush && 'hx-card__content--flush', tight && 'hx-card__content--tight', className]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls} style={style}>
      {children}
    </div>
  )
}

/* ---------------------------------------------------------------- Badge */
export type BadgeVariant = 'secondary' | 'outline' | 'live' | 'backfill' | 'tracked' | 'down'

export interface BadgeProps {
  children: ReactNode
  variant?: BadgeVariant
  dot?: boolean
  dotColor?: string
  pulse?: boolean
  className?: string
}

export function Badge({ children, variant = 'outline', dot, dotColor, pulse, className }: BadgeProps) {
  return (
    <span className={`hx-badge hx-badge--${variant}${className ? ` ${className}` : ''}`}>
      {dot ? (
        <span className={`dot${pulse ? ' hx-pulse' : ''}`} style={dotColor ? { background: dotColor } : undefined} aria-hidden="true" />
      ) : null}
      {children}
    </span>
  )
}

/* ----------------------------------------------------------- IconButton */
export interface IconButtonProps {
  children: ReactNode
  onClick?: () => void
  ariaLabel: string
  variant?: 'outline' | 'ghost' | 'secondary'
  busy?: boolean
  className?: string
}

export function IconButton({ children, onClick, ariaLabel, variant = 'outline', busy, className }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`hx-btn hx-btn--${variant} hx-btn--sm hx-btn--icon${className ? ` ${className}` : ''}`}
      onClick={onClick}
      aria-label={ariaLabel}
      data-busy={busy || undefined}
      style={busy ? { animation: 'hx-spin 0.9s linear infinite' } : undefined}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------- Sparkline */
export interface SparklineProps {
  points: number[]
  color?: string
  className?: string
  ariaLabel?: string
  width?: number
  height?: number
  fill?: boolean
}

export function Sparkline({ points, color = 'hsl(var(--chart-2))', className, ariaLabel, width = 100, height = 30, fill }: SparklineProps) {
  const series = points.length >= 2 ? points : [points[0] ?? 0, points[0] ?? 0]
  const max = Math.max(...series)
  const min = Math.min(...series)
  const span = max - min || 1
  const stepX = width / (series.length - 1)
  const coords = series.map((value, index) => {
    const x = +(index * stepX).toFixed(2)
    const y = +(height - ((value - min) / span) * (height - 3) - 1.5).toFixed(2)
    return `${x},${y}`
  })
  const line = coords.join(' ')
  const area = `${coords[0].split(',')[0]},${height} ${line} ${coords[coords.length - 1].split(',')[0]},${height}`
  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      {fill ? <polygon points={area} fill={color} opacity={0.12} /> : null}
      <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* -------------------------------------------------------------- Skeleton */
export interface SkeletonProps {
  width?: string | number
  height?: string | number
  radius?: string | number
  className?: string
  style?: CSSProperties
}

export function Skeleton({ width, height, radius, className, style }: SkeletonProps) {
  return (
    <span
      className={`hx-skel${className ? ` ${className}` : ''}`}
      style={{
        display: 'block',
        width: width ?? '100%',
        height: height ?? '1rem',
        borderRadius: radius,
        ...style,
      }}
      aria-hidden="true"
    />
  )
}

/* ------------------------------------------------------------ EmptyState */
export interface EmptyStateProps {
  icon?: ReactNode
  children: ReactNode
  action?: ReactNode
}

export function EmptyState({ icon, children, action }: EmptyStateProps) {
  return (
    <div className="hx-empty">
      {icon}
      <span>{children}</span>
      {action}
    </div>
  )
}

/* ----------------------------------------------------------------- Delta */
export function Delta({ pct }: { pct: number | null | undefined }) {
  const { text, tone } = deltaLabel(pct)
  if (tone === 'flat') return <span className="muted">{text}</span>
  return <span className={`delta ${tone === 'up' ? 'rise' : 'fall'}`}>{text}</span>
}

/* ---------------------------------------------------------------- Avatar */
export interface AvatarProps {
  login: string
  src?: string
  alt?: string
  className?: string
}

export function Avatar({ login, src, alt, className }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const initial = (login.trim()[0] || '?').toUpperCase()
  const showImg = src && !failed
  return (
    <span className={`hx-av${className ? ` ${className}` : ''}`} aria-hidden={alt ? undefined : true}>
      {showImg ? <img src={src} alt={alt ?? ''} loading="lazy" onError={() => setFailed(true)} /> : initial}
    </span>
  )
}

/* ------------------------------------------------------------ ProgressRow */
export interface ProgressRowProps {
  label: string
  meta?: string
  pct: number
  color: string
}

export function ProgressRow({ label, meta, pct, color }: ProgressRowProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)))
  return (
    <div>
      <div className="h">
        <span className="d" style={{ background: color }} aria-hidden="true" />
        <strong>{label}</strong>
        {meta ? <span className="st">{meta}</span> : null}
      </div>
      <div
        className="hx-progress"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${clamped}%`}
      >
        <i style={{ width: `${clamped}%`, background: color }} />
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- StatCard */
export interface StatCardProps {
  label: string
  value: ReactNode
  sub: string
  icon: ReactNode
  accent: HubAccent
  loading?: boolean
}

export function StatCard({ label, value, sub, icon, accent, loading }: StatCardProps) {
  return (
    <div className="hx-card hx-stat" style={{ ['--accentc' as string]: accentVar(accent) }}>
      <div className="hd">
        <span className="lab">{label}</span>
        <span className="ic" style={{ background: `hsl(var(--${accent}) / 0.15)`, color: accentVar(accent) }}>
          {icon}
        </span>
      </div>
      {loading ? (
        <div style={{ padding: '0.1rem 1.1rem 1.05rem' }}>
          <Skeleton width="55%" height="1.9rem" />
          <Skeleton width="70%" height="0.7rem" style={{ marginTop: '0.5rem' }} />
        </div>
      ) : (
        <>
          <div className="big tnum">{value}</div>
          <div className="sub">{sub}</div>
        </>
      )}
    </div>
  )
}

/* --------------------------------------------------------------- KpiCard */
export interface KpiCardProps {
  label: string
  value: ReactNode
  meta?: ReactNode
  spark: number[]
  accent: HubAccent
  icon: ReactNode
  loading?: boolean
}

export function KpiCard({ label, value, meta, spark, accent, icon, loading }: KpiCardProps) {
  return (
    <div className="hx-card hx-kpi">
      <div className="top">
        <span className="lab">{label}</span>
        <span className="ic" style={{ background: `hsl(var(--${accent}) / 0.15)`, color: accentVar(accent) }}>
          {icon}
        </span>
      </div>
      {loading ? (
        <div style={{ padding: '0.1rem 1rem 1rem' }}>
          <Skeleton width="50%" height="1.6rem" />
          <Skeleton width="65%" height="0.7rem" style={{ marginTop: '0.5rem' }} />
          <Skeleton height="1.6rem" style={{ marginTop: '0.6rem' }} />
        </div>
      ) : (
        <>
          <div className="big tnum">{value}</div>
          <div className="meta">{meta}</div>
          <span className="spark">
            <Sparkline points={spark} color={accentVar(accent)} />
          </span>
        </>
      )}
    </div>
  )
}

/** Shared number formatter re-export for convenience in hub components. */
export { compact }
