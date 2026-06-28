import { Link } from 'react-router-dom'
import { Smile } from 'lucide-react'
import type { HubCorpusPipeline, HubCoverage, HubEmote, HubMover } from '../../../lib/publicHub'
import { ircSlotMetrics } from '../../../lib/coverageHealthMetrics'
import { Skeleton } from '../../primitives'
import { compact, displayName, emoteBadges, initial, providerLabel } from './hubFormat'

/* ----------------------------------------------------------- recent channels */
export interface RecentChannelItem {
  login: string
  live?: boolean
}

export function RecentChannelsCard({ recents }: { recents: RecentChannelItem[] }) {
  return (
    <section className="dash-card" aria-labelledby="dash-rc-h">
      <div className="dash-card-header">
        <div className="dash-card-title" id="dash-rc-h">
          Recent channels
        </div>
      </div>
      <div className="dash-card-content dash-chan" style={{ paddingTop: 0 }}>
        {recents.length === 0 ? (
          <p className="dash-card-desc" style={{ padding: '0.4rem 0' }}>
            Channels you open appear here.
          </p>
        ) : (
          recents.slice(0, 6).map((item) => (
            <Link key={item.login} to={`/analytics/${encodeURIComponent(item.login)}`}>
              <span className="av" aria-hidden="true">
                {initial(item.login)}
              </span>
              <strong>{item.login}</strong>
              <small>{item.live ? 'live ›' : 'open ›'}</small>
            </Link>
          ))
        )}
      </div>
    </section>
  )
}

/* --------------------------------------------------------------- top movers */
export function TopMoversCard({ movers, loading = false }: { movers: HubMover[]; loading?: boolean }) {
  return (
    <section className="dash-card" aria-labelledby="dash-mv-h">
      <div className="dash-card-header">
        <div className="dash-card-title" id="dash-mv-h">
          Top movers
        </div>
        <div className="dash-card-desc">By emotes/min · last 15m</div>
      </div>
      <div className="dash-card-content" style={{ paddingTop: 0 }}>
        {loading && movers.length === 0 ? (
          <Skeleton height={150} radius="var(--sc-radius)" />
        ) : movers.length === 0 ? (
          <p className="dash-card-desc" style={{ padding: '0.4rem 0' }}>
            No emote movers yet.
          </p>
        ) : (
          movers.slice(0, 5).map((mover, index) => (
            <div className="dash-mover" key={mover.login}>
              <span className="rk">{index + 1}</span>
              <span className="av" aria-hidden="true">
                {initial(mover.login)}
              </span>
              <strong>{displayName(mover.login, mover.displayName)}</strong>
              <span className="v">{compact(Math.max(mover.emotesPerMin ?? 0, mover.seventvPerMin))}</span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------- global emotes */
export function GlobalEmotesCard({ emotes, loading = false }: { emotes: HubEmote[]; loading?: boolean }) {
  const max = emotes.reduce((acc, emote) => Math.max(acc, emote.count), 0) || 1
  const providers = Array.from(new Set(emotes.map((emote) => providerLabel(emote.provider)))).slice(0, 3)
  return (
    <section className="dash-card" aria-labelledby="dash-ge-h">
      <div className="dash-card-header row">
        <div>
          <div className="dash-card-title" id="dash-ge-h">
            Global top emotes
          </div>
          <div className="dash-card-desc">Tracked providers · trailing window</div>
        </div>
        <span className="dash-badge dash-badge--outline">{providers.length > 0 ? providers.join(' / ') : 'live'}</span>
      </div>
      <div className="dash-card-content" style={{ paddingTop: 0 }}>
        {loading && emotes.length === 0 ? (
          <Skeleton height={160} radius="var(--sc-radius)" />
        ) : emotes.length === 0 ? (
          <div className="dash-empty" style={{ padding: '1rem' }}>
            <Smile aria-hidden="true" />
            <span>No emote activity yet.</span>
          </div>
        ) : (
          emotes.slice(0, 5).map((emote, index) => (
            <div className="dash-emrow" key={`${emote.name}-${index}`}>
              <span className="em" aria-hidden="true">
                {emote.imageUrl ? <img src={emote.imageUrl} alt="" loading="lazy" /> : emote.name.slice(0, 2)}
              </span>
              <span className="dash-emmain">
                <span className="nm">{emote.name}</span>
                <span className="dash-emtags">
                  {emoteBadges(emote).map((badge) => (
                    <span key={badge}>{badge}</span>
                  ))}
                </span>
              </span>
              <span className="bar" aria-hidden="true">
                <i style={{ width: `${Math.max(6, Math.round((emote.count / max) * 100))}%` }} />
              </span>
              <span className="ct">{compact(emote.count)}</span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

/* ---------------------------------------------------------- coverage health */
export function CoverageHealthCard({
  coverage,
  pipeline,
  backendCaption,
}: {
  coverage: HubCoverage
  pipeline?: HubCorpusPipeline
  backendCaption?: string
}) {
  const ircSlots = ircSlotMetrics(coverage, pipeline)
  const trackerExpected = pipeline
    ? pipeline.roster.expectedCollectorRows || Math.min(pipeline.roster.live, pipeline.collectorMax || pipeline.roster.live)
    : 0
  const trackerPct = pipeline && trackerExpected > 0
    ? Math.min(100, Math.round((pipeline.roster.collectorTracking / trackerExpected) * 100))
    : 0
  const trackerBad = (pipeline?.roster.metadataStale ?? 0) > 0 || (pipeline?.roster.admissionDisabled ?? 0) > 0
  const trackerWarn = (pipeline?.roster.liveCollectorDeficitRows ?? 0) > 0 || (pipeline?.roster.capacityBlocked ?? 0) > 0
  const backfillPct = coverage.backfillMax > 0
    ? Math.min(100, Math.round((coverage.backfillActive / coverage.backfillMax) * 100))
    : coverage.backfillActive > 0
      ? 50
      : 0

  const rows = [
    {
      key: 'sync',
      label: ircSlots.label,
      status: ircSlots.meta,
      pct: ircSlots.pct,
      color: ircSlots.color.replace('--chart-', '--sc-chart-'),
    },
    ...(pipeline
      ? [{
          key: 'tracker',
          label: `Top-${pipeline.topN} tracker`,
          status: trackerBad
            ? `${compact(pipeline.roster.metadataStale || pipeline.roster.admissionDisabled)} blocked`
            : trackerWarn
              ? `${compact(pipeline.roster.liveCollectorDeficitRows || pipeline.roster.capacityBlocked)} uncovered`
              : `${compact(pipeline.roster.collectorTracking)} / ${compact(trackerExpected)} covered`,
          pct: trackerPct,
          color: trackerBad ? 'hsl(var(--sc-chart-5))' : trackerWarn ? 'hsl(var(--sc-chart-4))' : 'hsl(var(--sc-chart-1))',
        }]
      : []),
    {
      key: 'backfill',
      label: 'VOD backfill',
      status: `${coverage.backfillActive} active`,
      pct: backfillPct,
      color: 'hsl(var(--sc-chart-4))',
    },
    {
      key: 'db',
      label: 'Analytics DB',
      status: coverage.databaseOk ? 'ready' : 'down',
      pct: coverage.databaseOk ? 100 : 0,
      color: 'hsl(var(--sc-chart-1))',
    },
    {
      key: 'emote',
      label: 'Emote index',
      status: `${compact(coverage.emotesIndexed)} tracked`,
      pct: coverage.emotesIndexed > 0 ? 100 : 0,
      color: 'hsl(var(--sc-chart-2))',
    },
  ]

  return (
    <section className="dash-card" aria-labelledby="dash-hl-h" id="dash-coverage">
      <div className="dash-card-header">
        <div className="dash-card-title" id="dash-hl-h">
          Coverage health
        </div>
        <div className="dash-card-desc">{backendCaption ?? 'Backend source of truth'}</div>
      </div>
      <div className="dash-card-content dash-health" style={{ paddingTop: '0.2rem' }}>
        {rows.map((row) => (
          <div key={row.key}>
            <div className="h">
              <span className="d" style={{ background: row.color }} />
              <strong>{row.label}</strong>
              <span className="st">{row.status}</span>
            </div>
            <div className="progress">
              <i style={{ width: `${row.pct}%`, background: row.color }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
