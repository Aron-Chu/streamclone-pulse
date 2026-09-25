import { useMemo, useState } from 'react'
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
}: {
  login: string
  streams: AnalyticsStream[]
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

  return (
    <div className="flex min-h-0 w-full flex-col overflow-hidden rounded border border-white/10 bg-white/[0.035] xl:max-h-[calc(100vh-12rem)]">
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
      <div className="sc-console-scroll min-h-0 flex-1 overflow-y-auto">
        {!hasListedLiveSession ? (
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
        {streams.length === 0 ? (
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
              const mobileHiddenClass = !archiveExpanded && rowIndex >= MOBILE_COLLAPSED_ROWS ? 'hidden lg:block' : ''
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
        {hasCollapsibleRows ? (
          <button
            type="button"
            onClick={() => setArchiveExpanded((prev) => !prev)}
            aria-expanded={archiveExpanded}
            className="block w-full border-t border-white/10 px-3 py-2 text-center text-xs font-black uppercase tracking-wide text-zinc-400 transition hover:bg-white/[0.05] hover:text-white lg:hidden"
          >
            {archiveExpanded ? 'Show fewer streams' : `Show all ${visibleStreams.length} streams`}
          </button>
        ) : null}
      </div>
    </div>
  )
}
