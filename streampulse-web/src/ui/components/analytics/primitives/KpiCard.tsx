export type KpiTone = 'accent' | 'neutral' | 'viewers' | 'chat'

export interface KpiCardProps {
  label: string
  value: string
  sub?: string
  title?: string
  tone?: KpiTone
  loading?: boolean
  showLiveDot?: boolean
}

export function KpiCard({
  label,
  value,
  sub,
  title,
  tone = 'neutral',
  loading,
  showLiveDot,
}: KpiCardProps) {
  return (
    <div
      className={`hub-command-header__kpi hub-command-header__kpi--${tone}`}
      aria-busy={loading || undefined}
      title={title}
    >
      <span className="hub-command-header__kpi-label">
        {showLiveDot ? (
          <span className="hub-command-header__kpi-live" aria-hidden="true" />
        ) : null}
        {label}
      </span>
      <strong className="hub-command-header__kpi-value">{loading ? '…' : value}</strong>
      {sub ? <span className="hub-command-header__kpi-sub">{sub}</span> : null}
    </div>
  )
}
