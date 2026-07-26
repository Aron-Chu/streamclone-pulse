import { useMemo, useState } from 'react'
import { Activity, Database, TrendingUp } from 'lucide-react'
import {
  HUB_TOP_MOVERS_CAP,
  type HubCorpusPipeline,
  type HubEmote,
  type HubEmoteIntel,
  type HubMover,
} from '../../../lib/publicHub'
import {
  emoteMarketModuleAvailable,
  type EmoteMarketView,
  type HubEmoteMarket,
} from '../../../lib/emoteMarketContract'
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
  /** Backend-owned market breadth/rotation — modules gate when absent. */
  emoteMarket?: HubEmoteMarket | null
}

const MARKET_VIEWS: Array<{ key: EmoteMarketView; label: string }> = [
  { key: 'leaders', label: 'Leaders' },
  { key: 'breadth', label: 'Breadth' },
  { key: 'concentration', label: 'Concentration' },
  { key: 'rotation', label: 'Rotation' },
  { key: 'provider', label: 'Provider regime' },
]

export function FigmaEmoteSignalBlock({
  intel,
  topEmotes = [],
  topMovers = [],
  loading,
  corpusPipeline,
  poolSize,
  windowMinutes,
  emoteMarket = null,
}: FigmaEmoteSignalBlockProps) {
  const labels = useCommandCenterLabels()
  const [view, setView] = useState<EmoteMarketView>('leaders')

  const seventvProvider = intel.providerShares.find(
    (row) =>
      row.provider.toLowerCase().includes('7tv') || row.provider.toLowerCase() === 'seventv',
  )
  const seventvShare =
    intel.seventvSharePct > 0
      ? `${Math.round(intel.seventvSharePct)}%`
      : seventvProvider?.sharePct
        ? `${Math.round(seventvProvider.sharePct)}%`
        : '-'

  const leadingShare = formatLeadingEmoteShare(topEmotes, intel.topEmoteSharePct)

  const concentration = useMemo(() => {
    if (emoteMarket?.concentration) return emoteMarket.concentration
    const top1 = topEmotes[0]?.sharePct
    const top5 = topEmotes.slice(0, 5).reduce((sum, e) => sum + (e.sharePct ?? 0), 0)
    const top10 = topEmotes.slice(0, 10).reduce((sum, e) => sum + (e.sharePct ?? 0), 0)
    return {
      top1SharePct: top1,
      top5SharePct: top5 || undefined,
      top10SharePct: top10 || undefined,
    }
  }, [emoteMarket?.concentration, topEmotes])

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

  const viewAvailable = emoteMarketModuleAvailable(emoteMarket, view)

  return (
    <section className="figma-block emote-market" aria-labelledby="figma-emote-signal-title">
      <div className="figma-block__head">
        <h2 id="figma-emote-signal-title" className="figma-block__title">
          {labels.emoteSignal}
        </h2>
        <p className="figma-block__sub">
          Answers which reactions are leading, concentrating, or (when the hub ships market
          fields) spreading and rotating — separate from Pulse Moments investigation.
          Leaders and concentration use current hub rollups; breadth/rotation stay honest
          empty until backend aggregations exist.
          {corpusPipeline ? (
            <>
              {' '}
              Live tracking:{' '}
              {loading
                ? '…'
                : `${compact(corpusPipeline.collectorActive)} / ${compact(corpusPipeline.collectorMax)} channels · ${corpusPipeline.state}`}
              .
            </>
          ) : null}
        </p>
      </div>

      <div className="emote-market__views" role="tablist" aria-label="Emote Market views">
        {MARKET_VIEWS.map((tab) => {
          const available = emoteMarketModuleAvailable(emoteMarket, tab.key)
          const pending = !available && (tab.key === 'breadth' || tab.key === 'rotation')
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={view === tab.key}
              className={`emote-market__view-tab${view === tab.key ? ' is-active' : ''}${
                pending ? ' emote-market__view-tab--pending' : ''
              }`}
              onClick={() => setView(tab.key)}
            >
              {tab.label}
              {pending ? <span className="emote-market__view-hint"> · soon</span> : null}
            </button>
          )
        })}
      </div>

      <div className="figma-kpi-grid figma-kpi-grid--5">
        {kpis.map(({ label, value, sub, color, title }) => (
          <div key={label} className="figma-kpi" title={title}>
            <div className="figma-kpi__lbl">{label}</div>
            <div className="figma-kpi__val" style={{ color }}>
              {loading ? '...' : value}
            </div>
            <div className="figma-kpi__sub">{sub}</div>
          </div>
        ))}
      </div>

      {view === 'leaders' ? (
        <div className="figma-economy-grid figma-economy-grid--padded">
          <div className="figma-panel">
            <div className="figma-panel__head">
              <span className="figma-panel__head-label">
                <TrendingUp size={11} /> Top movers
              </span>
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
          <div className="figma-panel">
            <div className="figma-panel__head">
              <span className="figma-panel__head-label">
                <Activity size={11} /> Leading emotes
              </span>
              <span className="figma-panel__head-meta figma-panel__head-meta--scope">
                aggregate counts · this window
              </span>
            </div>
            <div className="hubx figma-economy-embed">
              <EmoteEconomyPanel intel={intel} topEmotes={topEmotes} loading={loading} />
            </div>
          </div>
        </div>
      ) : null}

      {view === 'provider' ? (
        <div className="figma-economy-grid figma-economy-grid--padded">
          <div className="figma-panel figma-panel--scope-provider emote-market__panel">
            <div className="figma-panel__head">
              <span className="figma-panel__head-label">
                <Activity size={11} /> Provider regime
              </span>
              <span className="figma-panel__head-meta figma-panel__head-meta--scope">
                7TV / Twitch / BTTV / FFZ mix from backend rollups
              </span>
            </div>
            {intel.providerShares.length === 0 && !loading ? (
              <p className="emote-market__gated" role="status">
                <Database size={14} aria-hidden="true" />
                <span>
                  Provider hourly rollups are not in this hub snapshot yet. KPI 7TV share above
                  may still show from aggregate fields; the donut needs `emoteIntel.providerShares`.
                </span>
              </p>
            ) : null}
            <div className="hubx figma-economy-embed">
              <EmoteEconomyPanel intel={intel} topEmotes={topEmotes} loading={loading} />
            </div>
          </div>
        </div>
      ) : null}

      {view === 'concentration' ? (
        <div className="emote-market__panel emote-market__concentration" role="status">
          <div className="emote-market__stat">
            <span className="emote-market__stat-lbl">Top 1 share</span>
            <strong>
              {concentration.top1SharePct != null
                ? `${Math.round(concentration.top1SharePct)}%`
                : '—'}
            </strong>
          </div>
          <div className="emote-market__stat">
            <span className="emote-market__stat-lbl">Top 5 share</span>
            <strong>
              {concentration.top5SharePct != null
                ? `${Math.round(concentration.top5SharePct)}%`
                : '—'}
            </strong>
          </div>
          <div className="emote-market__stat">
            <span className="emote-market__stat-lbl">Top 10 share</span>
            <strong>
              {concentration.top10SharePct != null
                ? `${Math.round(concentration.top10SharePct)}%`
                : '—'}
            </strong>
          </div>
          {emoteMarket?.watermark ? (
            <p className="emote-market__watermark muted">
              Measured {emoteMarket.watermark.measuredAt}
              {emoteMarket.watermark.activityWindow
                ? ` · ${emoteMarket.watermark.activityWindow}`
                : ''}
            </p>
          ) : (
            <p className="emote-market__watermark muted">
              Concentration from current hub top-emote shares (bounded payload).
            </p>
          )}
        </div>
      ) : null}

      {(view === 'breadth' || view === 'rotation') && !viewAvailable ? (
        <div className="emote-market__gated" role="status">
          <Database size={14} aria-hidden="true" />
          <span>
            {view === 'breadth'
              ? 'Cross-channel breadth needs a sanitized backend aggregation with range watermark.'
              : 'Equal-window rotation needs backend rank deltas — not client poll history.'}
          </span>
        </div>
      ) : null}

      {view === 'breadth' && viewAvailable && emoteMarket?.breadth ? (
        <div className="emote-market__table-wrap">
          <table className="emote-market__table">
            <thead>
              <tr>
                <th scope="col">Emote</th>
                <th scope="col">Provider</th>
                <th scope="col">Channel share</th>
                <th scope="col">Channels</th>
              </tr>
            </thead>
            <tbody>
              {emoteMarket.breadth.map((row) => (
                <tr key={`${row.name}-${row.provider ?? ''}`}>
                  <td>{row.name}</td>
                  <td>{row.provider ?? '—'}</td>
                  <td>{Math.round(row.channelSharePct)}%</td>
                  <td>
                    {compact(row.channelCount)} / {compact(row.measuredChannels)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {view === 'rotation' && viewAvailable && emoteMarket?.rotation ? (
        <div className="emote-market__table-wrap">
          <table className="emote-market__table">
            <thead>
              <tr>
                <th scope="col">Emote</th>
                <th scope="col">Rank</th>
                <th scope="col">Δ</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {emoteMarket.rotation.map((row) => (
                <tr key={`${row.name}-${row.provider ?? ''}-${row.rank}`}>
                  <td>{row.name}</td>
                  <td>{row.rank}</td>
                  <td>
                    {row.rankDelta != null
                      ? row.rankDelta > 0
                        ? `+${row.rankDelta}`
                        : String(row.rankDelta)
                      : '—'}
                  </td>
                  <td>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
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
    pipeline.collectorMax > 0
      ? Math.min(100, Math.round((pipeline.collectorActive / pipeline.collectorMax) * 100))
      : 0
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
        <p className="figma-block__sub">
          Top {pipeline.topN} channels by viewers — live tracking capacity (aggregate, sanitized)
        </p>
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
            <span className="muted figma-collector__metric-denom">
              {' '}
              / {pipeline.collectorMax} collector slots
            </span>
          </div>
          <div className="figma-collector__progress">
            <div className="figma-collector__progress-fill" style={{ width: `${collectorPct}%` }} />
          </div>
          <div className="figma-collector__stats">
            {[
              { l: 'Live', v: pipeline.roster.live },
              { l: 'Chat tracked (IRC)', v: pipeline.roster.collecting },
              { l: 'Metadata only — no chat coverage', v: pipeline.roster.metadataOnly },
              { l: 'Stale metadata', v: pipeline.roster.metadataStale, warn: true },
            ].map(({ l, v, warn }) => (
              <div key={l} className="figma-collector__stat-row">
                <span className="muted">{l}</span>
                <span className={warn ? 'figma-collector__stat-warn' : 'figma-collector__stat-value'}>
                  {compact(v)}
                </span>
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
