import { Link } from 'react-router-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { HubLiveChannel } from '../../../lib/publicHub'
import { buildAnalyticsHref } from '../../../lib/analyticsLinks'
import { hottestLiveReason } from './activityBucketInspectorUtils'
import { compact } from './hubFormat'
import { MomentumBadge } from './MomentumBadge'
import { StreamTogetherBadge, channelCategoryLabel } from './StreamTogetherBadge'
import { ResilientImage } from '../ResilientImage'

export interface FigmaLiveChannelRailProps {
  channels: HubLiveChannel[]
  colors?: string[]
  loading?: boolean
}

const RAIL_THUMB_FALLBACK = '#1e3a5f'

function twitchPreviewUrl(login: string): string {
  return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${encodeURIComponent(login.toLowerCase())}-320x180.jpg`
}

function TrendBadge({ pct, hasSignal }: { pct: number; hasSignal?: boolean }) {
  return (
    <MomentumBadge pct={pct} hasSignal={hasSignal} classPrefix="figma-live-rail__trend" />
  )
}

export function FigmaLiveChannelRail({ channels, colors = [], loading }: FigmaLiveChannelRailProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [atEnd, setAtEnd] = useState(true)
  const [fillsRow, setFillsRow] = useState(false)

  const updateEdges = useCallback(() => {
    const el = gridRef.current
    if (!el) return
    const maxScroll = el.scrollWidth - el.clientWidth
    const scrollable = maxScroll > 2
    setFillsRow(!scrollable)
    setAtEnd(!scrollable || el.scrollLeft >= maxScroll - 2)
  }, [])

  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    updateEdges()
    el.addEventListener('scroll', updateEdges, { passive: true })
    window.addEventListener('resize', updateEdges)
    return () => {
      el.removeEventListener('scroll', updateEdges)
      window.removeEventListener('resize', updateEdges)
    }
  }, [updateEdges, channels.length])

  if (loading && channels.length === 0) {
    return (
      <div className="figma-live-rail" aria-busy="true">
        <div className="figma-live-rail__grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="figma-live-rail__card" style={{ opacity: 0.4 }}>
              <div className="figma-live-rail__thumb" style={{ background: colors[i] ?? '#1e3a5f' }} />
              <div className="figma-live-rail__body"><strong>…</strong></div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (channels.length === 0) {
    return (
      <div className="figma-live-rail">
        <p className="muted">No channels live right now — search a channel to open analytics.</p>
      </div>
    )
  }

  return (
    <div className={`figma-live-rail${atEnd ? ' is-end' : ''}${fillsRow ? ' is-fill' : ''}`} aria-label="Hottest live channels">
      <div className="figma-live-rail__grid" ref={gridRef}>
        {channels.map((channel, index) => {
          const name = channel.displayName?.trim() || channel.login
          const href = buildAnalyticsHref({ login: channel.login, streamId: channel.streamId })
          const chat = channel.chatPerMin ?? 0
          const emotes = channel.emotesPerMin ?? 0
          const reason = hottestLiveReason(channel)
          return (
            <Link
              key={channel.login}
              to={href}
              className="figma-live-rail__card"
            >
              <div
                className="figma-live-rail__thumb"
                style={{ background: colors[index % colors.length] ?? RAIL_THUMB_FALLBACK }}
              >
                <img
                  className="figma-live-rail__preview"
                  src={twitchPreviewUrl(channel.login)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none'
                  }}
                />
                <span className="figma-live-rail__badge">#{index + 1}</span>
                <span className="figma-live-rail__viewers">
                  {(channel.viewers ?? 0) > 0 ? compact(channel.viewers) : '–'}
                </span>
              </div>
              <div className="figma-live-rail__body">
                <span className="figma-live-rail__identity">
                  <ResilientImage
                    src={channel.profileImageUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    fallback={
                      <span className="figma-live-rail__avatar-fallback" aria-hidden="true">
                        {name.slice(0, 2).toUpperCase()}
                      </span>
                    }
                  />
                  <strong>{name}</strong>
                </span>
                <span className="figma-live-rail__rates">
                  <span>{chat > 0 ? `${compact(Math.round(chat))} chat/m` : '— chat/m'}</span>
                  <span>{emotes > 0 ? `${compact(Math.round(emotes))} emotes/m` : '— emotes/m'}</span>
                </span>
                <span className="figma-live-rail__meta">
                  <span className="figma-live-rail__reason">{reason}</span>
                  <span title={channelCategoryLabel(channel.category)}>
                    {channelCategoryLabel(channel.category)}
                  </span>
                  {channel.streamingTogether ? <StreamTogetherBadge channel={channel} /> : null}
                  <TrendBadge pct={channel.trendPct} hasSignal={channel.trendSignal} />
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
