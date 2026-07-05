import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { parseDeepLinkOffset } from '@streamclone/analytics-console'
import { Info } from 'lucide-react'
import type { ChannelPageData } from '../../../hooks/useChannelPageData'
import {
  isValidPeakOffsetSeconds,
  nearestMomentForOffset,
  type FigmaEmoteBurst,
} from '../../../lib/figmaSessionAnalytics'
import { CoverageTruthPanel } from './CoverageTruthPanel'
import { FigmaMomentInspector } from './FigmaMomentInspector'
import { FigmaSessionHeaderStrip } from './FigmaSessionHeaderStrip'
import { FigmaSignalChart, type PlottedEmote } from './FigmaSignalChart'
import { MostReactedMinutesTable } from './MostReactedMinutesTable'
import { TopEmoteBurstsPanel } from './TopEmoteBurstsPanel'
import { compact, providerLabel } from './hubFormat'
import { EmoteImg } from './EmoteImg'
import type { PortalStreamSummary } from '../../../lib/streamcloneAnalytics'

function pct(value?: number): string {
  return value && value > 0 ? `${Math.round(value)}%` : '—'
}

function num(value?: number): string {
  return value && value > 0 ? compact(Math.round(value)) : '—'
}

/** Rich session metrics fed by the public /summary endpoint (always available). */
function SessionMetricsPanel({ summary }: { summary: PortalStreamSummary | null }) {
  const m = summary?.metrics
  if (!m) {
    return (
      <section className="figma-panel figma-panel--metrics" aria-label="Session metrics">
        <header><h3>Session metrics</h3></header>
        <p className="muted">Backend summary metrics are not available for this session yet.</p>
      </section>
    )
  }
  const rows: Array<{ label: string; value: string; tone?: string }> = [
    { label: 'Reaction score', value: m.reaction_score_0_100 ? `${Math.round(m.reaction_score_0_100)}/100` : '—', tone: 'accent' },
    { label: '7TV provider share', value: pct(m.provider_share_pct) },
    { label: 'Viewer momentum 5m', value: m.viewer_momentum_5m ? `+${num(m.viewer_momentum_5m)}` : '—' },
    { label: 'Minutes with data', value: m.minutesWithData ? compact(m.minutesWithData) : '—' },
    { label: 'Viewer samples', value: m.viewerSampleCount ? compact(m.viewerSampleCount) : '—' },
    { label: 'Sync health', value: m.sync_health_state ?? '—' },
  ]
  return (
    <section className="figma-panel figma-panel--metrics" aria-label="Session metrics">
      <header><h3>Session metrics</h3></header>
      <dl className="figma-channel-metrics">
        {rows.map((row) => (
          <div key={row.label} className={`figma-channel-metrics__row${row.tone ? ` is-${row.tone}` : ''}`}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function TopEmotesPanel({ summary }: { summary: PortalStreamSummary | null }) {
  const emotes = summary?.topEmotes ?? []
  return (
    <section className="figma-panel figma-panel--bursts" aria-label="Top emotes">
      <header><h3>Top emotes</h3></header>
      {emotes.length === 0 ? (
        <p className="muted">Top emotes appear once the backend records emote rollups for this session.</p>
      ) : (
        <ul className="figma-burst-list figma-burst-list--ranked">
          {emotes.slice(0, 8).map((emote) => (
            <li key={emote.key ?? emote.name}>
              <EmoteImg src={emote.imageUrl} name={emote.name} width={18} height={18} />
              <strong>{emote.name}</strong>
              <span className="figma-burst-list__provider">{providerLabel(emote.provider)}</span>
              <span className="figma-burst-list__count">{compact(emote.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export interface FigmaChannelDashboardProps {
  data: ChannelPageData
}

export function FigmaChannelDashboard({ data }: FigmaChannelDashboardProps) {
  const location = useLocation()
  const [selectedOffset, setSelectedOffset] = useState<number | undefined>(data.session.moments[0]?.offsetSeconds)
  const [plottedEmote, setPlottedEmote] = useState<PlottedEmote | undefined>(undefined)
  const selectedMoment = useMemo(
    () => data.session.moments.find((m) => m.offsetSeconds === selectedOffset) ?? data.session.moments[0] ?? null,
    [data.session.moments, selectedOffset],
  )

  useEffect(() => {
    if (data.loading || data.session.state !== 'ready') return
    const offsetSeconds = parseDeepLinkOffset(location.hash, location.search)
    if (offsetSeconds == null) return
    const nearest = nearestMomentForOffset(data.session.moments, offsetSeconds)
    setSelectedOffset(nearest?.offsetSeconds ?? offsetSeconds)
  }, [data.loading, data.session.moments, data.session.state, location.hash, location.search])

  const handleChartSelectOffset = (offsetSeconds: number) => {
    const nearest = nearestMomentForOffset(data.session.moments, offsetSeconds)
    if (nearest) setSelectedOffset(nearest.offsetSeconds)
  }

  const handleSelectBurst = (burst: FigmaEmoteBurst) => {
    if (!isValidPeakOffsetSeconds(burst.peakOffsetSeconds)) return
    if (plottedEmote?.code === burst.code) {
      setPlottedEmote(undefined)
      return
    }
    setPlottedEmote({
      code: burst.code,
      label: `${burst.code} @ ${burst.peakOffset ?? 'peak'}`,
      peakOffsetSeconds: burst.peakOffsetSeconds,
    })
    const nearest = nearestMomentForOffset(data.session.moments, burst.peakOffsetSeconds)
    setSelectedOffset(nearest?.offsetSeconds ?? burst.peakOffsetSeconds)
  }

  const title = data.displayName?.trim() || data.login
  const sourceLabel = data.session.sourceLabel ?? 'Tracked'
  const hasChart = data.session.chartPoints.length > 0
  const hasMoments = data.session.moments.length > 0

  if (data.loading && data.session.state === 'loading') {
    return <div className="figma-session figma-session--loading" aria-busy="true" />
  }

  if (data.session.state === 'empty' && data.streams.length === 0) {
    return (
      <section className="figma-session" aria-label="Channel analytics">
        <div className="figma-channel-page__head">
          <div>
            <h1 className="figma-channel-page__title">{title}</h1>
            <p className="figma-channel-page__sub muted">No tracked sessions yet</p>
          </div>
        </div>
        <div className="figma-panel">
          <header><h3>No analytics yet</h3></header>
          <p className="muted">
            StreamPulse has no data for this channel yet ({data.session.reason ?? data.error ?? 'no_sessions'}). Analytics
            begin collecting once the channel is tracked by the live collector or a VOD is imported.
          </p>
        </div>
      </section>
    )
  }

  const headerModel = {
    ...data.session,
    displayName: data.displayName ?? data.session.displayName,
    chatPerMin: data.summary?.metrics?.chat_per_min ?? data.session.chatPerMin,
    seventvPerMin: data.summary?.metrics?.seventv_per_min ?? data.session.seventvPerMin,
    dataCoveragePct: data.summary?.metrics?.data_coverage_pct ?? data.session.dataCoveragePct,
    state: 'ready' as const,
  }

  const consoleHref = data.selectedStreamId
    ? `/analytics/${encodeURIComponent(data.login)}/${encodeURIComponent(data.selectedStreamId)}`
    : `/analytics/${encodeURIComponent(data.login)}`

  return (
    <section className="figma-session figma-channel-page" aria-label={`${title} analytics`}>
      <div className="figma-channel-page__head">
        <div>
          <h1 className="figma-channel-page__title">{title}</h1>
          <p className="figma-channel-page__sub muted">
            Source: {sourceLabel}
            {data.session.category ? ` · ${data.session.category}` : ''}
            {data.summary?.metrics?.minutesWithData ? ` · ${compact(data.summary.metrics.minutesWithData)} minutes with data` : ''}
          </p>
        </div>
        <Link className="figma-btn figma-btn--ghost" to={consoleHref}>Full console</Link>
      </div>

      {data.streams.length > 0 ? (
        <div className="figma-session-strip" role="tablist" aria-label="Sessions">
          {data.streams.map((item) => {
            const active = item.streamId === data.selectedStreamId
            return (
              <Link
                key={item.streamId}
                to={item.href}
                className={`figma-session-strip__item${active ? ' is-active' : ''}${item.live ? ' is-live' : ''}`}
                role="tab"
                aria-selected={active}
              >
                <strong>{item.label}</strong>
                <small>{item.sourceLabel}{item.category ? ` · ${item.category}` : ''}</small>
              </Link>
            )
          })}
        </div>
      ) : null}

      <FigmaSessionHeaderStrip model={headerModel} isLive={data.streams.some((s) => s.live && s.streamId === data.selectedStreamId)} />

      {hasChart ? (
        <FigmaSignalChart
          points={data.session.chartPoints}
          selectedOffset={selectedOffset}
          onSelectOffset={handleChartSelectOffset}
          title={data.session.category ? `${title} / ${data.session.category}` : title}
          note="Multi-signal chart from backend minute rollups — chat, viewers, emotes."
          plottedEmote={plottedEmote}
          onClearPlottedEmote={() => setPlottedEmote(undefined)}
        />
      ) : (
        <div className="figma-channel-notice" role="note">
          <Info size={14} aria-hidden="true" />
          <span>
            The minute-by-minute chart needs the timeline rollups, which aren’t available for this session on this backend.
            Aggregate metrics below are live from the backend summary. Open the <Link to={consoleHref}>full console</Link> for the raw timeline.
          </span>
        </div>
      )}

      <div className="figma-channel-grid">
        <div className="figma-session__grid-col">
          <SessionMetricsPanel summary={data.summary} />
          <CoverageTruthPanel rows={data.session.coverageTruth} />
        </div>
        <div className="figma-session__grid-col">
          <MostReactedMinutesTable
            moments={data.session.moments}
            selectedOffset={selectedOffset}
            onSelect={(moment) => setSelectedOffset(moment.offsetSeconds)}
            vodId={data.session.vodId}
            plottedEmoteCode={plottedEmote?.code}
          />
        </div>
        <div className="figma-session__grid-col">
          {hasMoments ? (
            <FigmaMomentInspector
              moment={selectedMoment}
              vodId={data.session.vodId}
              sessionHref={data.session.sessionHref}
            />
          ) : null}
          {data.session.bursts.length > 0 ? (
            <TopEmoteBurstsPanel
              bursts={data.session.bursts}
              selectedCode={plottedEmote?.code}
              onSelectBurst={handleSelectBurst}
            />
          ) : (
            <TopEmotesPanel summary={data.summary} />
          )}
        </div>
      </div>
    </section>
  )
}
