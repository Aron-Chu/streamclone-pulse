import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  Inbox,
  MessageSquare,
  Radio,
  Smile,
  TrendingUp,
  Zap,
} from 'lucide-react'
import type {
  HubCoverage,
  HubEmote,
  HubEmoteIntel,
  HubLiveChannel,
  HubMoment,
  HubMomentKind,
  HubMover,
  HubCorpusPipeline,
  HubProviderShare,
} from '../../../lib/publicHub'
import { ircSlotMetrics } from '../../../lib/coverageHealthMetrics'
import type { RecentSessionRow } from '../../../hooks/useAnalyticsHubData'
import { compact, providerLabel } from '../analytics/hubFormat'
import { Avatar, EmptyState, ProgressRow, Skeleton } from './primitives'

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function relTime(at: number): string {
  if (!at) return ''
  const ms = at > 1e12 ? at : at > 1e9 ? at * 1000 : at
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (sec < 10) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function ageLabel(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return ''
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

/* --------------------------------------------------------- Top movers */
export function TopMoversList({ movers, loading }: { movers: HubMover[]; loading?: boolean }) {
  if (loading && movers.length === 0) {
    return (
      <>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0' }}>
            <Skeleton width={28} height={28} radius="0.5rem" />
            <Skeleton width="45%" height="0.85rem" />
            <Skeleton width="2.5rem" height="0.85rem" style={{ marginLeft: 'auto' }} />
          </div>
        ))}
      </>
    )
  }
  if (movers.length === 0) {
    return <EmptyState icon={<TrendingUp aria-hidden="true" />}>No emote movers in the current window.</EmptyState>
  }
  return (
    <>
      {movers.map((mover, index) => (
        <Link key={mover.login} to={`/analytics/${encodeURIComponent(mover.login)}`} className="hx-mover">
          <span className="rk">{index + 1}</span>
          <Avatar login={mover.login} src={mover.profileImageUrl} alt={mover.displayName?.trim() || mover.login} />
          <strong>{mover.displayName?.trim() || mover.login}</strong>
          <span className="v tnum">{compact(Math.max(mover.emotesPerMin ?? 0, mover.seventvPerMin))}/m</span>
        </Link>
      ))}
    </>
  )
}

/* ------------------------------------------------- Top streamers rail */
type RankedChannel = { channel: HubLiveChannel; rank: number }

function StreamChip({ channel, rank, ghost }: { channel: HubLiveChannel; rank: number; ghost?: boolean }) {
  const name = channel.displayName?.trim() || channel.login
  const category = channel.category?.trim()
  const velocity = Math.max(channel.chatPerMin || 0, 0)
  const hot = velocity >= 30 || Math.max(channel.emotesPerMin ?? 0, channel.seventvPerMin || 0) >= 8
  return (
    <Link
      to={`/analytics/${encodeURIComponent(channel.login)}`}
      className="hx-streamchip"
      role={ghost ? undefined : 'listitem'}
      aria-hidden={ghost ? true : undefined}
      tabIndex={ghost ? -1 : undefined}
    >
      <span className={`rk${rank <= 3 ? ' rk--top' : ''}`} aria-hidden="true">
        {rank}
      </span>
      <span className="av">
        <Avatar login={channel.login} src={channel.profileImageUrl} alt={name} />
        <span className="ring" aria-hidden="true" />
      </span>
      <span className="meta">
        <strong title={name}>{name}</strong>
        <span className="cat" title={category || 'Live now'}>
          {category || 'Live now'}
        </span>
        <span className="vw">
          <span className="dot" aria-hidden="true" />
          {compact(channel.viewers)}
          <span className="vw__lbl"> watching</span>
          {hot ? <span className="hot" title="High chat velocity">🔥</span> : null}
        </span>
      </span>
    </Link>
  )
}

export function TopStreamersRail({
  channels,
  loading,
}: {
  channels: HubLiveChannel[]
  loading?: boolean
}) {
  const top: RankedChannel[] = channels.slice(0, 20).map((channel, i) => ({ channel, rank: i + 1 }))
  if (loading && channels.length === 0) {
    return (
      <div className="hx-streamrail" aria-hidden="true">
        <div className="hx-streamtrack">
          {Array.from({ length: 6 }).map((_, i) => (
            <div className="hx-streamchip" key={i}>
              <Skeleton width={52} height={52} radius="9999px" />
              <span className="meta">
                <Skeleton width="6rem" height="0.85rem" />
                <Skeleton width="4.5rem" height="0.7rem" style={{ marginTop: '0.4rem' }} />
                <Skeleton width="5.5rem" height="0.7rem" style={{ marginTop: '0.4rem' }} />
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (top.length === 0) {
    return (
      <EmptyState icon={<Radio aria-hidden="true" />}>
        No channels are live right now — the rail fills as tracked streams go live.
      </EmptyState>
    )
  }

  return (
    <div className="hx-streamrail" role="list" aria-label="Top live streamers">
      <div className="hx-streamtrack">
        {top.map(({ channel, rank }) => (
          <StreamChip key={channel.login} channel={channel} rank={rank} />
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------- Global emotes */
export function GlobalEmotesList({ emotes, loading }: { emotes: HubEmote[]; loading?: boolean }) {
  const top = emotes.slice(0, 8)
  const max = top.reduce((acc, e) => Math.max(acc, e.count), 0) || 1
  if (loading && emotes.length === 0) {
    return (
      <>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', padding: '0.45rem 0' }}>
            <Skeleton width={27} height={27} radius="0.35rem" />
            <Skeleton width="3.6rem" height="0.8rem" />
            <Skeleton height="0.4rem" style={{ flex: 1 }} />
          </div>
        ))}
      </>
    )
  }
  if (top.length === 0) {
    return <EmptyState icon={<Smile aria-hidden="true" />}>No emote traffic in the current window.</EmptyState>
  }
  return (
    <>
      {top.map((emote) => (
        <div className="hx-emrow" key={emote.name}>
          <span className="em" aria-hidden="true">
            {emote.imageUrl ? <img src={emote.imageUrl} alt="" loading="lazy" /> : emote.name.slice(0, 2)}
          </span>
          <span className="meta">
            <span className="nm" title={emote.name}>
              {emote.name}
            </span>
            <span className="pv">{providerLabel(emote.provider)}</span>
          </span>
          <span className="bar" aria-hidden="true">
            <i style={{ width: `${clampPct((emote.count / max) * 100)}%` }} />
          </span>
          <span className="ct tnum">{compact(emote.count)}</span>
        </div>
      ))}
    </>
  )
}

/* ----------------------------------------------------- Coverage health */
export function CoverageHealthList({
  coverage,
  emoteIntel,
  pipeline,
}: {
  coverage: HubCoverage
  emoteIntel: HubEmoteIntel
  pipeline?: HubCorpusPipeline
}) {
  const ircSlots = ircSlotMetrics(coverage, pipeline)
  const backfillPct = coverage.backfillMax > 0 ? (coverage.backfillActive / coverage.backfillMax) * 100 : coverage.backfillActive > 0 ? 100 : 0
  const hasBackfill = coverage.backfillActive > 0 || coverage.backfillMax > 0
  const trackerExpected = pipeline
    ? pipeline.roster.expectedCollectorRows || Math.min(pipeline.roster.live, pipeline.collectorMax || pipeline.roster.live)
    : 0
  const trackerPct = pipeline && trackerExpected > 0
    ? (pipeline.roster.collectorTracking / trackerExpected) * 100
    : pipeline && pipeline.collectorMax > 0
      ? (pipeline.collectorActive / pipeline.collectorMax) * 100
      : 0
  const trackerColor = pipeline?.state === 'critical'
    ? 'hsl(var(--chart-5))'
    : pipeline?.state === 'degraded'
      ? 'hsl(var(--chart-4))'
      : 'hsl(var(--chart-1))'
  const trackerMeta = pipeline
    ? pipeline.roster.liveCollectorDeficitRows > 0
      ? `${compact(pipeline.roster.collectorTracking)} / ${compact(trackerExpected)} Top-${pipeline.topN} covered - ${compact(pipeline.roster.liveCollectorDeficitRows)} uncovered`
      : `${compact(pipeline.roster.collectorTracking)} / ${compact(trackerExpected || pipeline.collectorMax)} Top-${pipeline.topN} covered`
    : ''
  const freshnessProblem = (pipeline?.roster.metadataStale ?? 0) + (pipeline?.roster.zeroChatAfterAge ?? 0)
  const zeroChatPct =
    pipeline && pipeline.roster.live > 0
      ? ((pipeline.roster.live - Math.min(pipeline.roster.live, freshnessProblem)) / pipeline.roster.live) * 100
      : 100
  const tierPct = (tier: HubCorpusPipeline['silver']) =>
    tier.total > 0 ? ((tier.done + tier.skipped) / tier.total) * 100 : 0
  const tierMeta = (tier: HubCorpusPipeline['silver']) =>
    tier.total > 0
      ? `${compact(tier.done)} done · ${compact(tier.running)} running · ${compact(tier.queued)} queued${tier.failed > 0 ? ` · ${compact(tier.failed)} failed` : ''}${tier.oldestQueuedSeconds ? ` · oldest ${ageLabel(tier.oldestQueuedSeconds)}` : ''}`
      : tier.eligible > 0
        ? `${compact(tier.eligible)} eligible · queue idle (no jobs right now)`
        : 'queue idle (no jobs right now)'
  return (
    <div className="hx-health">
      <ProgressRow
        label={ircSlots.label}
        meta={ircSlots.meta}
        pct={ircSlots.pct}
        color={ircSlots.color}
      />
      <ProgressRow
        label="VOD backfill"
        meta={
          coverage.backfillActive > 0
            ? `${coverage.backfillActive}${coverage.backfillMax > 0 ? ` / ${coverage.backfillMax}` : ''} running`
            : 'Idle — no jobs queued'
        }
        pct={hasBackfill ? backfillPct : 0}
        color="hsl(var(--chart-4))"
      />
      <ProgressRow
        label="Analytics database"
        meta={coverage.databaseOk ? 'Healthy' : 'Degraded'}
        pct={coverage.databaseOk ? 100 : 35}
        color={coverage.databaseOk ? 'hsl(var(--chart-3))' : 'hsl(var(--chart-5))'}
      />
      <ProgressRow
        label="7TV subset of emotes"
        meta={`${Math.round(emoteIntel.seventvSharePct)}%`}
        pct={emoteIntel.seventvSharePct}
        color="hsl(var(--chart-2))"
      />
      {pipeline ? (
        <>
          <ProgressRow
            label={`Top-${pipeline.topN} IRC coverage`}
            meta={trackerMeta}
            pct={trackerPct}
            color={trackerColor}
          />
          <ProgressRow
            label={`Top-${pipeline.topN} chat freshness`}
            meta={
              pipeline.roster.metadataStale > 0
                ? `${compact(pipeline.roster.metadataStale)} stale metadata rows`
                : pipeline.roster.admissionDisabled > 0
                  ? `${compact(pipeline.roster.admissionDisabled)} admission disabled rows`
                  : pipeline.roster.zeroChatAfterAge > 0
                    ? `${compact(pipeline.roster.zeroChatAfterAge)} live rows need chat`
                    : 'Metadata and chat freshness OK'
            }
            pct={zeroChatPct}
            color={pipeline.roster.metadataStale > 0 || pipeline.roster.admissionDisabled > 0 ? 'hsl(var(--chart-5))' : pipeline.roster.zeroChatAfterAge > 0 ? 'hsl(var(--chart-4))' : 'hsl(var(--chart-3))'}
          />
          <ProgressRow
            label="Silver VOD backfill"
            meta={tierMeta(pipeline.silver)}
            pct={tierPct(pipeline.silver)}
            color="hsl(var(--chart-4))"
          />
          <ProgressRow
            label="Gold chat backfill"
            meta={tierMeta(pipeline.gold)}
            pct={tierPct(pipeline.gold)}
            color="hsl(var(--chart-2))"
          />
        </>
      ) : null}
    </div>
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

function providerSharesFromTopEmotes(emotes: HubEmote[]): HubProviderShare[] {
  const counts = new Map<string, number>()
  let total = 0
  for (const emote of emotes) {
    const count = Math.max(0, emote.count ?? 0)
    if (count === 0) continue
    const provider = providerLabel(emote.provider)
    counts.set(provider, (counts.get(provider) ?? 0) + count)
    total += count
  }
  if (total === 0) return []
  return [...counts.entries()]
    .map(([provider, count]) => ({ provider, count, sharePct: (count / total) * 100 }))
    .sort((a, b) => b.count - a.count || a.provider.localeCompare(b.provider))
}

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
  const providerShares = backendProviderShares.length > 0 ? backendProviderShares : providerSharesFromTopEmotes(topEmotes)
  const leadingProvider = providerShares[0]
  const ring = providerRing(providerShares)
  const trending = topEmotes.slice(0, 4)
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
            leadingProvider
              ? `${leadingProvider.provider} accounts for ${Math.round(leadingProvider.sharePct)}% of tracked emote traffic`
              : 'No provider share is available for tracked emote traffic'
          }
        >
          <span className="lbl">
            <b className="tnum">{Math.round(leadingProvider?.sharePct ?? 0)}%</b>
            <small>{leadingProvider?.provider ?? 'No data'}</small>
          </span>
        </div>
        <div className="leg">
          {(providerShares.length > 0 ? providerShares : [{ provider: 'No provider data', count: 0, sharePct: 0 }]).slice(0, 5).map((share, index) => (
            <span key={share.provider}>
              <span className="sw" style={{ background: PROVIDER_COLORS[index] ?? 'hsl(var(--secondary))' }} aria-hidden="true" />
              {share.provider} · {Math.round(share.sharePct)}%
            </span>
          ))}
          <span className="muted" style={{ fontSize: '0.72rem' }}>
            {compact(intel.uniqueEmotes)} unique emotes seen
          </span>
        </div>
      </div>
      <div className="hx-econ-split">
        <div>
          <div className="hx-card__desc" style={{ marginBottom: '0.35rem' }}>
            Trending now
          </div>
          {trending.length === 0 ? (
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              No emote traffic yet.
            </span>
          ) : (
            trending.map((emote) => (
              <div className="hx-trend" key={emote.name}>
                <span className="em" aria-hidden="true">
                  {emote.imageUrl ? <img src={emote.imageUrl} alt="" loading="lazy" /> : emote.name.slice(0, 2)}
                </span>
                <strong title={emote.name}>{emote.name}</strong>
                <span className="arrow rise">{Math.round(emote.sharePct)}%</span>
              </div>
            ))
          )}
        </div>
        <div>
          <div className="hx-card__desc" style={{ marginBottom: '0.35rem' }}>
            Velocity
          </div>
          <EconStat label="Emotes / min" value={compact(intel.emotesPerMin)} />
          <EconStat label="Biggest peak" value={`${compact(intel.biggestPeakPerMin)}/m`} />
          <EconStat label="Top emote share" value={`${Math.round(intel.topEmoteSharePct)}%`} />
        </div>
      </div>
    </>
  )
}

function EconStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="hx-trend" style={{ borderTop: 'none' }}>
      <span className="muted" style={{ fontSize: '0.8rem' }}>
        {label}
      </span>
      <strong className="arrow tnum">{value}</strong>
    </div>
  )
}

/* -------------------------------------------------------- Moments feed */
const MOMENT_ICONS: Record<string, { icon: ReactNode; tint: string }> = {
  live_attach: { icon: <Radio />, tint: 'chart-3' },
  chat_spike: { icon: <MessageSquare />, tint: 'chart-1' },
  emote_spike: { icon: <Smile />, tint: 'chart-2' },
  backfill_queued: { icon: <Clock />, tint: 'chart-4' },
  backfill_done: { icon: <CheckCircle2 />, tint: 'chart-3' },
}

function momentVisual(kind: HubMomentKind) {
  return MOMENT_ICONS[kind] ?? { icon: <Zap />, tint: 'chart-4' }
}

export function MomentsFeedList({ moments, loading }: { moments: HubMoment[]; loading?: boolean }) {
  if (loading && moments.length === 0) {
    return (
      <>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.6rem', padding: '0.55rem 0' }}>
            <Skeleton width={26} height={26} radius="0.4rem" />
            <div style={{ flex: 1 }}>
              <Skeleton width="80%" height="0.8rem" />
              <Skeleton width="30%" height="0.6rem" style={{ marginTop: '0.35rem' }} />
            </div>
          </div>
        ))}
      </>
    )
  }
  if (moments.length === 0) {
    return (
      <EmptyState icon={<Zap aria-hidden="true" />}>
        No moments detected yet — chat and emote spikes appear here as live rooms heat up.
      </EmptyState>
    )
  }
  return (
    <div className="hx-feed">
      {moments.slice(0, 10).map((moment, index) => {
        const visual = momentVisual(moment.kind)
        const name = moment.displayName?.trim() || moment.login?.trim() || ''
        const rawLabel = moment.label ?? ''
        // Backend labels sometimes already include the channel name (e.g.
        // "Cinna emote spam spike"); strip it so we don't render "Cinna Cinna …".
        const label =
          name && rawLabel.toLowerCase().startsWith(name.toLowerCase())
            ? rawLabel.slice(name.length).replace(/^[\s:·–-]+/, '')
            : rawLabel
        return (
          <div className="ev" key={`${moment.kind}-${moment.at}-${index}`}>
            <span
              className="ic"
              style={{ background: `hsl(var(--${visual.tint}) / 0.15)`, color: `hsl(var(--${visual.tint}))` }}
              aria-hidden="true"
            >
              {visual.icon}
            </span>
            <div className="body">
              <div className="t">
                {name ? <b>{name} </b> : null}
                {label}
                {moment.detail ? <span className="muted"> · {moment.detail}</span> : null}
              </div>
              <div className="tm">{relTime(moment.at)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ----------------------------------------------------- Recent sessions */
export function RecentSessionsPanel({
  sessions,
  loading,
  historyUnavailable,
}: {
  sessions: RecentSessionRow[]
  loading?: boolean
  historyUnavailable?: boolean
}) {
  if (loading && sessions.length === 0) {
    return (
      <>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.6rem 0' }}>
            <Skeleton width={32} height={32} radius="9999px" />
            <div style={{ flex: 1 }}>
              <Skeleton width="55%" height="0.85rem" />
              <Skeleton width="35%" height="0.6rem" style={{ marginTop: '0.35rem' }} />
            </div>
          </div>
        ))}
      </>
    )
  }
  if (sessions.length === 0) {
    return (
      <EmptyState icon={<Inbox aria-hidden="true" />}>
        {historyUnavailable
          ? 'Session history is unavailable for these channels right now.'
          : 'No recent sessions yet — pin a channel to your watchlist to collect recaps.'}
      </EmptyState>
    )
  }
  return (
    <>
      {sessions.map((session) => (
        <Link
          key={`${session.login}-${session.streamId}`}
          to={`/analytics/${encodeURIComponent(session.login)}/s/${encodeURIComponent(session.streamId)}`}
          className="hx-session"
        >
          <Avatar login={session.login} />
          <span className="info">
            <strong title={session.title}>{session.title}</strong>
            <small>
              {session.login} · {session.syncBadge}
            </small>
          </span>
          <span className="go">
            Open <ChevronRight size={14} aria-hidden="true" />
          </span>
        </Link>
      ))}
    </>
  )
}
