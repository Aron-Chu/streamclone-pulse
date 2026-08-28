import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Radio, Search } from 'lucide-react'
import type { HubLiveChannel } from '../../../lib/publicHub'
import { buildAnalyticsHref } from '../../../lib/analyticsLinks'
import {
  screenerViewLabel,
  type ChannelScreenerView,
} from '../../../lib/channelScreenerContract'
import { Skeleton } from '../../primitives'
import {
  LIVE_CHANNELS_MATRIX_COMPACT_QUERY,
  useMatchMedia,
} from '../../hooks/useMatchMedia'
import {
  compact,
  coverageMeta,
  coveragePctMeta,
  displayName,
  initial,
  MOMENTUM_COLUMN_TITLE,
} from './hubFormat'
import { StreamTogetherBadge, channelCategoryLabel } from './StreamTogetherBadge'
import { MomentumBadge } from './MomentumBadge'
import { useCommandCenterLabels } from '../../providers/AnalyticsThemeProvider'
import { ResilientImage } from '../ResilientImage'

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

const SCREENER_VIEWS: ChannelScreenerView[] = [
  'overview',
  'momentum',
  'coverage',
  'anomalies',
]

function channelEmotesPerMin(channel: HubLiveChannel): number {
  return Math.max(channel.emotesPerMin ?? 0, channel.seventvPerMin ?? 0)
}

function coveragePercent(state: HubLiveChannel['coverageState']): number {
  switch (state) {
    case 'synced':
      return 100
    case 'partial':
      return 62
    case 'chat_only':
    case 'viewer_only':
      return 44
    case 'stats_only':
      return 18
    default:
      return 30
  }
}

function filterOf(state: HubLiveChannel['coverageState']): MatrixFilterKey {
  const tone = coverageMeta(state).tone
  if (tone === 'warming') return 'warming'
  if (tone === 'synced' || tone === 'collecting' || tone === 'chat' || tone === 'partial') {
    return 'chat'
  }
  return 'metadata'
}

function rowHref(channel: HubLiveChannel): string {
  return buildAnalyticsHref({ login: channel.login, streamId: channel.streamId, context: 'channel-row' })
}

function rowAriaLabel(channel: HubLiveChannel): string {
  const name = displayName(channel.login, channel.displayName)
  const coverage = coverageMeta(channel.coverageState).label
  return `Open analytics for ${name}, ${compact(channel.viewers)} viewers, ${coverage} coverage`
}

function hasBackendAnomaly(channel: HubLiveChannel): boolean {
  return Boolean(channel.screener?.anomalyReason?.trim())
}

function hasBackendMomentum(channel: HubLiveChannel): boolean {
  const s = channel.screener
  return (
    s?.chatAcceleration != null ||
    s?.emoteAcceleration != null ||
    s?.viewerChatDivergence != null ||
    Boolean(s?.newlyLive)
  )
}

interface ChannelMatrixRowProps {
  channel: HubLiveChannel
  href: string
  view: ChannelScreenerView
}

function ChannelMatrixRow({ channel, href, view }: ChannelMatrixRowProps) {
  const navigate = useNavigate()
  const meta = coverageMeta(channel.coverageState)
  const pct = coveragePercent(channel.coverageState)
  const barMeta = coveragePctMeta(pct)
  const emotesPerMin = channelEmotesPerMin(channel)
  const label = rowAriaLabel(channel)
  const category = channelCategoryLabel(channel.category)
  const screener = channel.screener

  const activate = () => navigate(href)

  return (
    <tr
      className="live-channels-matrix__row"
      role="link"
      tabIndex={0}
      aria-label={label}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          activate()
        }
      }}
    >
      <td className="live-channels-matrix__channel-cell">
        <span className="live-channels-matrix__channel">
          <span className="live-channels-matrix__avatar" aria-hidden="true">
            <ResilientImage
              src={channel.profileImageUrl}
              alt=""
              loading="lazy"
              decoding="async"
              fallback={initial(channel.login)}
            />
          </span>
          <span className="live-channels-matrix__channel-text">
            <strong>{displayName(channel.login, channel.displayName)}</strong>
            <small title={category}>{category}</small>
            {channel.streamingTogether ? <StreamTogetherBadge channel={channel} /> : null}
            {screener?.newlyLive ? (
              <span className="live-channels-matrix__pill">Newly live</span>
            ) : null}
          </span>
        </span>
      </td>
      <td className="live-channels-matrix__hide-md" title={category}>
        {category}
      </td>
      {view === 'overview' || view === 'momentum' ? (
        <>
          <td className="live-channels-matrix__num">{compact(channel.viewers)}</td>
          <td className="live-channels-matrix__num">
            {channel.chatPerMin > 0 ? compact(Math.round(channel.chatPerMin)) : '—'}
          </td>
          <td className="live-channels-matrix__num">
            {emotesPerMin > 0 ? compact(Math.round(emotesPerMin)) : '—'}
          </td>
        </>
      ) : null}
      {view === 'momentum' ? (
        <>
          <td className="live-channels-matrix__num live-channels-matrix__hide-md">
            {screener?.chatAcceleration != null ? screener.chatAcceleration.toFixed(1) : '—'}
          </td>
          <td className="live-channels-matrix__num live-channels-matrix__hide-md">
            {screener?.emoteAcceleration != null ? screener.emoteAcceleration.toFixed(1) : '—'}
          </td>
        </>
      ) : null}
      {view === 'coverage' || view === 'overview' || view === 'anomalies' ? (
        <td className="live-channels-matrix__coverage">
          <span className={`live-channels-matrix__coverage-label live-channels-matrix__coverage-label--${meta.tone}`}>
            {meta.label}
          </span>
          <span className="live-channels-matrix__covbar" role="img" aria-label={`${pct}% coverage`}>
            <i style={{ width: `${pct}%`, background: barMeta.color }} />
          </span>
          {screener?.dataFreshnessAt ? (
            <small className="live-channels-matrix__freshness">{screener.dataFreshnessAt}</small>
          ) : null}
        </td>
      ) : null}
      {view === 'overview' || view === 'momentum' ? (
        <td className="live-channels-matrix__momentum">
          <MomentumBadge
            pct={channel.trendPct}
            hasSignal={channel.trendSignal}
            classPrefix="live-channels-matrix__momentum-badge"
          />
        </td>
      ) : null}
      {view === 'anomalies' ? (
        <td className="live-channels-matrix__anomaly">
          {screener?.anomalyReason?.trim() ||
            (screener?.viewerChatDivergence != null
              ? `Divergence ${screener.viewerChatDivergence.toFixed(1)}`
              : '—')}
        </td>
      ) : null}
    </tr>
  )
}

function ChannelMatrixCard({ channel, href, view }: ChannelMatrixRowProps) {
  const meta = coverageMeta(channel.coverageState)
  const emotesPerMin = channelEmotesPerMin(channel)
  const category = channelCategoryLabel(channel.category)
  const screener = channel.screener
  const label = rowAriaLabel(channel)

  return (
    <Link to={href} className="live-channels-matrix__card" aria-label={label}>
      <span className="live-channels-matrix__avatar" aria-hidden="true">
        <ResilientImage
          src={channel.profileImageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          fallback={initial(channel.login)}
        />
      </span>
      <span className="live-channels-matrix__card-main">
        <strong>{displayName(channel.login, channel.displayName)}</strong>
        <small title={category}>{category}</small>
        {channel.streamingTogether ? <StreamTogetherBadge channel={channel} /> : null}
        <span className="live-channels-matrix__card-stats">
          <span>{compact(channel.viewers)} viewers</span>
          <span>
            {channel.chatPerMin > 0 ? `${compact(Math.round(channel.chatPerMin))}/m chat` : '— chat'}
          </span>
          <span>
            {emotesPerMin > 0 ? `${compact(Math.round(emotesPerMin))}/m emotes` : '— emotes'}
          </span>
        </span>
        {view === 'anomalies' && screener?.anomalyReason ? (
          <span className="live-channels-matrix__card-anomaly">{screener.anomalyReason}</span>
        ) : null}
      </span>
      <span className="live-channels-matrix__card-side">
        <span className={`live-channels-matrix__coverage-label live-channels-matrix__coverage-label--${meta.tone}`}>
          {meta.label}
        </span>
        <MomentumBadge
          pct={channel.trendPct}
          hasSignal={channel.trendSignal}
          classPrefix="live-channels-matrix__momentum-badge"
        />
      </span>
    </Link>
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
  // One semantic tree per viewport — do not mount desktop table + mobile cards together.
  const compactLayout = useMatchMedia(LIVE_CHANNELS_MATRIX_COMPACT_QUERY)
  const labels = useCommandCenterLabels()
  const [view, setView] = useState<ChannelScreenerView>('overview')
  const [filter, setFilter] = useState<MatrixFilterKey>('all')
  const [sortKey, setSortKey] = useState<MatrixSortKey>('viewers')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)

  const toggleSort = (key: MatrixSortKey) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const counts = useMemo(() => {
    const c: Record<MatrixFilterKey, number> = {
      all: channels.length,
      chat: 0,
      warming: 0,
      metadata: 0,
    }
    for (const channel of channels) c[filterOf(channel.coverageState)] += 1
    return c
  }, [channels])

  const backendMomentumAvailable = useMemo(
    () => channels.some(hasBackendMomentum),
    [channels],
  )
  const backendAnomaliesAvailable = useMemo(
    () => channels.some(hasBackendAnomaly),
    [channels],
  )

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = channels.filter((channel) => {
      if (view === 'anomalies' && backendAnomaliesAvailable && !hasBackendAnomaly(channel)) {
        return false
      }
      if (view === 'momentum' && backendMomentumAvailable && !hasBackendMomentum(channel)) {
        // Still show all when filtering by coverage tabs; acceleration columns may be empty.
      }
      if (filter !== 'all' && filterOf(channel.coverageState) !== filter) return false
      if (!q) return true
      const name = displayName(channel.login, channel.displayName).toLowerCase()
      return (
        channel.login.toLowerCase().includes(q) ||
        name.includes(q) ||
        (channel.category ?? '').toLowerCase().includes(q)
      )
    })
    const value = (channel: HubLiveChannel) =>
      sortKey === 'emotesPerMin' ? channelEmotesPerMin(channel) : channel[sortKey]
    const dir = sortDir === 'desc' ? 1 : -1
    return [...filtered].sort((a, b) => (value(b) - value(a)) * dir)
  }, [
    backendAnomaliesAvailable,
    backendMomentumAvailable,
    channels,
    filter,
    query,
    sortKey,
    sortDir,
    view,
  ])

  const rows = expanded ? sorted : sorted.slice(0, maxRows)
  const hiddenCount = sorted.length - rows.length

  const tabs: Array<{ key: MatrixFilterKey; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'chat', label: 'Chat tracked (IRC)' },
    { key: 'warming', label: 'Warming' },
    { key: 'metadata', label: 'Metadata only — no chat coverage' },
  ]

  const sortHeader = (key: MatrixSortKey, label: string) => (
    <th
      scope="col"
      className="live-channels-matrix__sortable live-channels-matrix__num"
      aria-sort={sortKey === key ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
    >
      <button type="button" className="live-channels-matrix__sort-btn" onClick={() => toggleSort(key)}>
        {label}
        {sortKey === key ? (
          <span aria-hidden="true"> {sortDir === 'desc' ? '\u25BC' : '\u25B2'}</span>
        ) : null}
      </button>
    </th>
  )

  return (
    <section
      id="section-tracked"
      className="figma-block live-channels-matrix"
      aria-labelledby="live-channels-matrix-title"
    >
      <div className="figma-block__head live-channels-matrix__head">
        <div>
          <h2 id="live-channels-matrix-title" className="figma-block__title">
            {labels.trackedChannels}
          </h2>
          <p className="figma-block__sub">
            Which tracked channels match activity, coverage, or anomaly conditions — not a second
            moments list. Overview uses live hub rows now. Momentum acceleration and anomaly
            reasons appear only when the backend ships `screener` fields (never invented from
            browser poll history).
            {poolSize != null && poolSize > 0 ? ` · ${compact(poolSize)} tracked in pool` : ''}
            {ircActive != null && ircActive > 0 ? ` · ${compact(ircActive)} IRC collecting` : ''}
            {rosterLive != null && rosterLive > 0 ? ` · ${compact(rosterLive)} roster live` : ''}
            {updatedAgo ? ` · as of ${updatedAgo}` : ''}
          </p>
        </div>
        <div className="live-channels-matrix__tabs" role="tablist" aria-label="Filter by coverage state">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={filter === tab.key}
              className={`live-channels-matrix__tab${filter === tab.key ? ' is-active' : ''}`}
              onClick={() => setFilter(tab.key)}
            >
              {tab.label} <span className="live-channels-matrix__tab-count">{counts[tab.key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="live-channels-matrix__views" role="tablist" aria-label="Channel Screener views">
        {SCREENER_VIEWS.map((key) => {
          const gated =
            (key === 'momentum' && !backendMomentumAvailable) ||
            (key === 'anomalies' && !backendAnomaliesAvailable)
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              className={`live-channels-matrix__view-tab${view === key ? ' is-active' : ''}`}
              onClick={() => setView(key)}
              title={
                gated
                  ? 'Extra columns appear when the hub ships screener fields'
                  : undefined
              }
            >
              {screenerViewLabel(key)}
              {gated ? <span className="live-channels-matrix__view-hint"> · basic</span> : null}
            </button>
          )
        })}
      </div>

      {(view === 'momentum' && !backendMomentumAvailable) ||
      (view === 'anomalies' && !backendAnomaliesAvailable) ? (
        <p className="live-channels-matrix__gated" role="status">
          {view === 'momentum'
            ? 'Showing overview rates. Chat/emote acceleration and newly-live flags need backend screener fields.'
            : 'No backend anomaly reasons yet. Coverage state remains available for triage.'}
        </p>
      ) : null}

      <div className="live-channels-matrix__controls">
        <label className="live-channels-matrix__search">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setExpanded(false)
            }}
            placeholder="Search channel or category…"
            aria-label="Search tracked channels"
          />
        </label>
        <span className="live-channels-matrix__result-count">
          {query.trim() || filter !== 'all' || view === 'anomalies'
            ? `${compact(sorted.length)} of ${compact(channels.length)} channels`
            : `${compact(channels.length)} channels tracked`}
        </span>
      </div>

      {loading && channels.length === 0 ? (
        <div className="live-channels-matrix__loading" aria-busy="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} height={52} radius="var(--sc-radius)" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="live-channels-matrix__empty">
          <Radio aria-hidden="true" />
          <span>No live channels match this filter right now.</span>
        </div>
      ) : (
        <>
          {compactLayout ? (
            <div className="live-channels-matrix__cards" aria-label={labels.trackedChannels}>
              {rows.map((channel) => (
                <ChannelMatrixCard
                  key={channel.login}
                  channel={channel}
                  href={rowHref(channel)}
                  view={view}
                />
              ))}
            </div>
          ) : (
            <div className="live-channels-matrix__table-wrap">
              <table className="live-channels-matrix__table">
                <thead>
                  <tr>
                    <th scope="col">Channel</th>
                    <th scope="col" className="live-channels-matrix__hide-md">
                      Category
                    </th>
                    {view === 'overview' || view === 'momentum' ? (
                      <>
                        {sortHeader('viewers', 'Viewers')}
                        {sortHeader('chatPerMin', 'Chat/min')}
                        {sortHeader('emotesPerMin', 'Emotes/min')}
                      </>
                    ) : null}
                    {view === 'momentum' ? (
                      <>
                        <th scope="col" className="live-channels-matrix__hide-md">
                          Chat accel
                        </th>
                        <th scope="col" className="live-channels-matrix__hide-md">
                          Emote accel
                        </th>
                      </>
                    ) : null}
                    {view === 'coverage' || view === 'overview' || view === 'anomalies' ? (
                      <th scope="col">Coverage</th>
                    ) : null}
                    {view === 'overview' || view === 'momentum' ? (
                      <th scope="col" title={MOMENTUM_COLUMN_TITLE}>
                        Momentum
                      </th>
                    ) : null}
                    {view === 'anomalies' ? <th scope="col">Anomaly</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((channel) => (
                    <ChannelMatrixRow
                      key={channel.login}
                      channel={channel}
                      href={rowHref(channel)}
                      view={view}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sorted.length > maxRows ? (
            <div className="live-channels-matrix__footer">
              <button
                type="button"
                className="live-channels-matrix__expand"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
              >
                {expanded ? 'Show less' : `Show all ${compact(sorted.length)} channels`}
                {!expanded && hiddenCount > 0 ? (
                  <span className="live-channels-matrix__expand-count">+{compact(hiddenCount)}</span>
                ) : null}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
