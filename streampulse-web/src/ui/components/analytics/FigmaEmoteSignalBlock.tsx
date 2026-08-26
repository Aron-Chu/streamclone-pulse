import { useEffect, useMemo, useState } from 'react'
import { Activity, Database, TrendingUp } from 'lucide-react'
import {
  HUB_TOP_MOVERS_CAP,
  type HubCorpusPipeline,
  type HubEmote,
  type HubEmoteIntel,
  type HubMover,
  type HubRisingChannel,
} from '../../../lib/publicHub'
import {
  emoteMarketModuleAvailable,
  type EmoteMarketView,
  type HubEmoteMarket,
} from '../../../lib/emoteMarketContract'
import { EmoteEconomyPanel, TopMoversList } from '../hub'
import '../hub/hub.css'
import { compact, displayName, formatLeadingEmoteShare } from './hubFormat'
import { useCommandCenterLabels } from '../../providers/AnalyticsThemeProvider'
import { MarketPanelFrame, PairedRateBars } from './AnalyticsTruthPrimitives'
import { EMOTE_MARKET_PREVIEW_FIXTURE } from '../../../dev/fixtures/emoteMarketPreview'
import { activateRovingTab } from './rovingTabs'

export interface FigmaEmoteSignalBlockProps {
  intel: HubEmoteIntel
  topEmotes?: HubEmote[]
  topMovers?: HubMover[]
  risingChannels?: HubRisingChannel[]
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

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const midpoint = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2
}

function RisingChannelsPanel({ rows, loading }: { rows?: HubRisingChannel[]; loading?: boolean }) {
  if (loading && rows == null) return <MarketPanelFrame title="Rising channels" state="loading" />
  if (rows == null) return null
  const visible = rows.slice(0, HUB_TOP_MOVERS_CAP)
  const medianLift = median(visible.map((row) => row.comparison.absoluteDeltaPerMin ?? 0))
  return (
    <MarketPanelFrame
      title="Rising channels"
      state={visible.length > 0 ? 'ready' : 'empty'}
      description="No channels have a qualified positive emote lift in this window."
    >
      <div className="emote-market__rising-head">
        <span>{visible.length} qualifying channel{visible.length === 1 ? '' : 's'}</span>
        {medianLift != null ? <strong>Median lift +{compact(medianLift)}/min</strong> : null}
      </div>
      <ol className="emote-market__rising-list">
        {visible.map((row) => (
          <li key={`${row.login}-${row.measuredAt}`}>
            <div className="emote-market__rising-name">
              <strong>{displayName(row.login, row.displayName)}</strong>
              <span>{row.category || `${compact(row.viewers)} viewers`}</span>
            </div>
            <PairedRateBars
              current={row.comparison.currentPerMin}
              baseline={row.comparison.baselinePerMin}
              currentLabel="Latest 5 min"
              baselineLabel="Stream average"
              tone="emotes"
              compact
            />
          </li>
        ))}
      </ol>
    </MarketPanelFrame>
  )
}

export function FigmaEmoteSignalBlock({
  intel,
  topEmotes = [],
  topMovers = [],
  risingChannels,
  loading,
  corpusPipeline,
  poolSize,
  windowMinutes,
  emoteMarket = null,
}: FigmaEmoteSignalBlockProps) {
  const labels = useCommandCenterLabels()
  const [view, setView] = useState<EmoteMarketView>('leaders')
  const fixtureEnabled =
    (import.meta.env.DEV || import.meta.env.MODE === 'test') &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('marketPreview') === 'fixture'
  const preview = fixtureEnabled ? EMOTE_MARKET_PREVIEW_FIXTURE : null

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

  const availableViews = useMemo(
    () => MARKET_VIEWS.filter((tab) => {
      if (preview) return true
      if (tab.key === 'leaders' || tab.key === 'concentration') return true
      if (tab.key === 'provider') return intel.providerShares.length > 0
      return emoteMarketModuleAvailable(emoteMarket, tab.key)
    }),
    [emoteMarket, intel.providerShares.length, preview],
  )

  useEffect(() => {
    if (!availableViews.some((tab) => tab.key === view)) setView('leaders')
  }, [availableViews, view])

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
        {availableViews.map((tab) => {
          return (
            <button
              key={tab.key}
              id={`emote-market-tab-${tab.key}`}
              aria-controls="emote-market-panel"
              type="button"
              role="tab"
              aria-selected={view === tab.key}
              tabIndex={view === tab.key ? 0 : -1}
              className={`emote-market__view-tab${view === tab.key ? ' is-active' : ''}`}
              onClick={() => setView(tab.key)}
              onKeyDown={activateRovingTab}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {preview ? (
        <p className="emote-market__fixture-note" role="status">
          Internal deterministic design preview · not live analytics · generated {preview.generatedAt}
        </p>
      ) : null}

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

      <div id="emote-market-panel" role="tabpanel" aria-labelledby={`emote-market-tab-${view}`} className="emote-market__tabpanel">

      {view === 'leaders' ? (
        <div className="figma-economy-grid figma-economy-grid--padded">
          {risingChannels !== undefined ? (
            <RisingChannelsPanel rows={risingChannels} loading={loading} />
          ) : (
            <div className="figma-panel">
              <div className="figma-panel__head">
                <span className="figma-panel__head-label">
                  <TrendingUp size={11} /> Highest emote rate
                </span>
                <span className="figma-panel__head-meta figma-panel__head-meta--scope">
                  current rate · not movement
                </span>
              </div>
              <p className="emote-market__legacy-note">
                Qualified rising-channel comparisons are not in this payload. These rows are the highest current emote rates, not change over time.
              </p>
              <div className="hubx figma-economy-embed">
                <TopMoversList
                  movers={topMovers}
                  maxRows={HUB_TOP_MOVERS_CAP}
                  loading={loading}
                  honesty={corpusPipeline ? {
                    rosterLive: corpusPipeline.roster.live,
                    collectorTracking: corpusPipeline.roster.collectorTracking,
                    poolSize,
                    windowMinutes,
                  } : undefined}
                />
              </div>
            </div>
          )}
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
        preview ? (
          <div className="emote-market__preview-grid">
            <MarketPanelFrame title="Provider regime" state="ready">
              <div className="emote-market__provider-compare">
                {preview.providers.map((provider) => (
                  <div key={provider.provider}>
                    <strong>{provider.provider}</strong>
                    <PairedRateBars
                      current={provider.currentSharePct}
                      baseline={provider.previousSharePct}
                      currentLabel={preview.currentWindow.label}
                      baselineLabel={preview.comparisonWindow.label}
                      unit="%"
                      compact
                    />
                  </div>
                ))}
              </div>
            </MarketPanelFrame>
          </div>
        ) : (
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
        )
      ) : null}

      {view === 'concentration' ? (
        preview ? (
          <div className="emote-market__preview-grid">
            <MarketPanelFrame title="Reaction concentration" state="ready">
              <div className="emote-market__stack" role="img" aria-label={preview.concentration.map((segment) => `${segment.label} ${segment.sharePct}%`).join(', ')}>
                {preview.concentration.map((segment) => <i key={segment.label} style={{ width: `${segment.sharePct}%`, background: segment.color }} />)}
              </div>
              <div className="emote-market__legend">
                {preview.concentration.map((segment) => <span key={segment.label}>{segment.label} {segment.sharePct}%</span>)}
              </div>
            </MarketPanelFrame>
          </div>
        ) : (
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
        )
      ) : null}

      {view === 'breadth' && (preview?.breadth || emoteMarket?.breadth) ? (
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
              {(preview?.breadth ?? emoteMarket?.breadth ?? []).map((row) => (
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

      {view === 'rotation' && (preview?.rotation || emoteMarket?.rotation) ? (
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
              {(preview?.rotation ?? emoteMarket?.rotation ?? []).map((row) => (
                <tr key={`${row.name}-${row.provider ?? ''}-${'currentRank' in row ? row.currentRank : row.rank}`}>
                  <td>{row.name}</td>
                  <td>{'currentRank' in row ? row.currentRank : row.rank}</td>
                  <td>
                    {'currentRank' in row
                      ? row.previousRank != null
                        ? `${row.previousRank} → ${row.currentRank}`
                        : 'New'
                      : row.rankDelta != null
                        ? row.rankDelta > 0 ? `+${row.rankDelta}` : String(row.rankDelta)
                        : '—'}
                  </td>
                  <td>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
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
