import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ChevronLeft, ChevronRight, MessageSquare, Radio, TrendingUp, Zap } from 'lucide-react'
import {
  compareMomentsChronologically,
  momentRowKey,
  type FigmaMomentRow,
  type LivePulseMomentsResult,
} from '../../../lib/figmaSessionAnalytics'
import {
  buildEmoteLookupFromMoments,
  enrichPulseMomentRows,
} from '../../../lib/pulseMomentRow'
import { resolveMomentEmote } from '../../../lib/pulseMomentsUtils'
import type { PublicHub, PublicHubActivityWindow, PublicHubLoadSource } from '../../../lib/publicHub'
import { useAnalyticsMotion } from '../../motion/useAnalyticsMotion'
import { compact, displayName } from './hubFormat'
import { EmoteImg } from './EmoteImg'
import { Avatar } from '../hub/primitives'

const VISIBLE_CAP_SECTION = 10
const VISIBLE_CAP_TICKER = 12
const DEDUPE_WINDOW_MS = 10 * 60 * 1000
const MAX_NEW_ANIMATIONS_PER_POLL = 3

const EMPTY_REASONS: Record<string, string> = {
  no_qualifying_session:
    'No live channel currently qualifies. StreamPulse needs IRC-tracked rooms with minute rollups and detected peaks.',
  store_unavailable:
    'Analytics store unavailable — featured moments need Postgres rollups.',
  stream_unavailable: 'The picked live stream could not be loaded.',
  rollup_unavailable:
    'Minute rollups are missing — IRC collector may still be warming up.',
  insufficient_peaks:
    'Rollups exist but no peaks were detected yet. Give the stream a few minutes of chat activity.',
}

export interface HubLiveWireFeedProps {
  hub: PublicHub
  feed: LivePulseMomentsResult
  activityWindow?: PublicHubActivityWindow
  loading?: boolean
  hubEndpointOk?: boolean
  loadSource?: PublicHubLoadSource
  layout?: 'section' | 'ticker'
  titleId?: string
}

function kindMeta(kind: string | undefined): { label: string; icon: ReactNode } {
  const normalized = (kind ?? '').trim().toLowerCase()
  if (normalized === 'chat' || normalized === 'chat_spike') {
    return { label: 'Chat spike', icon: <MessageSquare aria-hidden="true" /> }
  }
  if (
    normalized === 'emotes' ||
    normalized === 'emote' ||
    normalized === 'emote_spike' ||
    normalized === 'seventv'
  ) {
    return { label: 'Emote spike', icon: <TrendingUp aria-hidden="true" /> }
  }
  if (normalized === 'stream_opening') {
    return { label: 'Just went live', icon: <Zap aria-hidden="true" /> }
  }
  return { label: 'Peak', icon: <Activity aria-hidden="true" /> }
}

function relativeTime(at: number | undefined, now: number): string {
  if (at == null || !Number.isFinite(at) || at <= 0) return ''
  const ms = at > 1e12 ? at : at * 1000
  const deltaSec = Math.max(0, Math.round((now - ms) / 1000))
  if (deltaSec < 60) return `${deltaSec}s ago`
  const min = Math.round(deltaSec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.round(hr / 24)}d ago`
}

function strongestMetric(moment: FigmaMomentRow): string | null {
  const emotes = moment.emotesPerMin
  const chat = moment.chatPerMin
  if (emotes != null && emotes > 0 && (chat == null || emotes >= chat)) {
    return `${compact(emotes)} emotes/m`
  }
  if (chat != null && chat > 0) {
    return `${compact(chat)} chat/m`
  }
  return null
}

/** Feed detail for ticker chips — avoid duplicating the emote-velocity leaderboard. */
function chipFeedDetail(moment: FigmaMomentRow): string | null {
  const normalized = (moment.kind ?? '').trim().toLowerCase()
  if (normalized === 'stream_opening') {
    if (moment.viewers != null && moment.viewers > 0) {
      return `${compact(moment.viewers)} viewers`
    }
    return 'Now live'
  }
  if (normalized === 'chat' || normalized === 'chat_spike') {
    if (moment.chatPerMin != null && moment.chatPerMin > 0) {
      return `${compact(moment.chatPerMin)} chat/m`
    }
    return moment.label?.trim() || null
  }
  if (
    normalized === 'emotes' ||
    normalized === 'emote' ||
    normalized === 'emote_spike' ||
    normalized === 'seventv'
  ) {
    const top = moment.topEmotes?.[0]
    if (top?.name?.trim()) {
      const count =
        top.count != null && top.count > 0 ? ` · ${compact(top.count)}` : ''
      return `${top.name.trim()}${count}`
    }
    const label = moment.label?.trim()
    if (label && !/^emote/i.test(label)) return label
    if (moment.viewers != null && moment.viewers > 0) {
      return `${compact(moment.viewers)} viewers`
    }
    return null
  }
  return moment.label?.trim() || strongestMetric(moment)
}

function dedupeMomentsByLogin(moments: FigmaMomentRow[], cap: number): FigmaMomentRow[] {
  const kept: FigmaMomentRow[] = []
  const lastAtByLogin = new Map<string, number>()

  for (const moment of moments) {
    const login = moment.login?.trim().toLowerCase() ?? ''
    const at = moment.at ?? 0
    if (login) {
      const lastAt = lastAtByLogin.get(login)
      if (lastAt != null && Math.abs(lastAt - at) < DEDUPE_WINDOW_MS) {
        continue
      }
      lastAtByLogin.set(login, at)
    }
    kept.push(moment)
    if (kept.length >= cap) break
  }

  return kept
}

function collectFreshKeys(
  moments: FigmaMomentRow[],
  prevSeen: Set<string>,
  maxCount: number,
): Set<string> {
  const fresh = new Set<string>()
  let animCount = 0
  for (const moment of moments) {
    const key = momentRowKey(moment)
    if (!prevSeen.has(key) && animCount < maxCount) {
      fresh.add(key)
      animCount += 1
    }
  }
  return fresh
}

interface WireHeaderProps {
  titleId: string
  metaLabel: string
}

function WireHeader({ titleId, metaLabel }: WireHeaderProps) {
  return (
    <header className="hub-live-wire__head">
      <h2 id={titleId} className="hub-live-wire__title">
        <Radio aria-hidden="true" />
        Live wire
      </h2>
      <span className="hub-live-wire__meta">{metaLabel}</span>
    </header>
  )
}

interface LiveWireTickerScrollerProps {
  children: ReactNode
}

function LiveWireTickerScroller({ children }: LiveWireTickerScrollerProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(false)

  const updateButtons = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    setCanPrev(viewport.scrollLeft > 2)
    setCanNext(viewport.scrollLeft < viewport.scrollWidth - viewport.clientWidth - 2)
  }, [])

  const step = useCallback((multiplier: number) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const chip = viewport.querySelector<HTMLElement>('.hub-live-wire__chip')
    const distance = chip ? chip.getBoundingClientRect().width + 8 : 240
    viewport.scrollBy({ left: distance * multiplier, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    updateButtons()
  }, [children, updateButtons])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => updateButtons())
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [updateButtons])

  return (
    <div className="hub-live-wire__ticker-scroller">
      <button
        type="button"
        className="hub-live-wire__ticker-nav hub-live-wire__ticker-nav--prev"
        aria-label="Scroll live wire left"
        onClick={() => step(-1.5)}
        disabled={!canPrev}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <div
        className="hub-live-wire__ticker-viewport"
        ref={viewportRef}
        onScroll={updateButtons}
        tabIndex={0}
        role="region"
        aria-label="Live wire events"
      >
        <div className="hub-live-wire__ticker-track">{children}</div>
      </div>
      <button
        type="button"
        className="hub-live-wire__ticker-nav hub-live-wire__ticker-nav--next"
        aria-label="Scroll live wire right"
        onClick={() => step(1.5)}
        disabled={!canNext}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

export function HubLiveWireFeed({
  hub,
  feed,
  activityWindow = '24h',
  loading,
  hubEndpointOk = true,
  loadSource = 'full',
  layout = 'section',
  titleId = 'hub-live-wire-title',
}: HubLiveWireFeedProps) {
  const isTicker = layout === 'ticker'
  const visibleCap = isTicker ? VISIBLE_CAP_TICKER : VISIBLE_CAP_SECTION
  const { animateEnter, animateEnterHorizontal, motionEnabled } = useAnalyticsMotion()
  const hubDegraded = loadSource === 'stats-fallback' || hubEndpointOk === false
  const isLiveNetwork = feed.source === 'network' && !hubDegraded
  const prevSeenRef = useRef<Set<string>>(new Set())
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map())
  const [now, setNow] = useState(() => Date.now())
  const [activeNewKeys, setActiveNewKeys] = useState<Set<string>>(new Set())

  const profileImageByLogin = useMemo(() => {
    const map = new Map<string, string>()
    for (const ch of hub.liveChannels) {
      if (ch.profileImageUrl) {
        map.set(ch.login.toLowerCase(), ch.profileImageUrl)
      }
    }
    return map
  }, [hub.liveChannels])

  const categoryByLogin = useMemo(() => {
    const map = new Map<string, string>()
    for (const ch of hub.liveChannels) {
      const category = ch.category?.trim()
      if (category) map.set(ch.login.toLowerCase(), category)
    }
    return map
  }, [hub.liveChannels])

  const enrichCtx = useMemo(
    () => ({ liveChannels: hub.liveChannels, categoryByLogin }),
    [categoryByLogin, hub.liveChannels],
  )

  const visibleMoments = useMemo(() => {
    const enriched = enrichPulseMomentRows(feed.moments, enrichCtx)
    const sorted = [...enriched].sort(compareMomentsChronologically)
    return dedupeMomentsByLogin(sorted, visibleCap)
  }, [enrichCtx, feed.moments, visibleCap])

  const emoteLookup = useMemo(
    () => buildEmoteLookupFromMoments(visibleMoments, hub.topEmotes),
    [hub.topEmotes, visibleMoments],
  )

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useLayoutEffect(() => {
    if (!isLiveNetwork || !motionEnabled) {
      prevSeenRef.current = new Set(visibleMoments.map(momentRowKey))
      setActiveNewKeys(new Set())
      return
    }

    const freshKeys = collectFreshKeys(
      visibleMoments,
      prevSeenRef.current,
      MAX_NEW_ANIMATIONS_PER_POLL,
    )

    setActiveNewKeys(freshKeys)
    const animate = isTicker ? animateEnterHorizontal : animateEnter
    for (const key of freshKeys) {
      const el = rowRefs.current.get(key)
      if (el) animate(el)
    }

    prevSeenRef.current = new Set(visibleMoments.map(momentRowKey))
  }, [animateEnter, animateEnterHorizontal, isLiveNetwork, isTicker, motionEnabled, visibleMoments])

  const metaLabel = isLiveNetwork
    ? 'network peaks · newest first'
    : hubDegraded
      ? 'hub unavailable — live network feed paused'
      : 'snapshot — not live network cadence'
  const emptyReason = hubDegraded
    ? 'Public hub is unavailable on this backend — Live Wire needs `/v1/public/hub` minute rollups and network peaks.'
    : (feed.reason && EMPTY_REASONS[feed.reason]) ||
      'No network peaks detected in the tracking pool yet. Moments appear as IRC rollups find chat and emote spikes.'

  const renderChip = (moment: FigmaMomentRow) => {
    const key = momentRowKey(moment)
    const login = moment.login ?? ''
    const name = displayName(login, moment.displayName)
    const meta = kindMeta(moment.kind)
    const detail = chipFeedDetail(moment)
    const timeLabel = relativeTime(moment.at, now)
    const isNew = isLiveNetwork && activeNewKeys.has(key)
    const href = moment.href ?? (login ? `/analytics/${encodeURIComponent(login)}` : '#')
    const profileImageUrl =
      moment.profileImageUrl ?? profileImageByLogin.get(login.toLowerCase())
    const showEmoteThumb =
      (moment.topEmotes?.length ?? 0) > 0 &&
      !(detail?.includes(moment.topEmotes?.[0]?.name?.trim() ?? ''))

    return (
      <Link
        key={key}
        to={href}
        className={`hub-live-wire__chip${isNew ? ' hub-live-wire__chip--new' : ''}`}
        ref={(el) => {
          if (el) rowRefs.current.set(key, el)
          else rowRefs.current.delete(key)
        }}
      >
        <span className="hub-live-wire__chip-kind" aria-hidden="true">
          {meta.icon}
        </span>
        {timeLabel ? (
          <span className="hub-live-wire__chip-time">{timeLabel}</span>
        ) : null}
        <Avatar
          login={login}
          src={profileImageUrl}
          alt=""
          className="hub-live-wire__chip-av"
        />
        <span className="hub-live-wire__chip-event">{meta.label}</span>
        <span className="hub-live-wire__chip-sep" aria-hidden="true">
          ·
        </span>
        <span className="hub-live-wire__chip-name">{name}</span>
        {detail ? (
          <>
            <span className="hub-live-wire__chip-sep" aria-hidden="true">
              ·
            </span>
            <span className="hub-live-wire__chip-detail">{detail}</span>
          </>
        ) : null}
        {showEmoteThumb ? (
          <span className="hub-live-wire__chip-emotes" aria-hidden="true">
            {(moment.topEmotes ?? []).slice(0, 1).map((emote, index) => {
              const resolved = resolveMomentEmote(
                { ...moment, topEmotes: [emote] },
                emoteLookup,
              )
              return (
                <span className="hub-live-wire__chip-emote" key={`${emote.name}-${index}`}>
                  <EmoteImg
                    src={resolved?.imageUrl ?? emote.imageUrl}
                    name={emote.name ?? '?'}
                  />
                </span>
              )
            })}
          </span>
        ) : null}
        {isNew ? <span className="hub-live-wire__chip-new">NEW</span> : null}
      </Link>
    )
  }

  const rootClass = `hub-live-wire${isTicker ? ' hub-live-wire--ticker' : ''}`

  if (loading && visibleMoments.length === 0) {
    if (isTicker) {
      return (
        <section className={rootClass} aria-labelledby={titleId} aria-busy="true">
          <WireHeader titleId={titleId} metaLabel={metaLabel} />
          <LiveWireTickerScroller>
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="hub-live-wire__chip hub-live-wire__chip--skeleton"
                aria-hidden="true"
              />
            ))}
          </LiveWireTickerScroller>
        </section>
      )
    }

    return (
      <section className={rootClass} aria-labelledby={titleId} aria-busy="true">
        <WireHeader titleId={titleId} metaLabel={metaLabel} />
        <div className="hub-live-wire__list">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="hub-live-wire__card hub-live-wire__card--skeleton" aria-hidden="true" />
          ))}
        </div>
      </section>
    )
  }

  if (isTicker) {
    return (
      <section className={rootClass} aria-labelledby={titleId}>
        <WireHeader titleId={titleId} metaLabel={metaLabel} />

        {hubDegraded ? (
          <p className="hub-live-wire__banner hub-live-wire__banner--warn" role="status">
            Showing aggregate stats only — network live moments require a healthy public hub endpoint.
          </p>
        ) : null}

        {!hubDegraded && !isLiveNetwork && feed.banner ? (
          <p className="hub-live-wire__banner" role="status">
            {feed.banner}
          </p>
        ) : null}

        {visibleMoments.length === 0 ? (
          <div className="hub-live-wire__empty hub-live-wire__empty--ticker" role="status">
            <Activity aria-hidden="true" />
            <span>{emptyReason}</span>
          </div>
        ) : (
          <LiveWireTickerScroller>
            {visibleMoments.map((moment) => renderChip(moment))}
          </LiveWireTickerScroller>
        )}
      </section>
    )
  }

  return (
    <section className={rootClass} aria-labelledby={titleId}>
      <WireHeader titleId={titleId} metaLabel={metaLabel} />

      {hubDegraded ? (
        <p className="hub-live-wire__banner hub-live-wire__banner--warn" role="status">
          Showing aggregate stats only — network live moments require a healthy public hub endpoint.
        </p>
      ) : null}

      {!hubDegraded && !isLiveNetwork && feed.banner ? (
        <p className="hub-live-wire__banner" role="status">
          {feed.banner}
        </p>
      ) : null}

      {visibleMoments.length === 0 ? (
        <div className="hub-live-wire__empty" role="status">
          <Activity aria-hidden="true" />
          <span>{emptyReason}</span>
        </div>
      ) : (
        <ul className="hub-live-wire__list">
          {visibleMoments.map((moment) => {
            const key = momentRowKey(moment)
            const login = moment.login ?? ''
            const name = displayName(login, moment.displayName)
            const category = moment.category?.trim()
            const meta = kindMeta(moment.kind)
            const metric = strongestMetric(moment)
            const isNew = isLiveNetwork && activeNewKeys.has(key)
            const href = moment.href ?? (login ? `/analytics/${encodeURIComponent(login)}` : '#')

            return (
              <li key={key}>
                <Link
                  to={href}
                  className={`hub-live-wire__card${isNew ? ' hub-live-wire__card--new' : ''}`}
                  ref={(el) => {
                    if (el) rowRefs.current.set(key, el)
                    else rowRefs.current.delete(key)
                  }}
                >
                  <span className="hub-live-wire__kind">
                    {meta.icon}
                    {meta.label}
                  </span>
                  {isNew ? <span className="hub-live-wire__new-badge">NEW</span> : null}
                  <span className="hub-live-wire__channel">
                    <Avatar login={login} src={moment.profileImageUrl} alt="" />
                    <span className="hub-live-wire__channel-text">
                      <span className="hub-live-wire__name">{name}</span>
                      {category ? (
                        <span className="hub-live-wire__category">{category}</span>
                      ) : null}
                    </span>
                  </span>
                  <span className="hub-live-wire__headline">
                    {moment.label}
                    {metric ? <span className="hub-live-wire__metric"> · {metric}</span> : null}
                  </span>
                  {(moment.topEmotes?.length ?? 0) > 0 ? (
                    <span className="hub-live-wire__emotes" aria-label="Top emotes">
                      {(moment.topEmotes ?? []).slice(0, 3).map((emote, index) => {
                        const resolved = resolveMomentEmote(
                          { ...moment, topEmotes: [emote] },
                          emoteLookup,
                        )
                        return (
                          <span
                            className="hub-live-wire__emote"
                            key={`${emote.name}-${index}`}
                          >
                            <EmoteImg
                              src={resolved?.imageUrl ?? emote.imageUrl}
                              name={emote.name ?? '?'}
                            />
                          </span>
                        )
                      })}
                    </span>
                  ) : null}
                  <span className="hub-live-wire__time">{relativeTime(moment.at, now)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
