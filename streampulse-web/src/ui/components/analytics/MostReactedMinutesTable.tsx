import type { KeyboardEvent, MouseEvent, MutableRefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { momentRowKey, type FigmaMomentRow, buildVodTimestampUrl, formatOffsetLabel } from '../../../lib/figmaSessionAnalytics'
import type { HubEmote } from '../../../lib/publicHub'
import {
  formatMomentTableTime,
  isEmoteSpikeMoment,
  momentActivityBadge,
  momentEmoteRollupsEmptyHint,
  momentEmoteTitle,
  momentHasEmoteRollups,
  resolveMomentEmote,
} from '../../../lib/pulseMomentsUtils'
import type { HubLiveChannel } from '../../../lib/publicHub'
import { initial } from './hubFormat'
import {
  formatChatRate,
  formatChatRateCompact,
  formatReactionScore,
  formatViewerDelta,
  formatViewerDeltaCompact,
} from '../../../lib/momentMetricLabels'
import { EmoteImg } from './EmoteImg'
import { useCommandCenterLabels } from '../../providers/AnalyticsThemeProvider'

export interface MomentChannelContext {
  login?: string
  displayName?: string
  profileImageUrl?: string
  live?: boolean
}

export interface MostReactedMinutesTableProps {
  moments: FigmaMomentRow[]
  selectedKey?: string
  selectedOffset?: number
  onSelect?: (moment: FigmaMomentRow) => void
  variant?: 'default' | 'pulse-live'
  emoteLookup?: Map<string, HubEmote>
  channel?: MomentChannelContext
  vodId?: string
  plottedEmoteCode?: string
  liveLogins?: ReadonlySet<string>
  liveChannels?: Array<Pick<HubLiveChannel, 'login' | 'startedAt' | 'viewers'>>
  headerMeta?: string
}

function sevenTvEmoteUrl(name: string): string {
  return `https://7tv.app/emotes?query=${encodeURIComponent(name.trim())}`
}

function PeakEmoteImage({ src, name }: { src: string; name: string }) {
  return <EmoteImg src={src} name={name} />
}

function ChannelCell({
  moment,
  fallback,
  liveLogins,
  compact: compactLayout = false,
  showGame = true,
}: {
  moment: FigmaMomentRow
  fallback?: MomentChannelContext
  liveLogins?: ReadonlySet<string>
  compact?: boolean
  showGame?: boolean
}) {
  const login = moment.login ?? fallback?.login
  const displayName = moment.displayName?.trim() || fallback?.displayName || login
  const profileImageUrl = moment.profileImageUrl ?? fallback?.profileImageUrl
  const live = fallback?.live ?? (login ? liveLogins?.has(login.toLowerCase()) : false)
  if (!login && !displayName) return <span className="pulse-moments__channel-empty">—</span>
  const name = displayName?.trim() || login || ''
  const twitchHref = login ? `https://www.twitch.tv/${encodeURIComponent(login.toLowerCase())}` : undefined
  return (
    <span className={`pulse-moments__channel${compactLayout ? ' pulse-moments__channel--compact' : ''}`}>
      {profileImageUrl ? (
        <img src={profileImageUrl} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="pulse-moments__channel-fallback" aria-hidden="true">
          {initial(name)}
        </span>
      )}
      {live ? <span className="pulse-moments__channel-live-dot" aria-label="Live" title="Live now" /> : null}
      {twitchHref ? (
        <a
          className="pulse-moments__channel-name pulse-moments__channel-name--link"
          href={twitchHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          {name}
        </a>
      ) : (
        <span className="pulse-moments__channel-name">{name}</span>
      )}
      {(() => {
        if (!showGame) return null
        const game = moment.category?.trim()
        return game ? <small className="pulse-moments__channel-game muted">{game}</small> : null
      })()}
    </span>
  )
}

function rowKey(moment: FigmaMomentRow, useComposite: boolean): string {
  return useComposite ? momentRowKey(moment) : String(moment.offsetSeconds)
}

function isActive(moment: FigmaMomentRow, selectedKey: string | undefined, selectedOffset: number | undefined, useComposite: boolean): boolean {
  if (useComposite) return selectedKey === momentRowKey(moment)
  return selectedOffset === moment.offsetSeconds
}

function momentTopEmoteCode(moment: FigmaMomentRow): string {
  return moment.topEmotes?.[0]?.name?.trim() || moment.topEmoteCode?.trim() || ''
}

function MomentEmotesCell({
  moment,
  lookup,
}: {
  moment: FigmaMomentRow
  lookup?: Map<string, HubEmote>
}) {
  const rollups = (moment.topEmotes ?? []).filter((emote) => emote.name?.trim())
  if (rollups.length > 0) {
    return (
      <span className="pulse-moments__peak-emotes" aria-label="Top emotes this minute">
        {rollups.slice(0, 3).map((emote) => {
          const resolved = resolveMomentEmote(
            { ...moment, topEmotes: [emote], topEmoteCode: emote.name },
            lookup ?? new Map(),
          )
          if (!resolved) return null
          return (
            <a
              key={`${emote.provider ?? 'emote'}-${emote.name}`}
              className={`pulse-moments__peak-emote${resolved.imageUnavailable ? ' pulse-moments__peak-emote--text-only' : ''}`}
              href={sevenTvEmoteUrl(resolved.name)}
              target="_blank"
              rel="noopener noreferrer"
              title={`${momentEmoteTitle(resolved)} · Open on 7TV`}
              aria-label={`${resolved.name} on 7TV (opens in new tab)`}
              onClick={(event) => event.stopPropagation()}
            >
              {resolved.imageUrl ? (
                <PeakEmoteImage src={resolved.imageUrl} name={resolved.name} />
              ) : (
                <span aria-hidden="true">{initial(resolved.name)}</span>
              )}
            </a>
          )
        })}
      </span>
    )
  }

  if (isEmoteSpikeMoment(moment)) {
    return (
      <span className="pulse-moments__peak-emotes-empty" title={momentEmoteRollupsEmptyHint(moment)}>
        No emotes
      </span>
    )
  }

  return <span className="pulse-moments__peak-emotes-empty" aria-hidden="true">—</span>
}

function VodTimeCell({
  moment,
  vodId,
  onSelect,
  compact: compactLayout = false,
  timeLabel,
}: {
  moment: FigmaMomentRow
  vodId?: string
  onSelect?: (moment: FigmaMomentRow) => void
  compact?: boolean
  timeLabel?: string
}) {
  const resolvedVodId = moment.vodId ?? vodId
  const label = timeLabel ?? formatOffsetLabel(moment.offsetSeconds)
  const className = compactLayout ? 'pulse-moments__peak-time' : 'pulse-moments__vod-pill'
  if (resolvedVodId) {
    return (
      <a
        className={className}
        href={buildVodTimestampUrl(resolvedVodId, moment.offsetSeconds)}
        target="_blank"
        rel="noopener noreferrer"
        title={`Jump to VOD at ${label}`}
        onClick={(event) => {
          event.stopPropagation()
          onSelect?.(moment)
        }}
      >
        {label}
      </a>
    )
  }
  if (moment.href) {
    return (
      <Link
        className={className}
        to={moment.href}
        onClick={(event) => {
          event.stopPropagation()
          onSelect?.(moment)
        }}
      >
        {label}
      </Link>
    )
  }
  return (
    <button
      type="button"
      className={className}
      onClick={(event) => {
        event.stopPropagation()
        onSelect?.(moment)
      }}
    >
      {label}
    </button>
  )
}

function handlePulseRowClick(event: MouseEvent, moment: FigmaMomentRow, onSelect?: (moment: FigmaMomentRow) => void) {
  const target = event.target as HTMLElement
  if (target.closest('a, button')) return
  onSelect?.(moment)
}

function handlePulseRowKeyDown(
  event: KeyboardEvent,
  index: number,
  moments: FigmaMomentRow[],
  onSelect: ((moment: FigmaMomentRow) => void) | undefined,
  setFocusIndex: (index: number) => void,
  rowRefs: MutableRefObject<Array<HTMLDivElement | null>>,
) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    const next = Math.min(index + 1, moments.length - 1)
    setFocusIndex(next)
    rowRefs.current[next]?.focus({ preventScroll: true })
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    const prev = Math.max(index - 1, 0)
    setFocusIndex(prev)
    rowRefs.current[prev]?.focus({ preventScroll: true })
    return
  }
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  onSelect?.(moments[index]!)
}

function PulseLiveMomentList({
  moments,
  selectedKey,
  selectedOffset,
  onSelect,
  emoteLookup,
  channel,
  plottedEmoteCode,
  liveLogins,
  liveChannels = [],
  headerMeta,
}: MostReactedMinutesTableProps) {
  const labels = useCommandCenterLabels()
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  const [focusIndex, setFocusIndex] = useState(0)

  useEffect(() => {
    if (selectedKey) {
      const selectedIndex = moments.findIndex((moment) => momentRowKey(moment) === selectedKey)
      if (selectedIndex >= 0) setFocusIndex(selectedIndex)
      return
    }
    if (selectedOffset != null) {
      const selectedIndex = moments.findIndex((moment) => moment.offsetSeconds === selectedOffset)
      if (selectedIndex >= 0) setFocusIndex(selectedIndex)
    }
  }, [moments, selectedKey, selectedOffset])

  const headerDetail =
    headerMeta ??
    `${moments.length} moment${moments.length === 1 ? '' : 's'}`

  return (
    <section className="figma-panel pulse-moments__leaderboard pulse-moments__leaderboard--compact" aria-label="Pulse moments live">
      <header className="pulse-moments__table-head">
        <h3 id="pulse-moments-live-title">{labels.pulseMoments}</h3>
        <span>{headerDetail}</span>
      </header>
      <div className="pulse-moments__table-grid-wrap">
        <div className="pulse-moments__table-grid-head" aria-hidden="true">
          <span>#</span>
          <span>Channel</span>
          <span>Category</span>
          <span>Time</span>
          <span>Moment</span>
          <span>Chat</span>
          <span>Viewer Δ</span>
          <span>Emotes</span>
        </div>
        <div className="pulse-moments__peak-list" role="listbox" aria-label="Top live peaks">
          {moments.map((moment, index) => {
            const active = isActive(moment, selectedKey, selectedOffset, true)
            const emoteMatch =
              plottedEmoteCode &&
              momentTopEmoteCode(moment).toLowerCase() === plottedEmoteCode.trim().toLowerCase()
            const viewerDelta = formatViewerDelta(moment.viewerDelta)
            const viewerLabel = formatViewerDeltaCompact(moment.viewerDelta)
            const viewerTitle =
              viewerDelta !== '—' && !/no change/i.test(viewerDelta)
                ? viewerDelta
                : 'No minute-over-minute viewer change for this spike'
            const categoryLabel = moment.category?.trim() || '—'
            const badge = momentActivityBadge(moment)
            const timeLabel = formatMomentTableTime(moment, liveChannels)
            return (
              <div
                key={rowKey(moment, true)}
                ref={(node) => {
                  rowRefs.current[index] = node
                }}
                role="option"
                data-moment-row
                tabIndex={index === focusIndex ? 0 : -1}
                aria-selected={active}
                className={`pulse-moments__peak-row${active ? ' is-active' : ''}${emoteMatch ? ' is-emote-plotted' : ''}${momentHasEmoteRollups(moment) ? ' has-emotes' : ''}`}
                onClick={(event) => handlePulseRowClick(event, moment, onSelect)}
                onKeyDown={(event) => handlePulseRowKeyDown(event, index, moments, onSelect, setFocusIndex, rowRefs)}
                onFocus={() => setFocusIndex(index)}
              >
                <span className="pulse-moments__peak-rank">#{index + 1}</span>
                <ChannelCell moment={moment} fallback={channel} liveLogins={liveLogins} compact showGame={false} />
                <span className="pulse-moments__peak-category" title={categoryLabel}>
                  {categoryLabel}
                </span>
                <VodTimeCell moment={moment} vodId={moment.vodId} onSelect={onSelect} compact timeLabel={timeLabel} />
                <div className="pulse-moments__peak-moment">
                  <span className="pulse-moments__peak-label" title={moment.label}>
                    {moment.label}
                  </span>
                  {badge ? <span className="pulse-moments__peak-badge">{badge}</span> : null}
                </div>
                <span className="pulse-moments__peak-chat" title={formatChatRate(moment.chatPerMin)}>
                  {formatChatRateCompact(moment.chatPerMin)}
                </span>
                <span
                  className={`pulse-moments__peak-viewers${viewerLabel === '—' ? ' pulse-moments__peak-viewers--flat' : ''}`}
                  title={viewerTitle}
                >
                  {viewerLabel}
                </span>
                <MomentEmotesCell moment={moment} lookup={emoteLookup} />
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export function MostReactedMinutesTable({
  moments,
  selectedKey,
  selectedOffset,
  onSelect,
  variant = 'default',
  emoteLookup,
  channel,
  vodId,
  plottedEmoteCode,
  liveLogins,
  liveChannels,
  headerMeta,
}: MostReactedMinutesTableProps) {
  const isLive = variant === 'pulse-live'

  if (moments.length === 0) {
    return (
      <section
        className={`figma-panel figma-panel--table${isLive ? ' pulse-moments__table-panel' : ''}`}
        aria-label={isLive ? 'Pulse moments live' : 'Most reacted minutes'}
      >
        <header><h3>Most reacted minutes</h3></header>
        <p className="muted">No backend peaks yet. Coverage may still be warming.</p>
      </section>
    )
  }

  if (isLive) {
    return (
      <PulseLiveMomentList
        moments={moments}
        selectedKey={selectedKey}
        selectedOffset={selectedOffset}
        onSelect={onSelect}
        emoteLookup={emoteLookup}
        channel={channel}
        plottedEmoteCode={plottedEmoteCode}
        liveLogins={liveLogins}
        liveChannels={liveChannels}
        headerMeta={headerMeta}
      />
    )
  }

  return (
    <section className="figma-panel figma-panel--table" aria-label="Most reacted minutes">
      <header><h3>Most reacted minutes</h3></header>
      <table className="figma-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Score</th>
            <th>Signal</th>
            <th>Chat</th>
            <th>Δ viewers</th>
            <th>Top emote</th>
          </tr>
        </thead>
        <tbody>
          {moments.map((moment) => {
            const active = isActive(moment, selectedKey, selectedOffset, false)
            const emoteMatch =
              plottedEmoteCode &&
              momentTopEmoteCode(moment).toLowerCase() === plottedEmoteCode.trim().toLowerCase()
            const emote = resolveMomentEmote(moment, emoteLookup ?? new Map())
            const emoteName = emote?.name ?? moment.topEmoteCode ?? '—'
            return (
              <tr
                key={moment.offsetSeconds}
                className={`${active ? 'is-active' : ''}${emoteMatch ? ' is-emote-plotted' : ''}`.trim() || undefined}
              >
                <td>
                  <VodTimeCell moment={moment} vodId={vodId} onSelect={onSelect} />
                </td>
                <td>{formatReactionScore(moment.score)}</td>
                <td>{moment.label}</td>
                <td>{formatChatRate(moment.chatPerMin)}</td>
                <td>{formatViewerDelta(moment.viewerDelta)}</td>
                <td>
                  {emoteName !== '—' ? (
                    <a
                      className="pulse-moments__emote-chip pulse-moments__emote-chip--link pulse-moments__emote-chip--text-only"
                      href={sevenTvEmoteUrl(emoteName)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {emoteName}
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
