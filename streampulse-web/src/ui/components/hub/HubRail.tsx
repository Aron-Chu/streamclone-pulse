import { Link } from 'react-router-dom'
import { TrendingUp } from 'lucide-react'
import type { HubEmote, HubEmoteIntel, HubMover, HubProviderShare } from '../../../lib/publicHub'
import { EmoteProviderIcon } from '../analytics/EmoteProviderIcon'
import { HubTopEmotesTable } from '../analytics/HubTopEmotesTable'
import {
  compact,
  formatLeadingEmoteShare,
  formatMoverVelocity,
  formatTopMoversHonestyNote,
  type TopMoversHonestyContext,
} from '../analytics/hubFormat'
import { Avatar, EmptyState, Skeleton } from './primitives'

/* --------------------------------------------------------- Top movers */
export function TopMoversList({
  movers,
  loading,
  honesty,
  maxRows,
}: {
  movers: HubMover[]
  loading?: boolean
  honesty?: TopMoversHonestyContext
  /** When set, only the top N movers are shown (matches backend hub cap). */
  maxRows?: number
}) {
  const visibleMovers = maxRows != null && maxRows > 0 ? movers.slice(0, maxRows) : movers
  const honestyNote = formatTopMoversHonestyNote(honesty, visibleMovers.length)
  const skeletonRows = maxRows != null && maxRows > 0 ? maxRows : 8

  if (loading && movers.length === 0) {
    return (
      <>
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0' }}>
            <Skeleton width={28} height={28} radius="0.5rem" />
            <Skeleton width="45%" height="0.85rem" />
            <Skeleton width="2.5rem" height="0.85rem" style={{ marginLeft: 'auto' }} />
          </div>
        ))}
      </>
    )
  }
  if (visibleMovers.length === 0) {
    return (
      <>
        <EmptyState icon={<TrendingUp aria-hidden="true" />}>
          No emote movers in the current window.
          {honestyNote ? ` ${honestyNote}` : ''}
        </EmptyState>
      </>
    )
  }
  return (
    <>
      {visibleMovers.map((mover, index) => {
        const velocity = formatMoverVelocity(mover)
        return (
          <Link key={mover.login} to={`/analytics/${encodeURIComponent(mover.login)}`} className="hx-mover">
            <span className="rk">{index + 1}</span>
            <Avatar login={mover.login} src={mover.profileImageUrl} alt={mover.displayName?.trim() || mover.login} />
            <strong>{mover.displayName?.trim() || mover.login}</strong>
            <span className="hx-mover__metrics tnum" title={`${velocity.emoteLabel} emotes · ${velocity.chatLabel}`}>
              <span className="hx-mover__primary">{velocity.emoteLabel}</span>
              <span className="hx-mover__secondary">{velocity.chatLabel}</span>
            </span>
          </Link>
        )
      })}
      {honestyNote ? <p className="hx-mover__honesty muted">{honestyNote}</p> : null}
    </>
  )
}

/* ----------------------------------------------------- Emote economy */
const PROVIDER_COLORS = [
  'hsl(var(--chart-2))',
  'hsl(var(--chart-1))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
]

function providerRing(shares: HubProviderShare[]): string {
  if (shares.length === 0) return 'conic-gradient(hsl(var(--secondary)) 0 100%)'
  let cursor = 0
  const segments = shares.slice(0, PROVIDER_COLORS.length).map((share, index) => {
    const start = cursor
    cursor = Math.min(100, cursor + Math.max(0, share.sharePct))
    return `${PROVIDER_COLORS[index]} ${start}% ${cursor}%`
  })
  if (cursor < 100) segments.push(`hsl(var(--secondary)) ${cursor}% 100%`)
  return `conic-gradient(${segments.join(', ')})`
}

export function EmoteEconomyPanel({
  intel,
  topEmotes,
  loading,
}: {
  intel: HubEmoteIntel
  topEmotes: HubEmote[]
  loading?: boolean
}) {
  const backendProviderShares = intel.providerShares ?? []
  const providerShares = backendProviderShares
  const hasProviderRollups = providerShares.length > 0
  const leadingProvider = hasProviderRollups ? providerShares[0] : undefined
  const ring = providerRing(providerShares)
  const leadingShare = formatLeadingEmoteShare(topEmotes, intel.topEmoteSharePct)
  if (loading && topEmotes.length === 0) {
    return (
      <div style={{ display: 'flex', gap: '1.1rem', alignItems: 'center' }}>
        <Skeleton width="5.5rem" height="5.5rem" radius="9999px" />
        <div style={{ flex: 1 }}>
          <Skeleton width="70%" height="0.8rem" />
          <Skeleton width="55%" height="0.8rem" style={{ marginTop: '0.5rem' }} />
          <Skeleton width="60%" height="0.8rem" style={{ marginTop: '0.5rem' }} />
        </div>
      </div>
    )
  }
  return (
    <>
      <div className="hx-donut">
        <div
          className="ring"
          style={{ background: ring }}
          role="img"
          aria-label={
            hasProviderRollups && leadingProvider
              ? `${leadingProvider.provider} accounts for ${Math.round(leadingProvider.sharePct)}% of tracked emote traffic`
              : 'Provider breakdown unavailable — hourly rollup data not loaded for this window'
          }
        >
          <span className="lbl">
            <b className="tnum">{Math.round(leadingProvider?.sharePct ?? 0)}%</b>
            <small>{hasProviderRollups ? (leadingProvider?.provider ?? 'No data') : 'Unavailable'}</small>
          </span>
        </div>
        <div className="leg">
          {(hasProviderRollups
            ? providerShares
            : [{ provider: 'Provider breakdown unavailable', count: 0, sharePct: 0 }]
          )
            .slice(0, 5)
            .map((share) => (
            <span key={share.provider} className="hx-donut__legend-item">
              {hasProviderRollups ? <EmoteProviderIcon provider={share.provider} size={14} /> : null}
              <span className="hx-donut__legend-provider">{share.provider}</span>
              {hasProviderRollups ? (
                <span className="hx-donut__legend-pct tnum">{Math.round(share.sharePct)}%</span>
              ) : null}
            </span>
          ))}
          <span className="muted" style={{ fontSize: '0.72rem' }}>
            {hasProviderRollups
              ? `${compact(intel.uniqueEmotes)} unique emotes seen`
              : 'Aggregate emote counts only — provider hourly rollups not available for this window'}
          </span>
        </div>
      </div>
      <div className="hx-econ-split">
        <div className="hx-econ-split__table">
          <div className="hx-card__desc" style={{ marginBottom: '0.35rem' }}>
            Top aggregate emotes
          </div>
          <HubTopEmotesTable emotes={topEmotes} loading={loading} maxRows={10} layout="leaderboard" />
        </div>
        <div>
          <div className="hx-card__desc" style={{ marginBottom: '0.35rem' }}>
            Velocity
            <span className="muted" style={{ display: 'block', fontWeight: 400, marginTop: '0.15rem' }}>
              Live emote rate across tracked rooms in the recent window
            </span>
          </div>
          <EconStat
            label="Emotes / min"
            value={compact(intel.emotesPerMin)}
            hint="Average emotes posted per minute network-wide"
          />
          <EconStat
            label="Biggest peak"
            value={`${compact(intel.biggestPeakPerMin)}/m`}
            hint="Highest single-minute emote rate detected"
          />
          <EconStat
            label={leadingShare.label}
            value={leadingShare.value}
            hint={leadingShare.sub}
            title={leadingShare.title}
          />
        </div>
      </div>
    </>
  )
}

function EconStat({ label, value, hint, title }: { label: string; value: string; hint?: string; title?: string }) {
  return (
    <div className="hx-econstat" title={title ?? hint}>
      <span className="lbl">{label}</span>
      {hint ? <span className="hx-econstat__hint">{hint}</span> : null}
      <strong className="val">{value}</strong>
    </div>
  )
}
