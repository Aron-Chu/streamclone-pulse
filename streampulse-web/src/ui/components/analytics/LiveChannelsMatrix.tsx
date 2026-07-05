import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Radio, Search } from 'lucide-react'
import type { HubLiveChannel } from '../../../lib/publicHub'
import { buildAnalyticsHref } from '../../../lib/analyticsLinks'
import { Skeleton } from '../../primitives'
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

export interface LiveChannelsMatrixProps {
  channels: HubLiveChannel[]
  loading?: boolean
  updatedAgo?: string
  maxRows?: number
  poolSize?: number
  ircActive?: number
  rosterLive?: number
}

type MatrixFilterKey = 'all' | 'synced' | 'partial' | 'stats'
type MatrixSortKey = 'viewers' | 'chatPerMin' | 'emotesPerMin'

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
  if (tone === 'synced') return 'synced'
  if (tone === 'partial') return 'partial'
  return 'stats'
}

function rowHref(channel: HubLiveChannel): string {
  return buildAnalyticsHref({ login: channel.login, streamId: channel.streamId, context: 'channel-row' })
}

function rowAriaLabel(channel: HubLiveChannel): string {
  const name = displayName(channel.login, channel.displayName)
  const coverage = coverageMeta(channel.coverageState).label
  return `Open analytics for ${name}, ${compact(channel.viewers)} viewers, ${coverage} coverage`
}

interface ChannelMatrixRowProps {
  channel: HubLiveChannel
  href: string
}

function ChannelMatrixRow({ channel, href }: ChannelMatrixRowProps) {
  const navigate = useNavigate()
  const meta = coverageMeta(channel.coverageState)
  const pct = coveragePercent(channel.coverageState)
  const barMeta = coveragePctMeta(pct)
  const emotesPerMin = channelEmotesPerMin(channel)
  const label = rowAriaLabel(channel)
  const category = channelCategoryLabel(channel.category)

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
            {channel.profileImageUrl ? (
              <img src={channel.profileImageUrl} alt="" loading="lazy" decoding="async" />
            ) : (
              initial(channel.login)
            )}
          </span>
          <span className="live-channels-matrix__channel-text">
            <strong>{displayName(channel.login, channel.displayName)}</strong>
            <small title={category}>{category}</small>
            {channel.streamingTogether ? <StreamTogetherBadge channel={channel} /> : null}
          </span>
        </span>
      </td>
      <td className="live-channels-matrix__hide-md" title={category}>
        {category}
      </td>
      <td className="live-channels-matrix__num">{compact(channel.viewers)}</td>
      <td className="live-channels-matrix__num">
        {channel.chatPerMin > 0 ? compact(Math.round(channel.chatPerMin)) : '—'}
      </td>
      <td className="live-channels-matrix__num">
        {emotesPerMin > 0 ? compact(Math.round(emotesPerMin)) : '—'}
      </td>
      <td className="live-channels-matrix__coverage">
        <span className={`live-channels-matrix__coverage-label live-channels-matrix__coverage-label--${meta.tone}`}>
          {meta.label}
        </span>
        <span className="live-channels-matrix__covbar" role="img" aria-label={`${pct}% coverage`}>
          <i style={{ width: `${pct}%`, background: barMeta.color }} />
        </span>
      </td>
      <td className="live-channels-matrix__momentum">
        <MomentumBadge
          pct={channel.trendPct}
          hasSignal={channel.trendSignal}
          classPrefix="live-channels-matrix__momentum-badge"
        />
      </td>
    </tr>
  )
}

function ChannelMatrixCard({ channel, href }: ChannelMatrixRowProps) {
  const meta = coverageMeta(channel.coverageState)
  const emotesPerMin = channelEmotesPerMin(channel)
  const category = channelCategoryLabel(channel.category)

  return (
    <Link to={href} className="live-channels-matrix__card">
      <span className="live-channels-matrix__avatar" aria-hidden="true">
        {channel.profileImageUrl ? (
          <img src={channel.profileImageUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          initial(channel.login)
        )}
      </span>
      <span className="live-channels-matrix__card-main">
        <strong>{displayName(channel.login, channel.displayName)}</strong>
        <small title={category}>{category}</small>
        {channel.streamingTogether ? <StreamTogetherBadge channel={channel} /> : null}
        <span className="live-channels-matrix__card-stats">
          <span>{compact(channel.viewers)} viewers</span>
          <span>{channel.chatPerMin > 0 ? `${compact(Math.round(channel.chatPerMin))}/m chat` : '— chat'}</span>
          <span>{emotesPerMin > 0 ? `${compact(Math.round(emotesPerMin))}/m emotes` : '— emotes'}</span>
        </span>
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
    const c = { all: channels.length, synced: 0, partial: 0, stats: 0 }
    for (const channel of channels) c[filterOf(channel.coverageState)] += 1
    return c
  }, [channels])

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = channels.filter((channel) => {
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
  }, [channels, filter, query, sortKey, sortDir])

  const rows = expanded ? sorted : sorted.slice(0, maxRows)
  const hiddenCount = sorted.length - rows.length

  const tabs: Array<{ key: MatrixFilterKey; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'synced', label: 'Synced' },
    { key: 'partial', label: 'Partial' },
    { key: 'stats', label: 'Stats-only' },
  ]

  const sortHeader = (key: MatrixSortKey, label: string) => (
    <th
      scope="col"
      className="live-channels-matrix__sortable live-channels-matrix__num"
      aria-sort={sortKey === key ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
    >
      <button type="button" className="live-channels-matrix__sort-btn" onClick={() => toggleSort(key)}>
        {label}
        {sortKey === key ? <span aria-hidden="true"> {sortDir === 'desc' ? '\u25BC' : '\u25B2'}</span> : null}
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
            Live tracked channels
          </h2>
          <p className="figma-block__sub">
            Top {maxRows} of {compact(channels.length)} hub rows
            {poolSize != null && poolSize > 0 ? ` · ${compact(poolSize)} live in pool` : ''}
            {ircActive != null && ircActive > 0 ? ` · ${compact(ircActive)} IRC collecting` : ''}
            {rosterLive != null && rosterLive > 0 ? ` · ${compact(rosterLive)} roster live` : ''}
            — coverage, chat velocity, and Helix viewer totals.
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
          {query.trim() || filter !== 'all'
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
          <div className="live-channels-matrix__table-wrap">
            <table className="live-channels-matrix__table">
              <thead>
                <tr>
                  <th scope="col">Channel</th>
                  <th scope="col" className="live-channels-matrix__hide-md">
                    Category
                  </th>
                  {sortHeader('viewers', 'Viewers')}
                  {sortHeader('chatPerMin', 'Chat/min')}
                  {sortHeader('emotesPerMin', 'Emotes/min')}
                  <th scope="col">Coverage</th>
                  <th scope="col" title={MOMENTUM_COLUMN_TITLE}>
                    Momentum
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((channel) => (
                  <ChannelMatrixRow key={channel.login} channel={channel} href={rowHref(channel)} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="live-channels-matrix__cards" aria-label="Live tracked channels">
            {rows.map((channel) => (
              <ChannelMatrixCard key={channel.login} channel={channel} href={rowHref(channel)} />
            ))}
          </div>
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
