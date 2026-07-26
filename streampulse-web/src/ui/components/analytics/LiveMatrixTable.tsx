import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Radio } from 'lucide-react'
import type { HubLiveChannel } from '../../../lib/publicHub'
import { buildAnalyticsHref } from '../../../lib/analyticsLinks'
import { Skeleton } from '../../primitives'
import { compact, coverageMeta, displayName, initial } from './hubFormat'

interface LiveMatrixTableProps {
  channels: HubLiveChannel[]
  loading?: boolean
  updatedLabel?: string
}

type SortKey = 'viewers' | 'chatPerMin' | 'emotesPerMin'
type FilterKey = 'all' | 'chat' | 'warming' | 'metadata'

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

function filterOf(state: HubLiveChannel['coverageState']): FilterKey {
  const tone = coverageMeta(state).tone
  if (tone === 'warming') return 'warming'
  if (tone === 'synced' || tone === 'collecting' || tone === 'chat' || tone === 'partial') {
    return 'chat'
  }
  return 'metadata'
}

function miniSpark(trendPct: number, seed: number): { points: string; color: string } {
  const rising = trendPct >= 0
  const n = 5
  const pts: string[] = []
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 60
    const drift = rising ? 15 - (i / (n - 1)) * 11 : 5 + (i / (n - 1)) * 9
    const jitter = Math.abs(Math.sin(seed + i)) * 3
    const y = Math.max(2, Math.min(16, drift + (rising ? -jitter : jitter)))
    pts.push(`${x.toFixed(0)},${y.toFixed(1)}`)
  }
  return {
    points: pts.join(' '),
    color: rising ? 'hsl(var(--sc-chart-3))' : 'hsl(var(--sc-chart-5))',
  }
}

export function LiveMatrixTable({ channels, loading = false, updatedLabel }: LiveMatrixTableProps) {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [sortKey, setSortKey] = useState<SortKey>('viewers')

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      all: channels.length,
      chat: 0,
      warming: 0,
      metadata: 0,
    }
    for (const channel of channels) c[filterOf(channel.coverageState)] += 1
    return c
  }, [channels])

  const rows = useMemo(() => {
    const filtered = filter === 'all' ? channels : channels.filter((channel) => filterOf(channel.coverageState) === filter)
    const value = (channel: HubLiveChannel) =>
      sortKey === 'emotesPerMin' ? Math.max(channel.emotesPerMin ?? 0, channel.seventvPerMin) : channel[sortKey]
    return [...filtered].sort((a, b) => value(b) - value(a))
  }, [channels, filter, sortKey])

  const tabs: Array<{ key: FilterKey; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'chat', label: 'Chat tracked (IRC)' },
    { key: 'warming', label: 'Warming' },
    { key: 'metadata', label: 'Metadata only — no chat coverage' },
  ]

  const sortHeader = (key: SortKey, label: string) => (
    <th
      className="r sortable"
      aria-sort={sortKey === key ? 'descending' : 'none'}
      onClick={() => setSortKey(key)}
    >
      {label} {sortKey === key ? <span className="ar">▼</span> : null}
    </th>
  )

  return (
    <section className="dash-card" aria-labelledby="dash-lm-h" id="dash-live-matrix">
      <div className="dash-card-header row">
        <div className="dash-toolbar">
          <div className="dash-tabs" role="tablist" aria-label="Filter by coverage state">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={filter === tab.key}
                onClick={() => setFilter(tab.key)}
              >
                {tab.label} <span className="n">{counts[tab.key]}</span>
              </button>
            ))}
          </div>
        </div>
        <span className="dash-card-desc" id="dash-lm-h">
          {updatedLabel ?? 'Live tracked channels'}
        </span>
      </div>
      <div className="dash-card-content" style={{ paddingLeft: 0, paddingRight: 0 }}>
        {loading && channels.length === 0 ? (
          <div style={{ padding: '0 1.15rem' }}>
            <Skeleton height={220} radius="var(--sc-radius)" />
          </div>
        ) : rows.length === 0 ? (
          <div className="dash-empty">
            <Radio aria-hidden="true" />
            <span>No live channels match this filter right now.</span>
          </div>
        ) : (
          <table className="dash-tbl">
            <thead>
              <tr>
                <th style={{ paddingLeft: '1.15rem' }}>Channel</th>
                <th className="hide">Category</th>
                <th className="hide">State</th>
                {sortHeader('viewers', 'Viewers')}
                {sortHeader('chatPerMin', 'Chat/min')}
                {sortHeader('emotesPerMin', 'Emotes/min')}
                <th className="hide">Trend</th>
                <th className="hide" style={{ paddingRight: '1.15rem' }}>
                  Coverage
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((channel, index) => {
                const meta = coverageMeta(channel.coverageState)
                const pct = coveragePercent(channel.coverageState)
                const spark = miniSpark(channel.trendPct, index + 1)
                const href = buildAnalyticsHref({ login: channel.login, context: 'channel-row' })
                return (
                  <tr key={channel.login}>
                    <td style={{ paddingLeft: '1.15rem' }}>
                      <Link to={href} className="ch">
                        <span className="av" aria-hidden="true">
                          {channel.profileImageUrl ? (
                            <img src={channel.profileImageUrl} alt="" loading="lazy" />
                          ) : (
                            initial(channel.login)
                          )}
                        </span>
                        <span>
                          <strong>{displayName(channel.login, channel.displayName)}</strong>
                          <small>{channel.category || 'Live now'}</small>
                        </span>
                      </Link>
                    </td>
                    <td className="hide">
                      <span className="dash-badge dash-badge--outline">{channel.category || '—'}</span>
                    </td>
                    <td className="hide">
                      <span className={`dash-stbadge dash-st-${meta.tone === 'synced' ? 'live' : meta.tone === 'partial' ? 'backfill' : 'tracked'}`}>
                        <span className="dot" />
                        {meta.label}
                      </span>
                    </td>
                    <td className="r num">{compact(channel.viewers)}</td>
                    <td className="r chat">{compact(channel.chatPerMin)}</td>
                    <td className="r emote">{compact(Math.max(channel.emotesPerMin ?? 0, channel.seventvPerMin))}</td>
                    <td className="hide">
                      <svg className="minispark" viewBox="0 0 60 18" preserveAspectRatio="none" aria-hidden="true" width={60} height={18}>
                        <polyline points={spark.points} fill="none" stroke={spark.color} strokeWidth={2} />
                      </svg>
                    </td>
                    <td className="hide" style={{ paddingRight: '1.15rem' }}>
                      <span className="dash-covbar" aria-hidden="true">
                        <i style={{ width: `${pct}%`, background: pct >= 95 ? 'hsl(var(--sc-chart-3))' : 'hsl(var(--sc-chart-4))' }} />
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
