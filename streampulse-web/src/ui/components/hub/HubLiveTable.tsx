import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, Radio } from 'lucide-react'
import type { HubLiveChannel } from '../../../lib/publicHub'
import { buildAnalyticsHref } from '../../../lib/analyticsLinks'
import {
  compact,
  coverageMeta,
  formatStreamUptime,
  hubChatPerMinDisplay,
  isMetadataOnlyCoverage,
} from '../analytics/hubFormat'
import { Avatar, Delta, EmptyState, Skeleton } from './primitives'

type SortKey = 'viewers' | 'chatPerMin' | 'emotesPerMin'
type FilterKey = 'all' | 'chat' | 'warming' | 'metadata'

export interface HubLiveTableProps {
  channels: HubLiveChannel[]
  loading?: boolean
  /** When true, omits outer card header (used inside Emote signal section). */
  embedded?: boolean
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'chat', label: 'Chat tracked (IRC)' },
  { key: 'warming', label: 'Warming' },
  { key: 'metadata', label: 'Metadata only — no chat coverage' },
]

const COLLAPSED_ROWS = 10

function filterOf(channel: HubLiveChannel): FilterKey {
  switch (coverageMeta(channel.coverageState).tone) {
    case 'warming':
      return 'warming'
    case 'synced':
    case 'collecting':
    case 'chat':
    case 'partial':
      return 'chat'
    default:
      return 'metadata'
  }
}

function coverageVisual(channel: HubLiveChannel): { pct: number; color: string; cls: string } {
  switch (coverageMeta(channel.coverageState).tone) {
    case 'synced':
      return { pct: 100, color: 'hsl(var(--chart-3))', cls: 'hx-st-live' }
    case 'collecting':
    case 'warming':
      return { pct: 72, color: 'hsl(var(--chart-1))', cls: 'hx-st-collecting' }
    case 'chat':
    case 'viewer':
    case 'partial':
      return { pct: 52, color: 'hsl(var(--chart-4))', cls: 'hx-st-partial' }
    default:
      return { pct: 28, color: 'hsl(var(--chart-1))', cls: 'hx-st-tracked' }
  }
}

function hasRollupSignal(channel: HubLiveChannel): boolean {
  return channel.chatPerMin > 0 || Math.max(channel.emotesPerMin ?? 0, channel.seventvPerMin) > 0
}

export function HubLiveTable({ channels, loading, embedded }: HubLiveTableProps) {
  const navigate = useNavigate()
  const [sortKey, setSortKey] = useState<SortKey>('viewers')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [expanded, setExpanded] = useState(false)

  const counts = useMemo(() => {
    const acc: Record<FilterKey, number> = { all: channels.length, chat: 0, warming: 0, metadata: 0 }
    for (const channel of channels) acc[filterOf(channel)] += 1
    return acc
  }, [channels])

  const rows = useMemo(() => {
    const effectiveFilter = embedded ? 'all' : filter
    const filtered = effectiveFilter === 'all' ? channels : channels.filter((c) => filterOf(c) === effectiveFilter)
    const sorted = [...filtered].sort((a, b) => {
      const value = (channel: HubLiveChannel) =>
        sortKey === 'emotesPerMin' ? Math.max(channel.emotesPerMin ?? 0, channel.seventvPerMin) : channel[sortKey]
      const delta = value(a) - value(b)
      return dir === 'asc' ? delta : -delta
    })
    return sorted
  }, [channels, filter, sortKey, dir, embedded])

  const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS)

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setDir('desc')
    }
  }

  function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (key !== sortKey) return 'none'
    return dir === 'asc' ? 'ascending' : 'descending'
  }

  function arrow(key: SortKey) {
    if (key !== sortKey) return null
    return <span className="ar" aria-hidden="true">{dir === 'asc' ? '▲' : '▼'}</span>
  }

  return (
    <>
      {!embedded ? (
      <div className="hx-card__header hx-card__header--row">
        <div>
          <h3 className="hx-card__title">Live directory</h3>
          <div className="hx-card__desc">
            IRC live coverage states · manual VOD import progress is in Coverage health
          </div>
        </div>
        <div className="hx-tabs" role="tablist" aria-label="Coverage filter">
          {FILTERS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={filter === tab.key}
              className={filter === tab.key ? 'is-active' : undefined}
              onClick={() => {
                setFilter(tab.key)
                setExpanded(false)
              }}
            >
              {tab.label}
              <span className="n">{counts[tab.key]}</span>
            </button>
          ))}
        </div>
      </div>
      ) : null}
      <div className="hx-card__content hx-card__content--flush" style={{ overflowX: 'auto' }}>
        {loading && channels.length === 0 ? (
          <div style={{ padding: '0.5rem 1.15rem' }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0' }}>
                <Skeleton width={32} height={32} radius="0.5rem" />
                <Skeleton width="40%" height="0.9rem" />
                <Skeleton width="3rem" height="0.8rem" style={{ marginLeft: 'auto' }} />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Radio aria-hidden="true" />}>
            {channels.length === 0
              ? 'No channels live right now. The directory fills as tracked streams go live.'
              : 'No channels match this coverage filter.'}
          </EmptyState>
        ) : (
          <>
            <table className="hx-tbl">
            <thead>
              <tr>
                <th scope="col" style={{ paddingLeft: '1.15rem' }}>
                  Channel
                </th>
                <th scope="col" className="hide">
                  State
                </th>
                <th
                  scope="col"
                  className="r sortable"
                  aria-sort={ariaSort('viewers')}
                  onClick={() => toggleSort('viewers')}
                >
                  Viewers {arrow('viewers')}
                </th>
                <th
                  scope="col"
                  className="r sortable"
                  aria-sort={ariaSort('chatPerMin')}
                  onClick={() => toggleSort('chatPerMin')}
                >
                  Chat/min {arrow('chatPerMin')}
                </th>
                <th
                  scope="col"
                  className="r sortable"
                  aria-sort={ariaSort('emotesPerMin')}
                  onClick={() => toggleSort('emotesPerMin')}
                >
                  Emotes/min {arrow('emotesPerMin')}
                </th>
                <th scope="col" className="c">
                  Rollup trend
                </th>
                <th scope="col" className="c" style={{ paddingRight: embedded ? '0.85rem' : '1.15rem' }}>
                  Coverage
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((channel) => {
                const meta = coverageMeta(channel.coverageState)
                const cov = coverageVisual(channel)
                const uptime = formatStreamUptime(channel.startedAt)
                const chatCell = hubChatPerMinDisplay(channel)
                const metadataOnly = isMetadataOnlyCoverage(channel.coverageState)
                return (
                  <tr
                    key={channel.login}
                    onClick={() => navigate(buildAnalyticsHref({ login: channel.login, streamId: channel.streamId }))}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={{ paddingLeft: '1.15rem' }}>
                      <div className="ch">
                        <Avatar login={channel.login} src={channel.profileImageUrl} />
                        <span>
                          <Link
                            to={buildAnalyticsHref({ login: channel.login, streamId: channel.streamId })}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <strong>{channel.displayName?.trim() || channel.login}</strong>
                          </Link>
                          {channel.title?.trim() ? (
                            <small className="hx-tbl__title" title={channel.title.trim()}>
                              {channel.title.trim()}
                            </small>
                          ) : null}
                          <small>
                            {channel.category?.trim() || 'Uncategorised'}
                            {uptime ? ` · ${uptime} live` : ''}
                          </small>
                          {metadataOnly ? (
                            <span className={`hx-badge hx-badge--outline hx-badge--inline ${cov.cls}`}>
                              <span className="dot" />
                              {meta.label}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    </td>
                    <td className="hide">
                      <span className={`hx-badge hx-badge--outline ${cov.cls}`}>
                        <span className="dot" />
                        {meta.label}
                      </span>
                    </td>
                    <td className="r tnum">{compact(channel.viewers)}</td>
                    <td
                      className={`r tnum chat${chatCell.muted ? ' hx-tbl__chat--muted' : ''}`}
                      title={chatCell.title}
                    >
                      {chatCell.text}
                    </td>
                    <td className="r tnum emote">{compact(Math.max(channel.emotesPerMin ?? 0, channel.seventvPerMin))}</td>
                    <td className="c">
                      {hasRollupSignal(channel) ? <Delta pct={channel.trendPct} /> : <span className="muted">no rollup</span>}
                    </td>
                    <td className="c" style={{ paddingRight: embedded ? '0.85rem' : '1.15rem' }}>
                      {metadataOnly ? (
                        <span
                          className={`hx-badge hx-badge--outline hx-badge--compact ${cov.cls}`}
                          title={chatCell.title ?? `${meta.label} · ${cov.pct}% IRC coverage`}
                        >
                          <span className="dot" />
                          {meta.label}
                        </span>
                      ) : (
                        <span className="hx-covbar" title={`${meta.label} · ${cov.pct}%`}>
                          <i style={{ width: `${cov.pct}%`, background: cov.color }} />
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            </table>
            {rows.length > COLLAPSED_ROWS ? (
              <div className="hx-tbl-more">
                <button
                  type="button"
                  className="hx-btn hx-btn--ghost hx-btn--sm"
                  aria-expanded={expanded}
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded ? 'Show fewer' : `Show all ${rows.length} channels`}
                  <ChevronDown aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : 'none' }} />
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}
