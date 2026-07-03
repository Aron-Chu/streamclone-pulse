import type { KeyboardEvent, MouseEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { momentRowKey, type FigmaMomentRow, buildVodTimestampUrl, formatOffsetLabel } from '../../../lib/figmaSessionAnalytics'
import type { HubEmote } from '../../../lib/publicHub'
import {
  confidenceTone,
  isEmoteSpikeMoment,
  momentContextParts,
  momentEmoteRollupsEmptyHint,
  momentEmoteTitle,
  momentHasEmoteRollups,
  resolveMomentEmote,
} from '../../../lib/pulseMomentsUtils'
import { compact, initial } from './hubFormat'
import { formatChatRate, formatReactionScore, formatViewerDelta } from '../../../lib/momentMetricLabels'

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
}

function sevenTvEmoteUrl(name: string): string {
  return `https://7tv.app/emotes?query=${encodeURIComponent(name.trim())}`
}

function PeakEmoteImage({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <span aria-hidden="true">{initial(name)}</span>
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}

function ChannelCell({
  moment,
  fallback,
  liveLogins,
  compact: compactLayout = false,
}: {
  moment: FigmaMomentRow
  fallback?: MomentChannelContext
  liveLogins?: ReadonlySet<string>
  compact?: boolean
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
}: {
  moment: FigmaMomentRow
  vodId?: string
  onSelect?: (moment: FigmaMomentRow) => void
  compact?: boolean
}) {
  const resolvedVodId = moment.vodId ?? vodId
  const label = formatOffsetLabel(moment.offsetSeconds)
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
) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    const next = Math.min(index + 1, moments.length - 1)
    setFocusIndex(next)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    const prev = Math.max(index - 1, 0)
    setFocusIndex(prev)
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
}: MostReactedMinutesTableProps) {
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

  useEffect(() => {
    rowRefs.current[focusIndex]?.focus()
  }, [focusIndex])

  return (
    <section className="figma-panel pulse-moments__leaderboard pulse-moments__leaderboard--compact" aria-label="Pulse moments live">
      <header className="pulse-moments__table-head">
        <h3>Most reacted minutes</h3>
        <span>{moments.length} live peak{moments.length === 1 ? '' : 's'}</span>
      </header>
      <div className="pulse-moments__peak-list" role="listbox" aria-label="Top live peaks">
        {moments.map((moment, index) => {
          const active = isActive(moment, selectedKey, selectedOffset, true)
          const confidenceClass = confidenceTone(moment.confidence)
          const emoteMatch =
            plottedEmoteCode &&
            momentTopEmoteCode(moment).toLowerCase() === plottedEmoteCode.trim().toLowerCase()
          const context = momentContextParts(moment).join(' · ')
          return (
            <div
              key={rowKey(moment, true)}
              ref={(node) => {
                rowRefs.current[index] = node
              }}
              role="option"
              tabIndex={index === focusIndex ? 0 : -1}
              aria-selected={active}
              className={`pulse-moments__peak-row${active ? ' is-active' : ''}${emoteMatch ? ' is-emote-plotted' : ''}${momentHasEmoteRollups(moment) ? ' has-emotes' : ''}`}
              onClick={(event) => handlePulseRowClick(event, moment, onSelect)}
              onKeyDown={(event) => handlePulseRowKeyDown(event, index, moments, onSelect, setFocusIndex)}
              onFocus={() => setFocusIndex(index)}
            >
              <span className="pulse-moments__peak-rank">#{index + 1}</span>
              <ChannelCell moment={moment} fallback={channel} liveLogins={liveLogins} compact />
              <div className="pulse-moments__peak-main">
                <div className="pulse-moments__peak-line">
                  <VodTimeCell moment={moment} vodId={moment.vodId} onSelect={onSelect} compact />
                  <span className="pulse-moments__peak-label" title={moment.label}>
                    {moment.label}
                  </span>
                </div>
                <div className="pulse-moments__peak-meta">
                  <span>{formatChatRate(moment.chatPerMin)}</span>
                  {formatViewerDelta(moment.viewerDelta) !== '—' ? (
                    <span className="pulse-moments__peak-meta-up">{formatViewerDelta(moment.viewerDelta)}</span>
                  ) : null}
                  {context ? (
                    <span className={`pulse-moments__peak-context pulse-moments__peak-context--${confidenceClass}`}>
                      {context}
                    </span>
                  ) : null}
                </div>
              </div>
              <MomentEmotesCell moment={moment} lookup={emoteLookup} />
            </div>
          )
        })}
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
