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
import { buildAnalyticsHref } from '../../../lib/analyticsLinks'
import { ircSlotMetrics } from '../../../lib/coverageHealthMetrics'
import type { RecentSessionRow } from '../../../hooks/useAnalyticsHubData'
import { EmoteImg } from '../analytics/EmoteImg'
import { EmoteProviderIcon } from '../analytics/EmoteProviderIcon'
import { HubTopEmotesTable } from '../analytics/HubTopEmotesTable'
import {
  compact,
  formatLeadingEmoteShare,
  formatMoverVelocity,
  formatStreamUptime,
  formatTopMoversHonestyNote,
  providerLabel,
  twitchLivePreviewUrlFresh,
  type TopMoversHonestyContext,
} from '../analytics/hubFormat'
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

/* ------------------------------------------------- Top streamers rail */
type RankedChannel = { channel: HubLiveChannel; rank: number }

function StreamChip({ channel, rank, ghost }: { channel: HubLiveChannel; rank: number; ghost?: boolean }) {
  const name = channel.displayName?.trim() || channel.login
  const category = channel.category?.trim()
  const title = channel.title?.trim()
  const uptime = formatStreamUptime(channel.startedAt)
  const previewUrl = twitchLivePreviewUrlFresh(channel.login, 320, 180)
  return (
    <Link
      to={buildAnalyticsHref({ login: channel.login, streamId: channel.streamId })}
      className="hx-streamchip"
      role={ghost ? undefined : 'listitem'}
      aria-hidden={ghost ? true : undefined}
      tabIndex={ghost ? -1 : undefined}
    >
      <div className="hx-streamchip__thumb">
        <img
          className="hx-streamchip__preview"
          src={previewUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
        <span className={`hx-streamchip__rk${rank <= 3 ? ' hx-streamchip__rk--top' : ''}`} aria-hidden="true">
          {rank}
        </span>
        <span className="hx-streamchip__live">LIVE</span>
        <span className="hx-streamchip__viewers">{compact(channel.viewers)}</span>
        <span className="hx-streamchip__av">
          <Avatar login={channel.login} src={channel.profileImageUrl} alt={name} />
        </span>
      </div>
      <span className="meta">
        <strong title={name}>{name}</strong>
        {title ? (
          <span className="hx-streamchip__title" title={title}>
            {title}
          </span>
        ) : null}
        <span className="cat" title={category || 'Live now'}>
          {category || 'Live now'}
          {uptime ? <span className="hx-streamchip__uptime"> · {uptime}</span> : null}
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
              <Skeleton width="100%" height={90} radius="0.5rem" />
              <span className="meta">
                <Skeleton width="6rem" height="0.85rem" />
                <Skeleton width="4.5rem" height="0.7rem" style={{ marginTop: '0.4rem' }} />
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
  const top = emotes.slice(0, 12)
  const max = top.reduce((acc, e) => Math.max(acc, e.count), 0) || 1
  if (loading && emotes.length === 0) {
    return (
      <table className="hx-emtable">
        <tbody>
          {Array.from({ length: 6 }).map((_, i) => (
            <tr key={i}>
              <td colSpan={5}>
                <Skeleton height={34} radius="0.35rem" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  if (top.length === 0) {
    return <EmptyState icon={<Smile aria-hidden="true" />}>No emote traffic in the current window.</EmptyState>
  }
  return (
    <table className="hx-emtable" aria-label="Top emotes ranked by use count">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Emote</th>
          <th scope="col">Provider</th>
          <th scope="col">Uses</th>
          <th scope="col">Share</th>
        </tr>
      </thead>
      <tbody>
        {top.map((emote, index) => (
          <tr key={`${emote.name}-${index}`}>
            <td className="rk tnum">{index + 1}</td>
            <td>
              <span className="hx-emtable__cell">
                <span className="em" aria-hidden="true">
                  {emote.imageUrl ? <img src={emote.imageUrl} alt="" loading="lazy" /> : emote.name.slice(0, 2)}
                </span>
                <code>{emote.name}</code>
              </span>
            </td>
            <td className="pv">
              <EmoteProviderIcon provider={emote.provider} size={16} />
            </td>
            <td className="ct tnum">{compact(emote.count)}</td>
            <td>
              <span className="bar" aria-hidden="true">
                <i style={{ width: `${clampPct((emote.count / max) * 100)}%` }} />
              </span>
              <span className="ct tnum">{emote.sharePct > 0 ? `${emote.sharePct.toFixed(1)}%` : '—'}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
  return (
    <div className="hx-health">
      <ProgressRow
        label={ircSlots.label}
        meta={ircSlots.meta}
        pct={ircSlots.pct}
        color={ircSlots.color}
      />
      <ProgressRow
        label="Manual VOD import"
        meta={
          coverage.backfillActive > 0
            ? `${coverage.backfillActive}${coverage.backfillMax > 0 ? ` / ${coverage.backfillMax}` : ''} running`
            : 'Idle — per-channel import only'
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
            meta={trackerMeta ? `${trackerMeta} · diagnostic only (not chart fill)` : 'Diagnostic only (not chart fill)'}
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
              <EmoteProviderIcon provider={share.provider} size={14} />
              {Math.round(share.sharePct)}%
            </span>
          ))}
          <span className="muted" style={{ fontSize: '0.72rem' }}>
            {compact(intel.uniqueEmotes)} unique emotes seen
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

function MomentEmoteChips({ emotes }: { emotes: HubEmote[] | undefined }) {
  if (!emotes || emotes.length === 0) return null
  return (
    <div className="hx-feed__emotes" aria-label="Moment top emotes">
      {emotes.slice(0, 4).map((emote, index) => (
        <span className="hx-feed__emote" key={`${emote.provider ?? 'emote'}-${emote.name}-${index}`}>
          {emote.imageUrl ? <img src={emote.imageUrl} alt="" loading="lazy" decoding="async" /> : null}
          <span>{emote.name}</span>
          {emote.count > 0 ? <small>{compact(emote.count)}</small> : null}
        </span>
      ))}
    </div>
  )
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
        No live peaks yet — chat and emote spikes appear here as tracked rooms heat up.
      </EmptyState>
    )
  }
  return (
    <div className="hx-feed">
      {moments.slice(0, 10).map((moment, index) => {
        const visual = momentVisual(moment.kind)
        const name = moment.displayName?.trim() || moment.login?.trim() || ''
        const login = moment.login?.trim().toLowerCase() ?? ''
        const streamId = moment.streamId?.trim() ?? ''
        const streamHref =
          login && streamId ? `/analytics/${encodeURIComponent(login)}/${encodeURIComponent(streamId)}` : login ? `/analytics/${encodeURIComponent(login)}` : ''
        const rawLabel = moment.label ?? ''
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
                {moment.magnitude != null && moment.magnitude > 0 ? (
                  <span className="muted"> · +{Math.round(moment.magnitude)}%</span>
                ) : null}
              </div>
              <div className="tm">
                {relTime(moment.at)}
                {streamHref ? (
                  <>
                    {' · '}
                    <Link to={streamHref} className="hx-feed__open">
                      Open stream
                    </Link>
                  </>
                ) : null}
              </div>
              <MomentEmoteChips emotes={moment.topEmotes} />
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
          : 'No recent channels yet — search above or open a channel to populate shortcuts.'}
      </EmptyState>
    )
  }
  return (
    <>
      {sessions.map((session) => (
        <Link
          key={`${session.login}-${session.streamId || session.login}`}
          to={buildAnalyticsHref({ login: session.login, streamId: session.streamId || undefined })}
          className="hx-session"
        >
          <Avatar login={session.login} src={session.profileImageUrl} alt={session.title} />
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
