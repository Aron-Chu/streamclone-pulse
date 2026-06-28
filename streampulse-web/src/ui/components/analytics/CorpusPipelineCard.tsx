import { Database, Layers, Radar } from 'lucide-react'
import type { HubCorpusPipeline, HubTierCounts } from '../../../lib/publicHub'
import { Skeleton } from '../../primitives'
import { compact } from './hubFormat'

/**
 * CorpusPipelineCard renders the hosted-safe corpus pipeline: the top-N
 * metadata tracker roster summary and the Silver/Gold VOD backfill tier counts.
 *
 * Everything here is aggregate-only (counts, never per-channel rows/logins). It
 * degrades honestly: on local dev where the collector and backfill workers are
 * idle, every value is zero and the card shows a calm "populated on the hosted
 * collector" note instead of fabricated numbers.
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
    pipeline.silver.eligible > 0 ||
    pipeline.gold.total > 0 ||
    pipeline.gold.eligible > 0
  const pipelineProblem = pipeline.state === 'critical' || pipeline.state === 'degraded'
  const pipelineTone = pipeline.state === 'critical' ? 'bad' : pipeline.state === 'degraded' ? 'warn' : undefined
  const issueParts = [
    pipeline.roster.metadataStale > 0 ? `${compact(pipeline.roster.metadataStale)} stale metadata` : '',
    pipeline.roster.admissionDisabled > 0 ? `${compact(pipeline.roster.admissionDisabled)} admission off` : '',
    pipeline.roster.liveCollectorDeficitRows > 0 ? `${compact(pipeline.roster.liveCollectorDeficitRows)} Top-${pipeline.topN} IRC uncovered` : '',
    pipeline.roster.zeroChatAfterAge > 0 ? `${compact(pipeline.roster.zeroChatAfterAge)} zero-chat aged` : '',
  ].filter(Boolean)

  const rosterStats: Array<{ label: string; value: number; tone?: 'warn' | 'bad' }> = [
    { label: 'Live', value: pipeline.roster.live },
    { label: 'Collecting chat', value: pipeline.roster.collecting },
    { label: 'Metadata only', value: pipeline.roster.metadataOnly },
    {
      label: 'Stale metadata',
      value: pipeline.roster.metadataStale,
      tone: pipeline.roster.metadataStale > 0 ? 'bad' : undefined,
    },
    {
      label: 'Admission off',
      value: pipeline.roster.admissionDisabled,
      tone: pipeline.roster.admissionDisabled > 0 ? 'bad' : undefined,
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
            Top-{pipeline.topN} metadata tracker · Silver &amp; Gold VOD backfill · aggregate, sanitized
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
          <article className="cp__card cp__card--tracker" aria-label={`Top-${pipeline.topN} metadata tracker`}>
            <div className="cp__card-top">
              <span className="cp__ic" style={{ background: 'hsl(var(--sc-chart-1) / 0.16)', color: 'hsl(var(--sc-chart-1))' }}>
                <Radar size={16} aria-hidden="true" />
              </span>
              <div className="cp__card-id">
                <strong>Metadata tracker</strong>
                <small>Top {pipeline.topN} by viewers</small>
              </div>
            </div>
            <div className="cp__big">
              {compact(pipeline.collectorActive)}
              <small>
                / {compact(pipeline.collectorMax)} collector slots
              </small>
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

          <TierCard
            title="Silver tier"
            subtitle="Chat-window VOD backfill"
            counts={pipeline.silver}
            accent="hsl(220 9% 72%)"
          />
          <TierCard
            title="Gold tier"
            subtitle="Full coverage VOD backfill"
            counts={pipeline.gold}
            accent="hsl(var(--sc-chart-4))"
          />
        </div>
      )}

      {!loading && pipelineProblem ? (
        <p className={`cp__note is-${pipelineTone ?? 'warn'}`} role="note">
          <Database size={13} aria-hidden="true" />
          Tracker health is {pipeline.state}: {issueParts.length > 0 ? issueParts.join(' · ') : 'backend reported degraded state'}.
        </p>
      ) : !loading && !hasData ? (
        <p className="cp__note" role="note">
          <Database size={13} aria-hidden="true" />
          Pipeline counts populate on the hosted collector. This dev backend has an idle tracker and backfill queue.
        </p>
      ) : null}
    </section>
  )
}

function TierCard({
  title,
  subtitle,
  counts,
  accent,
}: {
  title: string
  subtitle: string
  counts: HubTierCounts
  accent: string
}) {
  const total = counts.total || 0
  const donePct = total > 0 ? Math.round((counts.done / total) * 100) : 0
  const segments: Array<{ key: string; value: number; color: string }> = [
    { key: 'done', value: counts.done, color: 'hsl(var(--sc-chart-3))' },
    { key: 'running', value: counts.running, color: 'hsl(var(--sc-chart-1))' },
    { key: 'queued', value: counts.queued, color: 'hsl(var(--sc-muted-foreground) / 0.6)' },
    { key: 'failed', value: counts.failed, color: 'hsl(var(--sc-chart-5))' },
  ]
  const segTotal = segments.reduce((acc, seg) => acc + seg.value, 0) || 1

  const queueIdleWithEligible = counts.eligible > 0 && counts.queued + counts.running === 0
  const chips: Array<{ label: string; value: number; tone?: 'warn' | 'bad' }> = [
    {
      label: 'Eligible',
      value: counts.eligible,
      tone: queueIdleWithEligible ? 'warn' : undefined,
    },
    { label: 'Running', value: counts.running },
    { label: 'Queued', value: counts.queued },
    { label: 'Failed', value: counts.failed, tone: counts.failed > 0 ? 'bad' : undefined },
  ]

  return (
    <article className="cp__card" aria-label={`${title} backfill`}>
      <div className="cp__card-top">
        <span className="cp__ic" style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }}>
          <Layers size={16} aria-hidden="true" />
        </span>
        <div className="cp__card-id">
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </div>
        <span className="cp__pct" style={{ color: accent }}>
          {donePct}%
        </span>
      </div>
      <div className="cp__big">
        {compact(counts.done)}
        <small>/ {compact(total)} jobs done</small>
      </div>
      <div className="cp__seg" aria-hidden="true">
        {segments
          .filter((seg) => seg.value > 0)
          .map((seg) => (
            <i key={seg.key} style={{ width: `${(seg.value / segTotal) * 100}%`, background: seg.color }} />
          ))}
      </div>
      <ul className="cp__chips">
        {chips.map((chip) => (
          <li key={chip.label} className={chip.tone ? `is-${chip.tone}` : undefined}>
            <b>{compact(chip.value)}</b>
            <span>{chip.label}</span>
          </li>
        ))}
      </ul>
    </article>
  )
}
