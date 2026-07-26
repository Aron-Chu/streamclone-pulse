import { Database, Radar } from 'lucide-react'
import {
  resolveConfiguredRosterDisplay,
  type HubCorpusPipeline,
} from '../../../lib/publicHub'
import { compact } from '../analytics/hubFormat'
import { Skeleton } from './primitives'

export function CorpusPipelineCard({
  pipeline,
  loading = false,
  stripLayout = false,
}: {
  pipeline: HubCorpusPipeline
  loading?: boolean
  /** Horizontal stat strip for the diagnostics footer. */
  stripLayout?: boolean
}) {
  const collectorPct =
  pipeline.collectorMax > 0
  ? Math.min(100, Math.round((pipeline.collectorActive / pipeline.collectorMax) * 100))
  : 0
  const hasData =
  pipeline.collectorMax > 0 ||
  pipeline.collectorActive > 0 ||
  pipeline.roster.live > 0
  const pipelineProblem = pipeline.state === 'critical' || pipeline.state === 'degraded'
  const pipelineTone = pipeline.state === 'critical' ? 'bad' : pipeline.state === 'degraded' ? 'warn' : undefined
  const issueParts = [
  pipeline.roster.metadataStale > 0 ? `${compact(pipeline.roster.metadataStale)} stale metadata` : '',
  pipeline.roster.admissionDisabled > 0 ? `${compact(pipeline.roster.admissionDisabled)} admission off` : '',
  pipeline.roster.liveCollectorDeficitRows > 0
  ? `${compact(pipeline.roster.liveCollectorDeficitRows)} Top-${pipeline.topN} IRC uncovered`
  : '',
  pipeline.roster.zeroChatAfterAge > 0 ? `${compact(pipeline.roster.zeroChatAfterAge)} zero-chat aged` : '',
  ].filter(Boolean)

  const rosterDisplay = resolveConfiguredRosterDisplay(pipeline.roster)
  const rosterStats: Array<{ label: string; value: number; tone?: 'warn' | 'bad' }> = [
  { label: 'Live', value: rosterDisplay.live },
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

  if (stripLayout) {
  return (
  <section className="cp cp--compact" aria-labelledby="cp-h">
  <div className="cp__strip">
  <span className="cp__strip-label" id="cp-h">
  <Radar size={14} aria-hidden="true" />
  <h2 className="cp__strip-heading">Live collector</h2>
  </span>
  <span className="cp__strip-stat">
  <b>{compact(pipeline.collectorActive)}</b> / {compact(pipeline.collectorMax)} IRC slots
  </span>
  <span className="cp__strip-stat">
  Top-{pipeline.topN} live <b>{compact(pipeline.roster.live)}</b>
  </span>
  <span className="cp__strip-stat">
  Chat tracked (IRC) <b>{compact(pipeline.roster.collecting)}</b>
  </span>
  <span className="cp__strip-stat">
  Uncovered <b>{compact(pipeline.roster.liveCollectorDeficitRows)}</b>
  </span>
  <span className={pipelineTone ? `cp__src is-${pipelineTone}` : 'cp__src'}>{pipeline.state}</span>
  </div>
  {!loading && pipelineProblem ? (
  <p className={`cp__note is-${pipelineTone ?? 'warn'}`} role="alert">
  {issueParts.length > 0 ? issueParts.join(' - ') : `Collector health is ${pipeline.state}.`}
  </p>
  ) : null}
  </section>
  )
  }

  return (
  <section className="cp" aria-labelledby="cp-h">
  <div className="cp__head">
  <div className="cp__head-l">
  <h2 id="cp-h">Live collector readiness</h2>
  <span className="cp__desc">
  Top-{pipeline.topN} tracker - Source: hosted API + live IRC collector plane - aggregate, sanitized
  </span>
  </div>
  <span className={pipelineTone ? `cp__src is-${pipelineTone}` : 'cp__src'}>
  {pipelineProblem ? pipeline.state : 'Backend source of truth'}
  </span>
  </div>

  {loading ? (
  <Skeleton height={188} radius="calc(var(--radius) + 0.35rem)" />
  ) : (
  <div className="cp__grid cp__grid--single">
  <article className="cp__card cp__card--tracker" aria-label={`Top-${pipeline.topN} live metadata tracker`}>
  <div className="cp__card-top">
  <span className="cp__ic" style={{ background: 'hsl(var(--chart-1) / 0.16)', color: 'hsl(var(--chart-1))' }}>
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
  <i style={{ width: `${collectorPct}%`, background: 'hsl(var(--chart-1))' }} />
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
  </div>
  )}

  {!loading && pipelineProblem ? (
  <p className={`cp__note is-${pipelineTone ?? 'warn'}`} role="alert">
  <Database size={13} aria-hidden="true" />
  Collector health is {pipeline.state}: {issueParts.length > 0 ? issueParts.join(' - ') : 'backend reported degraded state'}.
  </p>
  ) : !loading && !hasData ? (
  <p className="cp__note" role="note">
  <Database size={13} aria-hidden="true" />
  No StreamPulse live data before tracking began. Collector counts populate when IRC + Helix tracking is active on this backend.
  </p>
  ) : null}
  </section>
  )
}
