import type { ReactNode } from 'react'
import { Database, Layers, Radar, Sparkles } from 'lucide-react'
import {
  resolveConfiguredRosterDisplay,
  type HubCorpusPipeline,
  type HubTierCounts,
} from '../../../lib/publicHub'
import { Skeleton } from '../../primitives'
import { compact } from './hubFormat'

function tierDonePct(tier: HubTierCounts): number {
  if (tier.total <= 0) return 0
  return Math.min(100, Math.round((tier.done / tier.total) * 100))
}

function TierBackfillCard({
  label,
  subtitle,
  tier,
  accent,
  icon,
}: {
  label: string
  subtitle: string
  tier: HubTierCounts
  accent: string
  icon: ReactNode
}) {
  const donePct = tierDonePct(tier)
  const queuedLabel =
    tier.oldestQueuedSeconds != null && tier.oldestQueuedSeconds > 0
      ? `${compact(Math.round(tier.oldestQueuedSeconds / 60))}m oldest queue`
      : 'Queue idle'

  return (
    <article className="cp__card" aria-label={`${label} backfill tier`}>
      <div className="cp__card-top">
        <span className="cp__ic" style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }}>
          {icon}
        </span>
        <div className="cp__card-id">
          <strong>{label}</strong>
          <small>{subtitle}</small>
        </div>
        <span className="cp__pct">{donePct}%</span>
      </div>
      <div className="cp__big">
        {compact(tier.done)}
        <small>/ {compact(tier.total)} jobs done</small>
      </div>
      <div className="cp__bar" aria-hidden="true">
        <i style={{ width: `${donePct}%`, background: accent }} />
      </div>
      <ul className="cp__roster">
        <li>
          <span>Queued</span>
          <b>{compact(tier.queued)}</b>
        </li>
        <li>
          <span>Running</span>
          <b>{compact(tier.running)}</b>
        </li>
        <li className={tier.failed > 0 ? 'is-bad' : undefined}>
          <span>Failed</span>
          <b>{compact(tier.failed)}</b>
        </li>
        <li>
          <span>Eligible</span>
          <b>{compact(tier.eligible)}</b>
        </li>
      </ul>
      <small className="cp__desc">{queuedLabel}</small>
    </article>
  )
}

/**
 * Corpus pipeline card: Top-N live tracker + Silver/Gold backfill tier counts.
 * Aggregate only — never per-channel rows or job errors.
 */
export function CorpusPipelineCard({
  pipeline,
  loading = false,
}: {
  pipeline: HubCorpusPipeline
  loading?: boolean
}) {
  const collectorPct =
    pipeline.collectorMax > 0
      ? Math.min(100, Math.round((pipeline.collectorActive / pipeline.collectorMax) * 100))
      : 0
  const hasData =
    pipeline.collectorMax > 0 ||
    pipeline.collectorActive > 0 ||
    pipeline.roster.live > 0 ||
    pipeline.silver.total > 0 ||
    pipeline.gold.total > 0
  const pipelineProblem = pipeline.state === 'critical' || pipeline.state === 'degraded'
  const pipelineTone = pipeline.state === 'critical' ? 'bad' : pipeline.state === 'degraded' ? 'warn' : undefined
  const issueParts = [
    pipeline.roster.metadataStale > 0 ? `${compact(pipeline.roster.metadataStale)} stale metadata` : '',
    pipeline.roster.admissionFeatureDisabled > 0 ? 'live tracking is offline' : '',
    pipeline.roster.admissionDisabled > 0 && pipeline.roster.admissionFeatureDisabled === 0 ? `${compact(pipeline.roster.admissionDisabled)} admission off` : '',
    pipeline.roster.liveCollectorDeficitRows > 0
      ? `${compact(pipeline.roster.liveCollectorDeficitRows)} Top-${pipeline.topN} IRC uncovered`
      : '',
    pipeline.roster.zeroChatAfterAge > 0 ? `${compact(pipeline.roster.zeroChatAfterAge)} zero-chat aged` : '',
  ].filter(Boolean)

  const rosterDisplay = resolveConfiguredRosterDisplay(pipeline.roster)
  const rosterStats: Array<{ label: string; value: number; tone?: 'warn' | 'bad' }> = [
    { label: 'Live', value: rosterDisplay.live },
    { label: 'IRC collectors', value: pipeline.collectorActive },
    {
      label: 'Configured roster confirmed',
      value: rosterDisplay.confirmed,
      tone: rosterDisplay.consistent ? undefined : 'bad',
    },
    { label: 'Connected quiet', value: rosterDisplay.connectedQuiet },
    { label: 'Warming', value: rosterDisplay.warming },
    {
      label: 'Unresolved',
      value: rosterDisplay.unresolved,
      tone: !rosterDisplay.consistent
        ? 'bad'
        : rosterDisplay.unresolved > 0
          ? 'warn'
          : undefined,
    },
    { label: 'Metadata only — no chat coverage', value: pipeline.roster.metadataOnly },
    {
      label: 'Stale metadata',
      value: pipeline.roster.metadataStale,
      tone: pipeline.roster.metadataStale > 0 ? 'bad' : undefined,
    },
    {
      label: 'Tracking offline',
      value: pipeline.roster.admissionFeatureDisabled,
      tone: pipeline.roster.admissionFeatureDisabled > 0 ? 'bad' : undefined,
    },
    {
      label: 'IRC uncovered',
      value: pipeline.roster.liveCollectorDeficitRows,
      tone: pipeline.roster.liveCollectorDeficitRows > 0 ? 'warn' : undefined,
    },
    {
      label: 'Capacity blocked',
      value: pipeline.roster.capacityBlocked,
      tone: pipeline.roster.capacityBlocked > 0 ? 'warn' : undefined,
    },
  ]

  return (
    <section className="cp" aria-labelledby="cp-h">
      <div className="cp__head">
        <div className="cp__head-l">
          <h2 id="cp-h">Corpus pipeline</h2>
          <span className="cp__desc">
            Top-{pipeline.topN} live tracker + Silver/Gold backfill — aggregate, sanitized
          </span>
        </div>
        <span className={pipelineTone ? `cp__src is-${pipelineTone}` : 'cp__src'}>
          {pipelineProblem ? pipeline.state : 'Backend source of truth'}
        </span>
      </div>

      {loading ? (
        <Skeleton height={188} radius="calc(var(--sc-radius) + 0.35rem)" />
      ) : (
        <div className="cp__grid">
          <article className="cp__card cp__card--tracker" aria-label={`Top-${pipeline.topN} live metadata tracker`}>
            <div className="cp__card-top">
              <span
                className="cp__ic"
                style={{ background: 'hsl(var(--sc-chart-1) / 0.16)', color: 'hsl(var(--sc-chart-1))' }}
              >
                <Radar size={16} aria-hidden="true" />
              </span>
              <div className="cp__card-id">
                <strong>Live metadata tracker</strong>
                <small>Top {pipeline.topN} by viewers</small>
              </div>
            </div>
            <div className="cp__big">
              {compact(pipeline.collectorActive)}
              <small>/ {compact(pipeline.collectorMax)} collector slots</small>
            </div>
            <div className="cp__bar" aria-hidden="true">
              <i style={{ width: `${collectorPct}%`, background: 'hsl(var(--sc-chart-1))' }} />
            </div>
            <ul className="cp__roster">
              {rosterStats.map((stat) => (
                <li key={stat.label} className={stat.tone ? `is-${stat.tone}` : undefined}>
                  <span>{stat.label}</span>
                  <b>{compact(stat.value)}</b>
                </li>
              ))}
            </ul>
          </article>

          <TierBackfillCard
            label="Silver"
            subtitle="TwitchTracker scrape"
            tier={pipeline.silver}
            accent="hsl(var(--sc-chart-2))"
            icon={<Layers size={16} aria-hidden="true" />}
          />
          <TierBackfillCard
            label="Gold"
            subtitle="Twitch GQL VOD chat"
            tier={pipeline.gold}
            accent="hsl(var(--sc-chart-3))"
            icon={<Sparkles size={16} aria-hidden="true" />}
          />
        </div>
      )}

      {!loading && pipelineProblem ? (
        <p className={`cp__note is-${pipelineTone ?? 'warn'}`} role="note">
          <Database size={13} aria-hidden="true" />
          Collector health is {pipeline.state}:{' '}
          {issueParts.length > 0 ? issueParts.join(' · ') : 'backend reported degraded state'}.
        </p>
      ) : !loading && !hasData ? (
        <p className="cp__note" role="note">
          <Database size={13} aria-hidden="true" />
          No corpus activity yet. Live collector and backfill tier counts populate when workers are active on
          streampulse-vps.
        </p>
      ) : null}
    </section>
  )
}
