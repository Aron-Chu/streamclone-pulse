import { Link } from 'react-router-dom'
import { buildAnalyticsHref } from '../../../lib/analyticsLinks'
import { ResilientImage } from '../ResilientImage'

export type HubChannelCardTone = 'live' | 'neutral' | 'synced' | 'partial'

export interface HubChannelCard {
  login: string
  displayName: string
  avatarUrl?: string
  category?: string
  statusLabel?: string
  statusTone?: HubChannelCardTone
  primaryMetric?: string
  primaryLabel?: string
  secondaryMetric?: string
  secondaryLabel?: string
  coveragePercent?: number
}

export interface HubChannelRailProps {
  title: string
  description?: string
  channels: HubChannelCard[]
  loading?: boolean
  actionHref?: string
  actionLabel?: string
}

function statusClassName(tone: HubChannelCardTone | undefined): string {
  switch (tone) {
    case 'live':
      return 'analytics-hub-channel-card__status--live'
    case 'synced':
      return 'analytics-hub-channel-card__status--synced'
    case 'partial':
      return 'analytics-hub-channel-card__status--partial'
    default:
      return ''
  }
}

function channelInitial(login: string): string {
  const trimmed = login.trim()
  return (trimmed[0] ?? '?').toUpperCase()
}

function clampCoveragePercent(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(100, value))
}

function LoadingCard({ keyId }: { keyId: string }) {
  return (
    <div key={keyId} className="analytics-hub-channel-card analytics-hub-channel-card--loading" aria-hidden="true">
      <span className="analytics-hub-channel-card__avatar">{keyId[0]}</span>
      <div className="analytics-hub-channel-card__body">
        <span className="analytics-hub-channel-card__skeleton analytics-hub-channel-card__skeleton--wide" />
        <span className="analytics-hub-channel-card__skeleton" />
        <span className="analytics-hub-channel-card__skeleton" />
      </div>
    </div>
  )
}

function ChannelAvatar({ login, displayName, avatarUrl }: { login: string; displayName: string; avatarUrl?: string }) {
  return (
    <ResilientImage
      className="analytics-hub-channel-card__avatar"
      src={avatarUrl}
      alt=""
      loading="lazy"
      fallback={
        <span className="analytics-hub-channel-card__avatar" aria-hidden="true">
          {channelInitial(displayName || login)}
        </span>
      }
    />
  )
}

export function HubChannelRail({
  title,
  description,
  channels,
  loading = false,
  actionHref,
  actionLabel = 'View all',
}: HubChannelRailProps) {
  const headingId = 'hub-channel-rail-title'

  return (
    <section className="panel analytics-hub-rail" aria-labelledby={headingId}>
      <div className="analytics-hub-rail__header">
        <div>
          <h2 id={headingId} className="analytics-hub__panel-title">
            {title}
          </h2>
          {description ? <p className="analytics-hub-rail__description muted">{description}</p> : null}
        </div>
        {actionHref ? (
          <Link to={actionHref} className="btn btn-secondary btn-sm">
            {actionLabel}
          </Link>
        ) : null}
      </div>

      <div className="analytics-hub-rail__grid" aria-busy={loading}>
        {loading
          ? Array.from({ length: 4 }, (_, index) => <LoadingCard key={`loading-${index}`} keyId={`${index}`} />)
          : channels.map((channel) => {
              const href = buildAnalyticsHref({
                login: channel.login,
                context: 'channel-row',
              })
              const coverage = clampCoveragePercent(channel.coveragePercent)

              return (
                <Link
                  key={channel.login}
                  to={href}
                  className="analytics-hub-channel-card"
                  aria-label={`Open analytics for ${channel.displayName}`}
                >
                  <ChannelAvatar login={channel.login} displayName={channel.displayName} avatarUrl={channel.avatarUrl} />
                  <div className="analytics-hub-channel-card__body">
                    <div className="analytics-hub-channel-card__topline">
                      <strong>{channel.displayName}</strong>
                      {channel.statusLabel ? (
                        <span
                          className={`analytics-hub-channel-card__status ${statusClassName(channel.statusTone)}`.trim()}
                        >
                          {channel.statusLabel}
                        </span>
                      ) : null}
                    </div>
                    {channel.category ? (
                      <span className="analytics-hub-channel-card__category muted">{channel.category}</span>
                    ) : null}
                    {channel.primaryMetric || channel.secondaryMetric ? (
                      <div className="analytics-hub-channel-card__metrics">
                        {channel.primaryMetric ? (
                          <span>
                            <strong>{channel.primaryMetric}</strong>
                            {channel.primaryLabel ? <small>{channel.primaryLabel}</small> : null}
                          </span>
                        ) : null}
                        {channel.secondaryMetric ? (
                          <span>
                            <strong>{channel.secondaryMetric}</strong>
                            {channel.secondaryLabel ? <small>{channel.secondaryLabel}</small> : null}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {coverage != null ? (
                      <span
                        className="analytics-hub-channel-card__coverage"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(coverage)}
                        aria-label={`Coverage ${Math.round(coverage)} percent`}
                      >
                        <span style={{ width: `${coverage}%` }} />
                      </span>
                    ) : null}
                  </div>
                </Link>
              )
            })}
      </div>
    </section>
  )
}
