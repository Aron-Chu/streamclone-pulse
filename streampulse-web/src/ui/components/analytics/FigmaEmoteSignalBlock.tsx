import { Activity, Database, TrendingUp } from 'lucide-react'
import {
  HUB_TOP_MOVERS_CAP,
  type HubCorpusPipeline,
  type HubEmote,
  type HubEmoteIntel,
  type HubMover,
} from '../../../lib/publicHub'
import { EmoteEconomyPanel, TopMoversList } from '../hub'
import '../hub/hub.css'
import { compact, formatLeadingEmoteShare } from './hubFormat'
import { useCommandCenterLabels } from '../../providers/AnalyticsThemeProvider'

export interface FigmaEmoteSignalBlockProps {
  intel: HubEmoteIntel
  topEmotes?: HubEmote[]
  topMovers?: HubMover[]
  loading?: boolean
  corpusPipeline?: HubCorpusPipeline
  poolSize?: number
  windowMinutes?: number
}

export function FigmaEmoteSignalBlock({
  intel,
  topEmotes = [],
  topMovers = [],
  loading,
  corpusPipeline,
  poolSize,
  windowMinutes,
}: FigmaEmoteSignalBlockProps) {
  const labels = useCommandCenterLabels()
  const seventvProvider = intel.providerShares.find(
  (row) => row.provider.toLowerCase().includes('7tv') || row.provider.toLowerCase() === 'seventv',
  )
  const seventvShare =
  intel.seventvSharePct > 0
  ? `${Math.round(intel.seventvSharePct)}%`
  : seventvProvider?.sharePct
  ? `${Math.round(seventvProvider.sharePct)}%`
  : '-'

  const leadingShare = formatLeadingEmoteShare(topEmotes, intel.topEmoteSharePct)

  const kpis = [
  {
  label: 'Emotes / min (global)',
  value: intel.emotesPerMin > 0 ? compact(intel.emotesPerMin) : '-',
  sub: 'across live rooms in this window',
  color: 'var(--fma-accent-text)',
  title: undefined as string | undefined,
  },
  {
  label: leadingShare.label,
  value: leadingShare.value,
  sub: leadingShare.sub,
  color: 'var(--fma-cyan)',
  title: leadingShare.title,
  },
  {
  label: '7TV share',
  value: seventvShare,
  sub: 'Provider mix from backend rollups',
  color: 'var(--fma-green)',
  title: undefined as string | undefined,
  },
  {
  label: 'Unique emotes used',
  value: intel.uniqueEmotes > 0 ? compact(intel.uniqueEmotes) : '-',
  sub: 'Distinct codes seen in this window',
  color: 'var(--fma-amber)',
  title: undefined as string | undefined,
  },
  {
  label: 'Biggest peak today',
  value: intel.biggestPeakPerMin > 0 ? compact(intel.biggestPeakPerMin) : '-',
  sub: 'Highest chat/min in this window',
  color: 'var(--fma-red)',
  title: undefined as string | undefined,
  },
  ]

  return (
  <section className="figma-block" aria-labelledby="figma-emote-signal-title">
  <div className="figma-block__head">
  <h2 id="figma-emote-signal-title" className="figma-block__title">{labels.emoteSignal}</h2>
  <p className="figma-block__sub">
  Provider mix and dominance from backend rollup emote counts — not client-side scoring.
  Only channels with live tracking can appear in Pulse Moments.
  {corpusPipeline ? (
    <> Live tracking: {loading ? '…' : `${compact(corpusPipeline.collectorActive)} / ${compact(corpusPipeline.collectorMax)} channels · ${corpusPipeline.state}`}.</>
  ) : null}
  </p>
  </div>
  <div className="figma-kpi-grid figma-kpi-grid--5">
  {kpis.map(({ label, value, sub, color, title }) => (
  <div key={label} className="figma-kpi" title={title}>
  <div className="figma-kpi__lbl">{label}</div>
  <div className="figma-kpi__val" style={{ color }}>{loading ? '...' : value}</div>
  <div className="figma-kpi__sub">{sub}</div>
  </div>
  ))}
  </div>
  <div className="figma-economy-grid figma-economy-grid--padded">
  <div className="figma-panel figma-panel--scope-provider">
  <div className="figma-panel__head">
  <span className="figma-panel__head-label"><Activity size={11} /> Emote economy</span>
  <span className="figma-panel__head-meta figma-panel__head-meta--scope">
  provider mix · across tracked channels
  </span>
  </div>
  <div className="hubx figma-economy-embed">
  <EmoteEconomyPanel intel={intel} topEmotes={topEmotes} loading={loading} />
  </div>
  </div>
  <div className="figma-panel">
  <div className="figma-panel__head">
  <span className="figma-panel__head-label"><TrendingUp size={11} /> Top movers</span>
  <span className="figma-panel__head-meta figma-panel__head-meta--scope">
  emote velocity · within IRC-tracked live channels
  </span>
  </div>
  <div className="hubx figma-economy-embed">
  <TopMoversList
    movers={topMovers}
    maxRows={HUB_TOP_MOVERS_CAP}
    loading={loading}
    honesty={
      corpusPipeline
        ? {
            rosterLive: corpusPipeline.roster.live,
            collectorTracking: corpusPipeline.roster.collectorTracking,
            poolSize,
            windowMinutes,
          }
        : undefined
    }
  />
  </div>
  </div>
  </div>
  </section>
  )
}

export interface FigmaLiveCollectorBlockProps {
  pipeline: HubCorpusPipeline
  loading?: boolean
}

/** Live collector readiness - no duplicate moments feed. */
export function FigmaCorpusPipelineBlock({ pipeline, loading }: FigmaLiveCollectorBlockProps) {
  const collectorPct =
  pipeline.collectorMax > 0 ? Math.min(100, Math.round((pipeline.collectorActive / pipeline.collectorMax) * 100)) : 0
  const critical = pipeline.state === 'critical' || pipeline.state === 'degraded'

  return (
  <section className="figma-block" aria-labelledby="figma-live-collector-title">
  <div className="figma-block__head">
  <h2 id="figma-live-collector-title" className="figma-block__title figma-collector__title">
  Live collector readiness
  {critical ? (
  <span className="figma-collector__state-badge figma-collector__state-badge--critical">
  {pipeline.state.toUpperCase()}
  </span>
  ) : null}
  </h2>
  <p className="figma-block__sub">Top {pipeline.topN} channels by viewers — live tracking capacity (aggregate, sanitized)</p>
  </div>

  <div className="figma-pipeline-grid">
  <div className="figma-pipeline-col">
  <div className="figma-collector__head">
  <div className="figma-collector__icon">
  <Database size={16} color="var(--fma-accent-text)" />
  </div>
  <div>
  <div className="figma-collector__label">Live metadata tracker</div>
  <div className="muted">Top {pipeline.topN} by viewers</div>
  </div>
  </div>
  <div className="figma-collector__metric">
  {loading ? '...' : pipeline.collectorActive}
  <span className="muted figma-collector__metric-denom"> / {pipeline.collectorMax} collector slots</span>
  </div>
  <div className="figma-collector__progress">
  <div className="figma-collector__progress-fill" style={{ width: `${collectorPct}%` }} />
  </div>
  <div className="figma-collector__stats">
  {[
  { l: 'Live', v: pipeline.roster.live },
  { l: 'Collecting chat', v: pipeline.roster.collecting },
  { l: 'Metadata only', v: pipeline.roster.metadataOnly },
  { l: 'Stale metadata', v: pipeline.roster.metadataStale, warn: true },
  ].map(({ l, v, warn }) => (
  <div key={l} className="figma-collector__stat-row">
  <span className="muted">{l}</span>
  <span className={warn ? 'figma-collector__stat-warn' : 'figma-collector__stat-value'}>{compact(v)}</span>
  </div>
  ))}
  </div>
  </div>

  </div>

  {critical ? (
  <div className="figma-pipeline-warn">
  <TrendingUp size={12} aria-hidden="true" />
  {pipeline.roster.admissionFeatureDisabled > 0
    ? 'Live tracking is currently offline - historical corpus data is still available.'
    : `Collector health is ${pipeline.state}: ${compact(pipeline.roster.metadataStale)} stale metadata - ${compact(pipeline.roster.admissionDisabled)} admission off`}
  </div>
  ) : null}
  </section>
  )
}
