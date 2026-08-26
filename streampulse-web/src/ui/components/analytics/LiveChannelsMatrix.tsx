import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Radio, Search } from 'lucide-react'
import type { HubLiveChannel } from '../../../lib/publicHub'
import { buildAnalyticsHref } from '../../../lib/analyticsLinks'
import {
  isScreenerV1,
  screenerViewLabel,
  type ChannelScreenerView,
  type HubChannelScreenerLegacy,
  type HubChannelScreenerV1,
} from '../../../lib/channelScreenerContract'
import { Skeleton } from '../../primitives'
import { LIVE_CHANNELS_MATRIX_COMPACT_QUERY, useMatchMedia } from '../../hooks/useMatchMedia'
import { compact, coverageMeta, displayName, initial } from './hubFormat'
import { StreamTogetherBadge, channelCategoryLabel } from './StreamTogetherBadge'
import { useCommandCenterLabels } from '../../providers/AnalyticsThemeProvider'
import { ResilientImage } from '../ResilientImage'
import {
  EvidenceSummary,
  MetricComparison,
  MetricStateBadge,
} from './AnalyticsTruthPrimitives'
import { activateRovingTab } from './rovingTabs'

export interface LiveChannelsMatrixProps {
  channels: HubLiveChannel[]
  loading?: boolean
  updatedAgo?: string
  maxRows?: number
  poolSize?: number
  ircActive?: number
  rosterLive?: number
}

type MatrixFilterKey = 'all' | 'chat' | 'warming' | 'metadata'
type MatrixSortKey = 'viewers' | 'chatPerMin' | 'emotesPerMin'

const SCREENER_VIEWS: ChannelScreenerView[] = ['overview', 'momentum', 'coverage', 'anomalies']

function legacyScreener(channel: HubLiveChannel): HubChannelScreenerLegacy | null {
  return channel.screener && !isScreenerV1(channel.screener) ? channel.screener : null
}

function v1Screener(channel: HubLiveChannel): HubChannelScreenerV1 | null {
  return isScreenerV1(channel.screener) ? channel.screener : null
}

function channelEmotesPerMin(channel: HubLiveChannel): number {
  return Math.max(channel.emotesPerMin ?? 0, channel.seventvPerMin ?? 0)
}

function filterOf(state: HubLiveChannel['coverageState']): MatrixFilterKey {
  const tone = coverageMeta(state).tone
  if (tone === 'warming') return 'warming'
  if (tone === 'synced' || tone === 'collecting' || tone === 'chat' || tone === 'partial') return 'chat'
  return 'metadata'
}

function rowHref(channel: HubLiveChannel): string {
  return buildAnalyticsHref({ login: channel.login, streamId: channel.streamId, context: 'channel-row' })
}

function rowAriaLabel(channel: HubLiveChannel): string {
  const name = displayName(channel.login, channel.displayName)
  const coverage = coverageMeta(channel.coverageState).label
  const truth = v1Screener(channel)
  return `Open analytics for ${name}, ${compact(channel.viewers)} viewers, ${coverage} coverage${truth ? `, ${truth.state} activity comparison` : ''}`
}

function hasBackendAnomaly(channel: HubLiveChannel): boolean {
  const legacy = legacyScreener(channel)
  return Boolean(legacy?.anomalyReason?.trim() || legacy?.viewerChatDivergence != null)
}

function hasBackendActivityChange(channel: HubLiveChannel): boolean {
  return v1Screener(channel) != null
}

function legacyAnomaly(channel: HubLiveChannel): string {
  const screener = legacyScreener(channel)
  if (screener?.anomalyReason?.trim()) return screener.anomalyReason.trim()
  return screener?.viewerChatDivergence != null
    ? `Divergence ${screener.viewerChatDivergence.toFixed(1)}`
    : '—'
}

function ActivityTruth({ screener, compact: compactMode }: { screener: HubChannelScreenerV1; compact?: boolean }) {
  return (
    <div className="live-channels-matrix__truth-grid">
      <MetricComparison label="Chat" comparison={screener.chat} tone="chat" compact={compactMode} presentation="percentage" />
      <MetricComparison label="Emotes" comparison={screener.emotes} tone="emotes" compact={compactMode} presentation="multiplier" />
    </div>
  )
}

function ExactEvidence({ screener, defaultOpen }: { screener: HubChannelScreenerV1; defaultOpen?: boolean }) {
  return (
    <EvidenceSummary
      evidence={screener.evidence}
      currentMeasuredMinutes={screener.currentWindow.measuredMinutes}
      currentExpectedMinutes={screener.currentWindow.expectedMinutes}
      baselineMeasuredMinutes={screener.baselineWindow.measuredMinutes}
      baselineExpectedMinutes={screener.baselineWindow.expectedMinutes}
      baselineCoveragePct={screener.baselineWindow.coveragePct}
      defaultOpen={defaultOpen}
      diagnosticReason={screener.reason}
    />
  )
}

interface ChannelMatrixRowProps {
  channel: HubLiveChannel
  href: string
  view: ChannelScreenerView
}

function ChannelIdentity({ channel }: { channel: HubLiveChannel }) {
  const category = channelCategoryLabel(channel.category)
  const legacy = legacyScreener(channel)
  return (
    <span className="live-channels-matrix__channel">
      <span className="live-channels-matrix__avatar" aria-hidden="true">
        <ResilientImage src={channel.profileImageUrl} alt="" loading="lazy" decoding="async" fallback={initial(channel.login)} />
      </span>
      <span className="live-channels-matrix__channel-text">
        <strong>{displayName(channel.login, channel.displayName)}</strong>
        <small title={category}>{category}</small>
        {channel.streamingTogether ? <StreamTogetherBadge channel={channel} /> : null}
        {legacy?.newlyLive ? <span className="live-channels-matrix__pill">Newly live</span> : null}
      </span>
    </span>
  )
}

function ChannelMatrixRow({ channel, href, view }: ChannelMatrixRowProps) {
  const meta = coverageMeta(channel.coverageState)
  const emotesPerMin = channelEmotesPerMin(channel)
  const category = channelCategoryLabel(channel.category)
  const screener = v1Screener(channel)

  return (
    <tr className="live-channels-matrix__row">
      <td>
        <Link className="live-channels-matrix__row-link" to={href} aria-label={rowAriaLabel(channel)}>
          <ChannelIdentity channel={channel} />
        </Link>
      </td>
      <td className="live-channels-matrix__hide-md" title={category}>{category}</td>
      {view === 'overview' ? (
        <>
          <td className="live-channels-matrix__num">{compact(channel.viewers)}</td>
          <td className="live-channels-matrix__num">{channel.chatPerMin > 0 ? compact(Math.round(channel.chatPerMin)) : '—'}</td>
          <td className="live-channels-matrix__num">{emotesPerMin > 0 ? compact(Math.round(emotesPerMin)) : '—'}</td>
          <td>
            {screener ? <MetricStateBadge state={screener.state} reason={screener.reason} /> : <span className="live-channels-matrix__legacy-rate">Recent rates only</span>}
          </td>
        </>
      ) : null}
      {view === 'momentum' ? (
        <td className="live-channels-matrix__truth-cell" colSpan={3}>
          {screener ? <ActivityTruth screener={screener} compact /> : <p className="live-channels-matrix__legacy-rate">Activity comparison unavailable. Current rates remain visible in Overview; no browser-derived change is shown.</p>}
        </td>
      ) : null}
      {view === 'coverage' ? (
        <td className="live-channels-matrix__evidence-cell" colSpan={3}>
          {screener ? <ExactEvidence screener={screener} defaultOpen /> : (
            <div>
              <span className={`live-channels-matrix__coverage-label live-channels-matrix__coverage-label--${meta.tone}`}>{meta.label}</span>
              <small className="live-channels-matrix__legacy-rate">Backend summary only · exact minute evidence unavailable</small>
            </div>
          )}
        </td>
      ) : null}
      {view === 'anomalies' ? <td className="live-channels-matrix__anomaly" colSpan={3}>{legacyAnomaly(channel)}</td> : null}
    </tr>
  )
}

function ChannelMatrixCard({ channel, href, view }: ChannelMatrixRowProps) {
  const meta = coverageMeta(channel.coverageState)
  const emotesPerMin = channelEmotesPerMin(channel)
  const screener = v1Screener(channel)
  return (
    <article className="live-channels-matrix__card">
      <Link to={href} className="live-channels-matrix__card-main-link" aria-label={rowAriaLabel(channel)}>
        <ChannelIdentity channel={channel} />
        <span className="live-channels-matrix__card-stats">
          <span>{compact(channel.viewers)} viewers</span>
          <span>{channel.chatPerMin > 0 ? `${compact(Math.round(channel.chatPerMin))}/m chat` : '— chat'}</span>
          <span>{emotesPerMin > 0 ? `${compact(Math.round(emotesPerMin))}/m emotes` : '— emotes'}</span>
        </span>
      </Link>
      {view === 'overview' ? (
        <div className="live-channels-matrix__card-side">
          <span className={`live-channels-matrix__coverage-label live-channels-matrix__coverage-label--${meta.tone}`}>{meta.label}</span>
          {screener ? <MetricStateBadge state={screener.state} reason={screener.reason} /> : <span className="live-channels-matrix__legacy-rate">Recent rates only</span>}
        </div>
      ) : null}
      {view === 'momentum' ? (
        <div className="live-channels-matrix__card-truth">
          {screener ? <ActivityTruth screener={screener} compact /> : <p className="live-channels-matrix__legacy-rate">Activity comparison unavailable; no browser-derived value is shown.</p>}
        </div>
      ) : null}
      {view === 'coverage' ? (
        <div className="live-channels-matrix__card-evidence">
          {screener ? <ExactEvidence screener={screener} /> : <span className="live-channels-matrix__legacy-rate">{meta.label} summary · exact minute evidence unavailable</span>}
        </div>
      ) : null}
      {view === 'anomalies' ? <p className="live-channels-matrix__card-anomaly">{legacyAnomaly(channel)}</p> : null}
    </article>
  )
}

export function LiveChannelsMatrix({
  channels,
  loading = false,
  updatedAgo,
  maxRows = 20,
  poolSize,
  ircActive,
  rosterLive,
}: LiveChannelsMatrixProps) {
  const compactLayout = useMatchMedia(LIVE_CHANNELS_MATRIX_COMPACT_QUERY)
  const labels = useCommandCenterLabels()
  const [view, setView] = useState<ChannelScreenerView>('overview')
  const [filter, setFilter] = useState<MatrixFilterKey>('all')
  const [sortKey, setSortKey] = useState<MatrixSortKey>('viewers')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)

  const toggleSort = (key: MatrixSortKey) => {
    if (key === sortKey) setSortDir((dir) => dir === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const counts = useMemo(() => {
    const result: Record<MatrixFilterKey, number> = { all: channels.length, chat: 0, warming: 0, metadata: 0 }
    for (const channel of channels) result[filterOf(channel.coverageState)] += 1
    return result
  }, [channels])

  const backendActivityAvailable = useMemo(() => channels.some(hasBackendActivityChange), [channels])
  const backendAnomaliesAvailable = useMemo(() => channels.some(hasBackendAnomaly), [channels])

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = channels.filter((channel) => {
      if (view === 'anomalies' && backendAnomaliesAvailable && !hasBackendAnomaly(channel)) return false
      if (filter !== 'all' && filterOf(channel.coverageState) !== filter) return false
      if (!q) return true
      const name = displayName(channel.login, channel.displayName).toLowerCase()
      return channel.login.toLowerCase().includes(q) || name.includes(q) || (channel.category ?? '').toLowerCase().includes(q)
    })
    const value = (channel: HubLiveChannel) => sortKey === 'emotesPerMin' ? channelEmotesPerMin(channel) : channel[sortKey]
    const dir = sortDir === 'desc' ? 1 : -1
    return [...filtered].sort((a, b) => (value(b) - value(a)) * dir)
  }, [backendAnomaliesAvailable, channels, filter, query, sortKey, sortDir, view])

  const rows = expanded ? sorted : sorted.slice(0, maxRows)
  const hiddenCount = sorted.length - rows.length
  const tabs: Array<{ key: MatrixFilterKey; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'chat', label: 'Chat tracked (IRC)' },
    { key: 'warming', label: 'Warming' },
    { key: 'metadata', label: 'Metadata only — no chat coverage' },
  ]

  const sortHeader = (key: MatrixSortKey, label: string) => (
    <th scope="col" className="live-channels-matrix__sortable live-channels-matrix__num" aria-sort={sortKey === key ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className="live-channels-matrix__sort-btn" onClick={() => toggleSort(key)}>
        {label}{sortKey === key ? <span aria-hidden="true"> {sortDir === 'desc' ? '▼' : '▲'}</span> : null}
      </button>
    </th>
  )

  return (
    <section id="section-tracked" className="figma-block live-channels-matrix" aria-labelledby="live-channels-matrix-title">
      <div className="figma-block__head live-channels-matrix__head">
        <div>
          <h2 id="live-channels-matrix-title" className="figma-block__title">{labels.trackedChannels}</h2>
          <p className="figma-block__sub">
            Current rates, measured activity change, and exact collection evidence. Activity change compares the latest five closed minutes with this broadcast’s earlier measured average; missing evidence stays unavailable.
            {poolSize != null && poolSize > 0 ? ` · ${compact(poolSize)} tracked in pool` : ''}
            {ircActive != null && ircActive > 0 ? ` · ${compact(ircActive)} IRC collecting` : ''}
            {rosterLive != null && rosterLive > 0 ? ` · ${compact(rosterLive)} roster live` : ''}
            {updatedAgo ? ` · as of ${updatedAgo}` : ''}
          </p>
        </div>
        <div className="live-channels-matrix__tabs" role="group" aria-label="Filter by coverage state">
          {tabs.map((tab) => (
            <button key={tab.key} type="button" aria-pressed={filter === tab.key} className={`live-channels-matrix__tab${filter === tab.key ? ' is-active' : ''}`} onClick={() => setFilter(tab.key)}>
              {tab.label} <span className="live-channels-matrix__tab-count">{counts[tab.key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="live-channels-matrix__views" role="tablist" aria-label="Channel Screener views">
        {SCREENER_VIEWS.map((key) => {
          const gated = (key === 'momentum' && !backendActivityAvailable) || (key === 'anomalies' && !backendAnomaliesAvailable)
          return (
            <button key={key} id={`channel-screener-view-${key}`} aria-controls="channel-screener-results" type="button" role="tab" aria-selected={view === key} tabIndex={view === key ? 0 : -1} className={`live-channels-matrix__view-tab${view === key ? ' is-active' : ''}`} onClick={() => setView(key)} onKeyDown={activateRovingTab} title={gated ? 'Backend evidence is not available in this payload' : undefined}>
              {screenerViewLabel(key)}{gated ? <span className="live-channels-matrix__view-hint"> · unavailable</span> : null}
            </button>
          )
        })}
      </div>

      <div id="channel-screener-results" role="tabpanel" aria-labelledby={`channel-screener-view-${view}`} className="live-channels-matrix__tabpanel">

      {view === 'momentum' && !backendActivityAvailable ? (
        <p className="live-channels-matrix__gated" role="status">Activity change needs the backend Screener v1 comparison. Current rates remain in Overview; StreamPulse will not estimate change from browser polling.</p>
      ) : view === 'anomalies' && !backendAnomaliesAvailable ? (
        <p className="live-channels-matrix__gated" role="status">No backend-authored anomaly reasons are available. Coverage evidence remains available for diagnosis.</p>
      ) : null}

      <div className="live-channels-matrix__controls">
        <label className="live-channels-matrix__search">
          <Search aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setExpanded(false) }} placeholder="Search channel or category…" aria-label="Search tracked channels" />
        </label>
        <span className="live-channels-matrix__result-count" aria-live="polite">
          {query.trim() || filter !== 'all' || view === 'anomalies' ? `${compact(sorted.length)} of ${compact(channels.length)} channels` : `${compact(channels.length)} channels tracked`}
        </span>
      </div>

      {loading && channels.length === 0 ? (
        <div className="live-channels-matrix__loading" aria-busy="true" aria-label="Loading channel evidence">
          {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} height={52} radius="var(--sc-radius)" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="live-channels-matrix__empty" role="status"><Radio aria-hidden="true" /><span>No live channels match this filter right now.</span></div>
      ) : (
        <>
          {compactLayout ? (
            <div className="live-channels-matrix__cards" aria-label={labels.trackedChannels}>
              {rows.map((channel) => <ChannelMatrixCard key={channel.login} channel={channel} href={rowHref(channel)} view={view} />)}
            </div>
          ) : (
            <div className="live-channels-matrix__table-wrap">
              <table className="live-channels-matrix__table">
                <thead><tr>
                  <th scope="col">Channel</th>
                  <th scope="col" className="live-channels-matrix__hide-md">Category</th>
                  {view === 'overview' ? <>{sortHeader('viewers', 'Viewers')}{sortHeader('chatPerMin', 'Chat/min')}{sortHeader('emotesPerMin', 'Emotes/min')}<th scope="col">Evidence state</th></> : null}
                  {view === 'momentum' ? <th scope="col" colSpan={3}>Latest 5 min vs stream average</th> : null}
                  {view === 'coverage' ? <th scope="col" colSpan={3}>Exact evidence</th> : null}
                  {view === 'anomalies' ? <th scope="col" colSpan={3}>Backend anomaly</th> : null}
                </tr></thead>
                <tbody>{rows.map((channel) => <ChannelMatrixRow key={channel.login} channel={channel} href={rowHref(channel)} view={view} />)}</tbody>
              </table>
            </div>
          )}
          {sorted.length > maxRows ? (
            <div className="live-channels-matrix__footer">
              <button type="button" className="live-channels-matrix__expand" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
                {expanded ? 'Show less' : `Show all ${compact(sorted.length)} channels`}
                {!expanded && hiddenCount > 0 ? <span className="live-channels-matrix__expand-count">+{compact(hiddenCount)}</span> : null}
              </button>
            </div>
          ) : null}
        </>
      )}
      </div>
    </section>
  )
}
