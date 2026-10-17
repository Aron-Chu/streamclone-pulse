import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AnalyticsStream } from '../../apiTypes.ts'
import {
  streamIsSidebarVisible,
  analyticsStreamPathSlug,
  streamSyncBadgeState,
  streamSyncBadgeLabel,
  streamSyncBadgeTitle,
  type StreamSyncEvidence,
} from '../../utils/syncedLiveStream.ts'
import { count, displayStreamTitle, duration, formatDateTime, getLocalDateString } from '../../utils/consoleFormat.ts'
import { CoreMinuteChartsNotice } from '../CoreMinuteChartsNotice.tsx'
import { useEdgeFade } from '../../hooks/useSessionColumnFill.ts'

const EDGE_FADE_PX = 24

export function StreamSidebar({
  login,
  streams,
  activeID,
  isLiveView,
  liveState,
  liveStreamId,
  syncing,
  syncedOnly,
  onSyncedOnlyChange,
  coreMinuteChartsBlocked = false,
  activeRollupStats,
  activeSyncEvidence,
  activeMinutesUnavailable = false,
  buildSessionPath,
  buildChannelPath,
  liveSessionPath,
  loading = false,
  loadFailed = false,
  retrying = false,
  onRetry,
  showLiveRow = true,
}: {
  login: string
  streams: AnalyticsStream[]
  /** The first stream list request is in flight; a later poll of a failed list keeps the failure shown. */
  loading?: boolean
  /** The stream list request failed and nothing is loaded; never shown as an empty channel. */
  loadFailed?: boolean
  /** A list request is in flight; the retry stays in place but cannot restart it. */
  retrying?: boolean
  onRetry?: () => void
  /**
   * The "Live session" / "Latest indexed session" row above the list. The
   * d3-v2 session page turns it off (owner switch `sidebarLiveRow`).
   */
  showLiveRow?: boolean
  activeID?: string
  isLiveView: boolean
  liveState?: string
  liveStreamId?: string
  liveSessionPath?: string
  syncing?: boolean
  syncedOnly?: boolean
  onSyncedOnlyChange?: (value: boolean) => void
  coreMinuteChartsBlocked?: boolean
  activeRollupStats?: { avg: number; peak: number; current: number } | null
  activeSyncEvidence?: StreamSyncEvidence
  activeMinutesUnavailable?: boolean
  buildSessionPath: (login: string, streamId: string) => string
  buildChannelPath: (login: string) => string
}) {
  const visibleStreams = useMemo(() => {
    return streams.filter((s) => streamIsSidebarVisible(s, Boolean(syncedOnly)))
  }, [streams, syncedOnly])

  const [archiveExpanded, setArchiveExpanded] = useState(false)
  const MOBILE_COLLAPSED_ROWS = 2
  const hasCollapsibleRows = visibleStreams.length > MOBILE_COLLAPSED_ROWS
  const hasListedLiveSession = Boolean(
    liveStreamId && visibleStreams.some((stream) => stream.streamId === liveStreamId),
  )
  const fadeRef = useEdgeFade<HTMLDivElement>(EDGE_FADE_PX)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const setScroller = (el: HTMLDivElement | null) => {
    scrollerRef.current = el
    fadeRef(el)
  }
  const hasActiveRow = !isLiveView && Boolean(activeID)
  // The current stream's row starts in view when the list scrolls (from 1280 px
  // every row shows in a capped box): centred when it was out of view, clear of
  // the edge fades. The window itself never scrolls for it (MOCK slReveal).
  // Measured in the frame before its paint, not in React's commit, where the
  // read forced the page's layout into that task (mobile TBT, PR #122 bench).
  useLayoutEffect(() => {
    const sc = scrollerRef.current
    if (!sc || !hasActiveRow) return
    const frame = requestAnimationFrame(() => {
      if (sc.scrollHeight <= sc.clientHeight + 1) return
      const row = sc.querySelector<HTMLElement>('[aria-current="page"]')
      if (!row || row.offsetParent === null) return
      const sb = sc.getBoundingClientRect()
      const rb = row.getBoundingClientRect()
      let top = Math.max(sb.top, 0)
      let bottom = Math.min(sb.bottom, window.innerHeight)
      if (bottom - top < rb.height + 2 * EDGE_FADE_PX) {
        top = sb.top
        bottom = sb.bottom
      }
      if (rb.top >= top + (sc.scrollTop > 0 ? EDGE_FADE_PX : 0) && rb.bottom <= bottom - EDGE_FADE_PX) return
      sc.scrollTop += rb.top - top - Math.max(0, (bottom - top - rb.height) / 2)
    })
    return () => cancelAnimationFrame(frame)
  }, [hasActiveRow, activeID, visibleStreams.length])

  return (
    <div className="ssp-sl flex min-h-0 w-full flex-col overflow-hidden rounded border border-white/10 bg-white/[0.035]" data-stream-list>
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
        <span className="text-xs font-black uppercase tracking-wide text-zinc-500">Streams</span>
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs font-black text-zinc-400">
          {visibleStreams.length}
          {syncedOnly ? `/${streams.length}` : ''}
        </span>
      </div>
      {onSyncedOnlyChange ? (
        <label className="flex cursor-pointer items-center gap-2 border-b border-white/5 px-3 py-2 text-xs font-semibold text-zinc-400">
          <input
            type="checkbox"
            checked={Boolean(syncedOnly)}
            onChange={(e) => onSyncedOnlyChange(e.target.checked)}
            className="accent-violet-500"
          />
          Synced only (hide stats-only rows)
        </label>
      ) : null}
      <div ref={setScroller} className="ssp-sl-sc sc-console-scroll min-h-0 flex-1 overflow-y-auto">
        {showLiveRow && !hasListedLiveSession ? (
          <Link
            to={liveSessionPath ?? buildChannelPath(login)}
            data-live-current-row
            className={`sc-stream-row block border-b border-white/5 px-3 py-2.5 transition hover:bg-white/[0.05] ${
              isLiveView ? 'border-l-2 border-l-red-400 bg-red-500/10' : 'border-l-2 border-l-transparent'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${liveState === 'live' ? 'bg-red-400 animate-pulse' : 'bg-zinc-600'}`} />
              <span className="text-sm font-black text-white">
                {liveState === 'live' ? 'Live session' : 'Latest indexed session'}
              </span>
            </div>
            <div className="mt-1 text-xs font-semibold text-zinc-500">
              {liveState === 'live' ? 'Live tracking' : 'No live session confirmed'}
            </div>
          </Link>
        ) : null}
        {streams.length === 0 && loading ? (
          <div role="status" className="px-3 py-4 text-center text-xs font-semibold text-zinc-500">
            Loading streams…
          </div>
        ) : streams.length === 0 && loadFailed ? (
          <div role="alert" className="px-3 py-4 text-center text-xs font-semibold text-zinc-500">
            Couldn&apos;t load streams.
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                disabled={retrying}
                className="mx-auto mt-2 block min-h-11 rounded border border-white/15 bg-white/[0.05] px-3 py-2 text-xs font-black uppercase text-zinc-200 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-50"
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : streams.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs font-semibold text-zinc-500">
            No past streams indexed yet.
          </div>
        ) : visibleStreams.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs font-semibold text-zinc-500">
            No synced streams match this filter. Turn off &quot;Synced only&quot; to see stats-only sessions.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {visibleStreams.map((stream, rowIndex) => {
              const streamTitle = displayStreamTitle(stream, login, [`${login} / ${getLocalDateString(stream.startedAt) || 'session'}`])
              const targetSlug = analyticsStreamPathSlug(stream, streams)
              const dateSlug = targetSlug !== stream.streamId ? targetSlug : ''
              const isActive = !isLiveView && (activeID === stream.streamId || activeID === dateSlug || activeID === targetSlug)
              const syncBadge = streamSyncBadgeState(
                stream,
                Boolean(syncing && isActive),
                isActive ? activeSyncEvidence : undefined,
              )
              const isSyncingActive = syncBadge === 'syncing'
              const rollupStats = isSyncingActive ? activeRollupStats : null
              // The current stream's row stays in view while the list is collapsed (MOCK).
              const mobileHiddenClass = !archiveExpanded && !isActive && rowIndex >= MOBILE_COLLAPSED_ROWS ? 'hidden xl:block' : ''
              const badgeTone =
                syncBadge === 'syncing'
                  ? 'bg-violet-500/10 text-violet-300'
                  : syncBadge === 'synced'
                    ? 'bg-emerald-500/10 text-emerald-300'
                    : syncBadge === 'partial'
                      ? 'bg-amber-500/10 text-amber-300'
                  : syncBadge === 'unknown'
                    ? 'bg-white/[0.06] text-zinc-400'
                    : 'bg-amber-500/10 text-amber-300'

              return (
                <Link
                  key={stream.streamId}
                  to={buildSessionPath(login, targetSlug)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`sc-stream-row block border-l-2 px-3 py-2.5 transition hover:bg-white/[0.05] ${mobileHiddenClass} ${
                    isActive ? 'border-l-cyan-400 bg-cyan-400/10' : 'border-l-transparent'
                  }`}
                >
                  <div className="text-xs font-black uppercase tracking-wide text-zinc-500">
                    {formatDateTime(stream.startedAt)}
                  </div>
                  <div
                    className="sc-stream-row__title mt-0.5 text-[13px] font-bold leading-snug text-white"
                    title={streamTitle}
                  >
                    {streamTitle}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {(stream.gamesSummary || stream.category) ? (
                      <span
                        className="min-w-0 max-w-full rounded bg-violet-500/15 px-1.5 py-0.5 text-xs font-black uppercase text-violet-200"
                        title={`Games played: ${stream.gamesSummary || stream.category}`}
                      >
                        <span className="mr-1 text-violet-300/70">Games played:</span>
                        <span className="whitespace-normal break-words">{stream.gamesSummary || stream.category}</span>
                      </span>
                    ) : null}
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-black uppercase ${badgeTone}`}
                      title={streamSyncBadgeTitle(syncBadge, stream)}
                    >
                      {streamSyncBadgeLabel(syncBadge)}
                    </span>
                  </div>
                  {isActive && activeMinutesUnavailable ? (
                    <p className="mt-1.5 text-xs font-semibold leading-snug text-amber-200/80">
                      Session metadata synced; minute chart unavailable — try refresh or pick another session.
                    </p>
                  ) : null}
                  {syncBadge === 'stats_only' && isActive && coreMinuteChartsBlocked ? (
                    <div className="mt-1.5">
                      <CoreMinuteChartsNotice />
                    </div>
                  ) : null}
                  {(() => {
                    // Omit a metric the list response does not carry instead of printing "-".
                    const facts = [
                      { key: 'measured', text: `measured ${duration(stream)}`, missing: duration(stream) === '-', title: 'Measured span, not broadcast duration' },
                      { key: 'avg', text: `avg ${count(rollupStats?.avg ?? stream.avgViewers)}`, missing: count(rollupStats?.avg ?? stream.avgViewers) === '-' },
                      { key: 'peak', text: `peak ${count(rollupStats?.peak ?? stream.peakViewers)}`, missing: count(rollupStats?.peak ?? stream.peakViewers) === '-' },
                    ].filter(fact => !fact.missing)
                    return facts.length ? <div className="mt-1.5 grid grid-cols-3 gap-1 text-xs font-bold text-zinc-500">
                      {facts.map(fact => <span key={fact.key} title={fact.title}>{fact.text}</span>)}
                    </div> : null
                  })()}
                </Link>
              )
            })}
          </div>
        )}
      </div>
      {hasCollapsibleRows ? (
        <button
          type="button"
          onClick={() => setArchiveExpanded((prev) => !prev)}
          aria-expanded={archiveExpanded}
          className="ssp-sl-more block w-full shrink-0 border-t border-white/10 px-3 py-2 text-center text-xs font-black uppercase tracking-wide text-zinc-400 transition hover:bg-white/[0.05] hover:text-white xl:hidden"
        >
          {archiveExpanded ? 'Show fewer streams' : `Show all ${visibleStreams.length} streams`}
        </button>
      ) : null}
    </div>
  )
}
