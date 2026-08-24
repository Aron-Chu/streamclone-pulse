import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  formatHeatOffset,
  peaksToLiveHeatPoints,
  type LiveHeatPoint,
} from '@streampulse/pulse-core'
import type {
  ExtensionEmote,
  ExtensionGameSegment,
  ExtensionPeak,
  ExtensionRollup,
  PulsePayload,
  PulseRecapMoment,
  PulseStreamRecap,
} from '../shared/messages.ts'
import { lastStreamPeakStats } from './lastStreamSummary.ts'
import { GamesPlayedStrip, type GamesPlayedVisibleRange } from './GamesPlayedStrip.tsx'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { RecapAnalyticsNav } from './RecapAnalyticsNav.tsx'
import { RecapSkeleton } from './RecapSkeleton.tsx'
import { RecapTimelineChart } from './RecapTimelineChart.tsx'
import { RecapTopEmotesRow } from './RecapTopEmotesRow.tsx'
import {
  mergeRecapMoments,
  recapChatSpikeToHeatPoint,
  recapEmoteBurstToHeatPoint,
  recapMomentSelectionKey,
  resolveRecapChartPeakOffsets,
  recapStreamDurationSeconds,
} from './recapChartPeaks.ts'
import { buildRecapEmoteCatalog, resolveRecapEmotes } from './recapEmotes.ts'
import { pickRecapRollups, recapMomentToLiveHeatPoint } from './recapMomentMetrics.ts'
import {
  chartHighlightedGameKey,
  chartVisibleRangeFromRollups,
  safeGameTimeline,
} from './extensionChartAdapter.ts'
import type { RecapUiState } from './recapUiState.ts'
import type { ExtensionCoverageResponse } from '../shared/coverage.ts'
import type { FullHistoryRequestResult } from '../shared/fullHistoryAuth.ts'
import { PulseMomentRow } from './PulseMomentRow.tsx'
import { SelectedMomentCard } from './SelectedMomentCard.tsx'
import { theme } from './theme.ts'

export interface StreamRecapSectionProps {
  payload: PulsePayload
  backendUrl: string
  uiState: RecapUiState
  isLive: boolean
  coverage?: ExtensionCoverageResponse | null
  showEmptyState?: boolean
  pollError?: string | null
  onJump: (point: LiveHeatPoint) => void
  onAnalytics: (point: LiveHeatPoint) => void
  onOpenAnalytics: (offsetSeconds?: number) => void
  onRetry?: () => void
  onRequestFullRollups?: () => Promise<FullHistoryRequestResult>
  sidebarFill?: boolean
  hideHubLink?: boolean
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatStreamDuration(durationSeconds?: number): string | null {
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null
  const total = Math.round(durationSeconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${total}s`
}

function formatRelativeTime(iso?: string): string | null {
  if (!iso) return null
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return null
  const diffMs = Date.now() - then
  if (diffMs < 0) return null
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

function recapMomentKey(streamId: string | undefined, moment: PulseRecapMoment): string {
  return recapMomentSelectionKey(streamId, moment)
}

function RecapStatBand({
  peakChat,
  peakEmotes,
  totalMessages,
  peakViewers: _peakViewers,
}: {
  peakChat: number
  peakEmotes?: number
  totalMessages: number
  peakViewers?: number
}) {
  const emotes = peakEmotes ?? 0
  if (peakChat <= 0 && totalMessages <= 0 && emotes <= 0) return null
  return (
    <div style={styles.statBand}>
      <div style={styles.statCell}>
        <span style={styles.statLabel}>Peak chat</span>
        <strong style={styles.statValuePeak}>{formatNumber(peakChat)}</strong>
        <span style={{ ...styles.statDetail, color: theme.accentSoft }}>/ min</span>
      </div>
      <div style={styles.statCell}>
        <span style={styles.statLabel}>Peak emotes</span>
        <strong style={styles.statValuePeak}>{formatNumber(emotes)}</strong>
        <span style={{ ...styles.statDetail, color: theme.accentSoft }}>/ min</span>
      </div>
      <div style={styles.statCell}>
        <span style={styles.statLabel}>Messages</span>
        <strong style={styles.statValuePeak}>{formatNumber(totalMessages)}</strong>
        <span style={{ ...styles.statDetail, color: theme.accentSoft }}>total</span>
      </div>
    </div>
  )
}

function RecapGamesStrip({
  games,
  durationSeconds,
  highlightedKey,
  onHighlightKey,
  visibleRange,
}: {
  games?: ExtensionGameSegment[]
  durationSeconds: number
  highlightedKey?: string | null
  onHighlightKey?: (key: string | null) => void
  visibleRange?: GamesPlayedVisibleRange | null
}) {
  return (
    <GamesPlayedStrip
      games={games}
      durationSeconds={durationSeconds}
      highlightedKey={highlightedKey}
      onHighlightKey={onHighlightKey}
      visibleRange={visibleRange}
    />
  )
}

function recapHighlightSpikeKey(streamId: string | undefined, offsetSeconds: number): string {
  return `${streamId ?? 'unknown'}:${offsetSeconds}:spike`
}

function recapHighlightBurstKey(streamId: string | undefined, offsetSeconds: number): string {
  return `${streamId ?? 'unknown'}:${offsetSeconds}:burst`
}

function RecapHighlightStrip({
  spike,
  burst,
  burstEmote,
  backendUrl,
  streamId,
  selectedKey,
  onSelectSpike,
  onSelectBurst,
}: {
  spike?: PulseStreamRecap['biggestChatSpike']
  burst?: PulseStreamRecap['funniestEmoteBurst']
  burstEmote: ExtensionEmote | null
  backendUrl: string
  streamId: string | undefined
  selectedKey: string | null
  onSelectSpike: () => void
  onSelectBurst: () => void
}) {
  if (!spike && !burst) return null
  const spikeSelected = spike
    ? selectedKey === recapHighlightSpikeKey(streamId, spike.offsetSeconds)
    : false
  const burstSelected = burst
    ? selectedKey === recapHighlightBurstKey(streamId, burst.offsetSeconds)
    : false
  return (
    <div style={styles.highlightStrip}>
      {spike ? (
        <button
          type="button"
          className={`pulse-recap-highlight-btn${spikeSelected ? ' pulse-recap-highlight-btn-selected' : ''}`}
          style={{
            ...styles.highlightButton,
            ...(spikeSelected ? styles.highlightButtonSelected : {}),
          }}
          onClick={onSelectSpike}
          aria-pressed={spikeSelected}
        >
          <span style={styles.highlightLabel}>Biggest spike</span>
          <span style={styles.highlightValue}>
            {formatNumber(spike.chatPerMin)}/min · {formatHeatOffset(spike.offsetSeconds)}
          </span>
        </button>
      ) : null}
      {burst ? (
        <button
          type="button"
          className={`pulse-recap-highlight-btn${burstSelected ? ' pulse-recap-highlight-btn-selected' : ''}`}
          style={{
            ...styles.highlightButton,
            ...(burstSelected ? styles.highlightButtonSelected : {}),
          }}
          onClick={onSelectBurst}
          aria-pressed={burstSelected}
        >
          <span style={styles.highlightLabel}>Top emote burst</span>
          <span style={styles.highlightValueRow}>
            {burstEmote ? (
              <PulseEmoteImg
                backendUrl={backendUrl}
                emote={burstEmote}
                width={18}
                height={18}
                style={styles.burstEmote}
              />
            ) : burst.code ? (
              <span>{burst.code}</span>
            ) : null}
            <span>×{formatNumber(burst.count)} · {formatHeatOffset(burst.offsetSeconds)}</span>
          </span>
        </button>
      ) : null}
    </div>
  )
}

function RecapMomentRow({
  point,
  backendUrl,
  selected,
  onSelect,
  onHighlight,
}: {
  point: LiveHeatPoint
  backendUrl: string
  selected: boolean
  onSelect: (point: LiveHeatPoint) => void
  onHighlight: (offsetSeconds: number | null) => void
}) {
  return (
    <PulseMomentRow
      point={point}
      backendUrl={backendUrl}
      selected={selected}
      onHighlight={onHighlight}
      onSelect={onSelect}
    />
  )
}

const RECAP_MOMENTS_COLLAPSED_COUNT = 5
const RECAP_MOMENTS_MAX_COUNT = 20

function recapPointSelectionKey(
  streamId: string | undefined,
  point: LiveHeatPoint,
  moments: PulseRecapMoment[],
): string {
  const match = moments.find(moment => Math.abs(moment.offsetSeconds - point.offsetSeconds) < 90)
  if (match) return recapMomentKey(streamId, match)
  return `${streamId ?? 'unknown'}:${point.offsetSeconds}:${point.score}`
}

function RecapMomentsList({
  moments,
  visibleMoments,
  expanded,
  onToggleExpanded,
  payload,
  backendUrl,
  catalog,
  rollups,
  peaks,
  selectedKey,
  onSelect,
  onHighlight,
}: {
  moments: PulseRecapMoment[]
  visibleMoments: PulseRecapMoment[]
  expanded: boolean
  onToggleExpanded: () => void
  payload: PulsePayload
  backendUrl: string
  catalog: ExtensionEmote[]
  rollups: ExtensionRollup[]
  peaks: ExtensionPeak[] | undefined
  selectedKey: string | null
  onSelect: (key: string) => void
  onHighlight: (offsetSeconds: number | null) => void
}) {
  if (moments.length === 0) return null
  const hiddenCount = moments.length - RECAP_MOMENTS_COLLAPSED_COUNT
  return (
    <>
      <span style={styles.listCaption}>Top moments</span>
      <div style={styles.momentList}>
        {visibleMoments.map(moment => {
          const key = recapMomentKey(payload.streamId, moment)
          const point = recapMomentToLiveHeatPoint(moment, catalog, payload.startedAt, rollups, peaks)
          return (
            <RecapMomentRow
              key={key}
              point={point}
              backendUrl={backendUrl}
              selected={key === selectedKey}
              onHighlight={onHighlight}
              onSelect={() => onSelect(key)}
            />
          )
        })}
      </div>
      {moments.length > RECAP_MOMENTS_COLLAPSED_COUNT ? (
        <button type="button" className="pulse-secondary-btn" style={styles.momentsExpandButton} onClick={onToggleExpanded}>
          <span>
            {expanded ? 'Show less' : `Show ${hiddenCount} more moment${hiddenCount === 1 ? '' : 's'}`}
          </span>
          <span style={styles.momentsExpandChevron} aria-hidden="true">
            {expanded ? '▾' : '▸'}
          </span>
        </button>
      ) : null}
    </>
  )
}

function RecapReadyContent({
  recap,
  payload,
  backendUrl,
  catalog,
  coverage,
  sidebarFill = false,
  hideHubLink = false,
  onJump,
  onAnalytics,
  onRequestFullRollups,
}: {
  recap: PulseStreamRecap
  payload: PulsePayload
  backendUrl: string
  catalog: ExtensionEmote[]
  coverage?: ExtensionCoverageResponse | null
  sidebarFill?: boolean
  hideHubLink?: boolean
  onJump: (point: LiveHeatPoint) => void
  onAnalytics: (point: LiveHeatPoint) => void
  onRequestFullRollups?: () => Promise<FullHistoryRequestResult>
}) {
  const mergedMoments = useMemo(
    () => mergeRecapMoments(recap, payload.peaks, RECAP_MOMENTS_MAX_COUNT, pickRecapRollups(payload)),
    [recap, payload.peaks],
  )
  const [momentsExpanded, setMomentsExpanded] = useState(false)
  const [hoveredOffset, setHoveredOffset] = useState<number | null>(null)
  const [hoveredGameKey, setHoveredGameKey] = useState<string | null>(null)
  const visibleMoments = momentsExpanded
    ? mergedMoments
    : mergedMoments.slice(0, RECAP_MOMENTS_COLLAPSED_COUNT)
  const rollups = pickRecapRollups(payload)
  const heroMoment = mergedMoments[0] ?? null
  const [selectedKey, setSelectedKey] = useState<string | null>(
    heroMoment ? recapMomentKey(payload.streamId, heroMoment) : null,
  )
  const [overridePoint, setOverridePoint] = useState<LiveHeatPoint | null>(null)
  const userSelectedRef = useRef(false)

  useEffect(() => {
    userSelectedRef.current = false
  }, [payload.streamId])

  useEffect(() => {
    if (userSelectedRef.current) return
    if (!heroMoment) {
      setSelectedKey(null)
      setOverridePoint(null)
      return
    }
    setSelectedKey(recapMomentKey(payload.streamId, heroMoment))
    setOverridePoint(null)
  }, [payload.streamId, heroMoment?.offsetSeconds, heroMoment?.score])

  const selectedMoment = mergedMoments.find(moment => recapMomentKey(payload.streamId, moment) === selectedKey) ?? null
  const selectedPoint = selectedMoment
    ? recapMomentToLiveHeatPoint(selectedMoment, catalog, payload.startedAt, rollups, payload.peaks)
    : overridePoint

  function markUserSelected(): void {
    userSelectedRef.current = true
  }

  function clearRecapSelection(): void {
    markUserSelected()
    setSelectedKey(null)
    setOverridePoint(null)
    setHoveredOffset(null)
  }

  function selectChatSpike(): void {
    const spike = recap.biggestChatSpike
    if (!spike) return
    const spikeKey = recapHighlightSpikeKey(payload.streamId, spike.offsetSeconds)
    if (selectedKey === spikeKey) {
      clearRecapSelection()
      return
    }
    markUserSelected()
    const point = recapChatSpikeToHeatPoint(spike, catalog, payload.startedAt, rollups, payload.peaks)
    setSelectedKey(spikeKey)
    setOverridePoint(point)
    setHoveredOffset(null)
  }

  function selectEmoteBurst(): void {
    const burst = recap.funniestEmoteBurst
    if (!burst) return
    const burstKey = recapHighlightBurstKey(payload.streamId, burst.offsetSeconds)
    if (selectedKey === burstKey) {
      clearRecapSelection()
      return
    }
    markUserSelected()
    const point = recapEmoteBurstToHeatPoint(burst, catalog, payload.startedAt, rollups, payload.peaks)
    setSelectedKey(burstKey)
    setOverridePoint(point)
    setHoveredOffset(null)
  }
  const topEmotes = resolveRecapEmotes(recap.topEmotes, catalog)
  const burstEmote = recap.funniestEmoteBurst?.code
    ? resolveRecapEmotes(
        [{ code: recap.funniestEmoteBurst.code, count: recap.funniestEmoteBurst.count }],
        catalog,
      )[0] ?? null
    : null
  const peakStats = lastStreamPeakStats(payload)
  const chartPeakOffsets = useMemo(
    () => resolveRecapChartPeakOffsets(mergedMoments, payload.peaks),
    [mergedMoments, payload.peaks],
  )
  const recapDurationSeconds = recapStreamDurationSeconds(payload)
  // Reject stale cross-stream timelines before they reach the strip/chart.
  const recapGames = useMemo(
    () => safeGameTimeline(payload.games, recapDurationSeconds),
    [payload.games, recapDurationSeconds],
  )
  const recapVisibleRange = useMemo(
    () => chartVisibleRangeFromRollups(pickRecapRollups(payload)),
    [payload],
  )
  const recapChartHighlightedGameKey = useMemo(
    () => chartHighlightedGameKey(hoveredGameKey, recapGames, recapDurationSeconds, recapVisibleRange),
    [hoveredGameKey, recapGames, recapDurationSeconds, recapVisibleRange],
  )

  useEffect(() => {
    setHoveredGameKey(null)
  }, [payload.streamId])

  const duration = formatStreamDuration(recap.durationSeconds)
  const meta = duration
    ? `${duration} · ${formatNumber(recap.totalMessages)} messages`
    : `${formatNumber(recap.totalMessages)} messages`

  return (
    <div style={styles.recapContent}>
      <RecapAnalyticsNav
        backendUrl={backendUrl}
        channelLogin={payload.login}
        streamId={payload.streamId}
        offsetSeconds={selectedPoint?.offsetSeconds ?? null}
        hideHubLink={hideHubLink}
      />
      <RecapStatBand
        peakChat={recap.peakChatPerMin}
        peakEmotes={peakStats?.peakEmotePerMin}
        totalMessages={recap.totalMessages}
      />
      <RecapHighlightStrip
        spike={recap.biggestChatSpike}
        burst={recap.funniestEmoteBurst}
        burstEmote={burstEmote}
        backendUrl={backendUrl}
        streamId={payload.streamId}
        selectedKey={selectedKey}
        onSelectSpike={selectChatSpike}
        onSelectBurst={selectEmoteBurst}
      />
      <RecapGamesStrip
        games={recapGames}
        durationSeconds={recapDurationSeconds}
        highlightedKey={recapChartHighlightedGameKey}
        onHighlightKey={setHoveredGameKey}
        visibleRange={recapVisibleRange}
      />
      <RecapTimelineChart
        payload={payload}
        backendUrl={backendUrl}
        peakOffsets={chartPeakOffsets}
        catalog={catalog}
        pinOffsetSeconds={selectedPoint?.offsetSeconds ?? null}
        previewOffsetSeconds={hoveredOffset}
        sidebarFill={sidebarFill}
        highlightedGameSegmentKey={recapChartHighlightedGameKey}
        onClearSelection={clearRecapSelection}
        onSelectPoint={point => {
          markUserSelected()
          if (selectedPoint?.offsetSeconds === point.offsetSeconds) {
            clearRecapSelection()
            return
          }
          const key = recapPointSelectionKey(payload.streamId, point, mergedMoments)
          setSelectedKey(key)
          const matched = mergedMoments.some(moment => recapMomentKey(payload.streamId, moment) === key)
          setOverridePoint(matched ? null : point)
          setHoveredOffset(null)
        }}
        onRequestFullRollups={onRequestFullRollups}
      />
      {selectedPoint ? (
        <SelectedMomentCard
          point={selectedPoint}
          backendUrl={backendUrl}
          onJump={onJump}
          onAnalytics={onAnalytics}
        />
      ) : null}
      <RecapMomentsList
        moments={mergedMoments}
        visibleMoments={visibleMoments}
        expanded={momentsExpanded}
        onToggleExpanded={() => setMomentsExpanded(value => !value)}
        payload={payload}
        backendUrl={backendUrl}
        catalog={catalog}
        rollups={rollups}
        peaks={payload.peaks}
        selectedKey={selectedKey}
        onSelect={key => {
          markUserSelected()
          setSelectedKey(key)
          setOverridePoint(null)
          setHoveredOffset(null)
        }}
        onHighlight={setHoveredOffset}
      />
      <RecapTopEmotesRow backendUrl={backendUrl} emotes={topEmotes} />
      {coverage?.liveMetadata?.title ? (
        <span style={styles.offlineMeta}>{coverage.liveMetadata.title}</span>
      ) : null}
      <span style={styles.srOnly}>{meta}</span>
    </div>
  )
}

function offlinePointKey(point: LiveHeatPoint): string {
  return `${point.offsetSeconds}:${point.score}`
}

function OfflineFallbackContent({
  payload,
  backendUrl,
  coverage,
  sidebarFill = false,
  hideHubLink = false,
  onJump,
  onAnalytics,
  onOpenAnalytics,
  onRequestFullRollups,
}: {
  payload: PulsePayload
  backendUrl: string
  coverage?: ExtensionCoverageResponse | null
  sidebarFill?: boolean
  hideHubLink?: boolean
  onJump: (point: LiveHeatPoint) => void
  onAnalytics: (point: LiveHeatPoint) => void
  onOpenAnalytics: (offsetSeconds?: number) => void
  onRequestFullRollups?: () => Promise<FullHistoryRequestResult>
}) {
  const meta = coverage?.liveMetadata ?? null
  const peaks = lastStreamPeakStats(payload)
  const rollups = (payload.fullRollups?.length ?? 0) > 0 ? payload.fullRollups! : payload.rollups
  const totalMessages = rollups.reduce((sum, rollup) => sum + (rollup.chatCount ?? 0), 0)
  const peakViewers = payload.peakViewers ?? peaks?.peakViewers ?? meta?.viewerCount ?? 0
  const peakChat = peaks?.peakChatPerMin ?? 0
  const catalog = buildRecapEmoteCatalog(payload)
  const topEmotes = resolveRecapEmotes(
    catalog.map(emote => ({ code: emote.name, count: emote.count, provider: emote.provider, id: emote.id, imageUrl: emote.imageUrl })),
    catalog,
  ).filter(emote => emote.count > 0).slice(0, 6)
  const peakPoints = peaksToLiveHeatPoints(
    [...(payload.peaks ?? [])].sort((a, b) => b.score - a.score).slice(0, RECAP_MOMENTS_MAX_COUNT) as ExtensionPeak[],
    payload.startedAt,
    catalog,
  )
  const [momentsExpanded, setMomentsExpanded] = useState(false)
  const [hoveredOffset, setHoveredOffset] = useState<number | null>(null)
  const [hoveredGameKey, setHoveredGameKey] = useState<string | null>(null)
  const visiblePeakPoints = momentsExpanded
    ? peakPoints
    : peakPoints.slice(0, RECAP_MOMENTS_COLLAPSED_COUNT)
  const heroPoint = peakPoints[0] ?? null
  const [selectedKey, setSelectedKey] = useState<string | null>(
    heroPoint ? offlinePointKey(heroPoint) : null,
  )
  const [overridePoint, setOverridePoint] = useState<LiveHeatPoint | null>(null)
  const userSelectedRef = useRef(false)

  useEffect(() => {
    userSelectedRef.current = false
  }, [payload.login, payload.streamId, payload.vodId, payload.startedAt])

  useEffect(() => {
    if (userSelectedRef.current) return
    if (!heroPoint) {
      setSelectedKey(null)
      setOverridePoint(null)
      return
    }
    setSelectedKey(offlinePointKey(heroPoint))
    setOverridePoint(null)
  }, [payload.streamId, heroPoint?.offsetSeconds, heroPoint?.score])

  const selectedPoint =
    selectedKey == null
      ? null
      : peakPoints.find(point => offlinePointKey(point) === selectedKey) ?? overridePoint

  function clearOfflineSelection(): void {
    userSelectedRef.current = true
    setSelectedKey(null)
    setOverridePoint(null)
    setHoveredOffset(null)
  }
  const chartPeakOffsets = useMemo(
    () => resolveRecapChartPeakOffsets(undefined, payload.peaks),
    [payload.peaks],
  )
  const recapDurationSeconds = recapStreamDurationSeconds(payload)
  // Reject stale cross-stream timelines before they reach the strip/chart.
  const recapGames = useMemo(
    () => safeGameTimeline(payload.games, recapDurationSeconds),
    [payload.games, recapDurationSeconds],
  )
  const recapVisibleRange = useMemo(
    () => chartVisibleRangeFromRollups(pickRecapRollups(payload)),
    [payload],
  )
  const recapChartHighlightedGameKey = useMemo(
    () => chartHighlightedGameKey(hoveredGameKey, recapGames, recapDurationSeconds, recapVisibleRange),
    [hoveredGameKey, recapGames, recapDurationSeconds, recapVisibleRange],
  )

  useEffect(() => {
    setHoveredGameKey(null)
  }, [payload.streamId])

  const duration = formatStreamDuration(payload.durationSeconds)
  const endedAgo = formatRelativeTime(payload.endedAt ?? payload.latestEndedAt)
  const metaParts: string[] = []
  if (duration) metaParts.push(duration)
  if (endedAgo) metaParts.push(`ended ${endedAgo}`)

  return (
    <div style={styles.recapContent}>
      <RecapAnalyticsNav
        backendUrl={backendUrl}
        channelLogin={payload.login}
        streamId={payload.streamId}
        offsetSeconds={selectedPoint?.offsetSeconds ?? null}
        hideHubLink={hideHubLink}
      />
      {meta?.title ? <div style={styles.offlineTitle}>{meta.title}</div> : null}
      {payload.category ?? meta?.category ? (
        <div style={styles.offlineCategory}>{payload.category ?? meta?.category}</div>
      ) : null}
      {peakPoints.length === 0 && (peakChat > 0 || totalMessages > 0) ? (
        <div style={styles.fallbackCta}>
          <button type="button" className="pulse-recap-analytics-cta" style={styles.actionPrimary} onClick={() => onOpenAnalytics()}>
            Open analytics
          </button>
        </div>
      ) : null}
      <RecapStatBand
        peakChat={peakChat}
        peakEmotes={peaks?.peakEmotePerMin}
        totalMessages={totalMessages}
        peakViewers={peakViewers}
      />
      <RecapGamesStrip
        games={recapGames}
        durationSeconds={recapDurationSeconds}
        highlightedKey={recapChartHighlightedGameKey}
        onHighlightKey={setHoveredGameKey}
        visibleRange={recapVisibleRange}
      />
      <RecapTimelineChart
        payload={payload}
        backendUrl={backendUrl}
        peakOffsets={chartPeakOffsets}
        catalog={catalog}
        pinOffsetSeconds={selectedPoint?.offsetSeconds ?? null}
        previewOffsetSeconds={hoveredOffset}
        sidebarFill={sidebarFill}
        highlightedGameSegmentKey={recapChartHighlightedGameKey}
        onClearSelection={clearOfflineSelection}
        onSelectPoint={point => {
          userSelectedRef.current = true
          const key = offlinePointKey(point)
          setSelectedKey(key)
          const matched = peakPoints.some(existing => offlinePointKey(existing) === key)
          setOverridePoint(matched ? null : point)
          setHoveredOffset(null)
        }}
        onRequestFullRollups={onRequestFullRollups}
      />
      {selectedPoint ? (
        <SelectedMomentCard
          point={selectedPoint}
          backendUrl={backendUrl}
          onJump={onJump}
          onAnalytics={onAnalytics}
        />
      ) : null}
      {peakPoints.length > 0 ? (
        <>
          <span style={styles.listCaption}>Top moments</span>
          <div style={styles.momentList}>
            {visiblePeakPoints.map(point => {
              const key = offlinePointKey(point)
              return (
                <RecapMomentRow
                  key={`${point.offsetSeconds}-${point.reason}-${point.minuteTs}`}
                  point={point}
                  backendUrl={backendUrl}
                  selected={key === selectedKey}
                  onHighlight={setHoveredOffset}
                  onSelect={next => {
                    userSelectedRef.current = true
                    setSelectedKey(offlinePointKey(next))
                    setOverridePoint(null)
                    setHoveredOffset(null)
                  }}
                />
              )
            })}
          </div>
          {peakPoints.length > RECAP_MOMENTS_COLLAPSED_COUNT ? (
            <button
              type="button"
              className="pulse-secondary-btn"
              style={styles.momentsExpandButton}
              onClick={() => setMomentsExpanded(value => !value)}
            >
              <span>
                {momentsExpanded
                  ? 'Show less'
                  : `Show ${peakPoints.length - RECAP_MOMENTS_COLLAPSED_COUNT} more moment${
                      peakPoints.length - RECAP_MOMENTS_COLLAPSED_COUNT === 1 ? '' : 's'
                    }`}
              </span>
              <span style={styles.momentsExpandChevron} aria-hidden="true">
                {momentsExpanded ? '▾' : '▸'}
              </span>
            </button>
          ) : null}
        </>
      ) : null}
      <RecapTopEmotesRow backendUrl={backendUrl} emotes={topEmotes} />
      {metaParts.length > 0 ? <span style={styles.offlineMeta}>{metaParts.join(' · ')}</span> : null}
    </div>
  )
}

export function StreamRecapSection({
  payload,
  backendUrl,
  uiState,
  isLive,
  coverage = null,
  showEmptyState = true,
  pollError,
  onJump,
  onAnalytics,
  onOpenAnalytics,
  onRetry,
  onRequestFullRollups,
  sidebarFill = false,
  hideHubLink = false,
}: StreamRecapSectionProps) {
  if (isLive) return null

  const catalog = useMemo(() => buildRecapEmoteCatalog(payload), [payload])
  const recap = payload.recap
  const title = recap ? 'Stream Recap' : 'Last Stream Recap'
  const duration = formatStreamDuration(recap?.durationSeconds ?? payload.durationSeconds)
  const messageTotal = recap?.totalMessages
    ?? (payload.fullRollups?.length ? payload.fullRollups : payload.rollups)
        .reduce((sum, rollup) => sum + (rollup.chatCount ?? 0), 0)
  const cardMeta = duration
    ? `${duration} · ${formatNumber(messageTotal)} messages`
    : messageTotal > 0
      ? `${formatNumber(messageTotal)} messages`
      : undefined

  if (uiState === 'loading') {
    return (
      <PulseSectionCard title={title} meta={cardMeta}>
        <RecapSkeleton />
      </PulseSectionCard>
    )
  }

  if (uiState === 'error') {
    return (
      <PulseSectionCard title={title}>
        <div style={styles.stateBlock}>
          <p style={styles.stateText}>
            {pollError?.trim() || 'Stream recap is unavailable right now.'}
          </p>
          {onRetry ? (
            <button type="button" className="pulse-secondary-btn" style={styles.secondaryButton} onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      </PulseSectionCard>
    )
  }

  if (uiState === 'empty') {
    if (!showEmptyState) return null
    return (
      <PulseSectionCard title={title}>
        <p style={styles.emptyText}>
          No recap yet. Track this channel to capture chat and emote analytics the next time it goes live.
        </p>
      </PulseSectionCard>
    )
  }

  return (
    <PulseSectionCard title={title} meta={cardMeta}>
      {recap ? (
        <RecapReadyContent
          recap={recap}
          payload={payload}
          backendUrl={backendUrl}
          catalog={catalog}
          coverage={coverage}
          sidebarFill={sidebarFill}
          hideHubLink={hideHubLink}
          onJump={onJump}
          onAnalytics={onAnalytics}
          onRequestFullRollups={onRequestFullRollups}
        />
      ) : (
        <OfflineFallbackContent
          payload={payload}
          backendUrl={backendUrl}
          coverage={coverage}
          sidebarFill={sidebarFill}
          hideHubLink={hideHubLink}
          onJump={onJump}
          onAnalytics={onAnalytics}
          onOpenAnalytics={onOpenAnalytics}
          onRequestFullRollups={onRequestFullRollups}
        />
      )}
    </PulseSectionCard>
  )
}

const styles: Record<string, CSSProperties> = {
  recapContent: {
    display: 'grid',
    gap: 10,
  },
  statBand: {
    display: 'grid',
    gap: 8,
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  },
  statCell: {
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    display: 'grid',
    gap: 2,
    padding: '8px 10px',
  },
  statLabel: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  statValue: {
    color: theme.textPrimary,
    fontSize: 18,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 900,
    lineHeight: 1.1,
  },
  statValuePeak: {
    color: theme.accentInk,
    fontSize: 17,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 900,
    lineHeight: 1.1,
  },
  statDetail: { fontSize: 10, fontWeight: 800 },
  gamesStrip: { display: 'grid', gap: 5 },
  gamesLabel: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  gamesRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  gameChip: {
    alignItems: 'center',
    background: 'rgba(249, 115, 22, 0.08)',
    border: '1px solid rgba(249, 115, 22, 0.22)',
    borderRadius: 999,
    display: 'inline-flex',
    flexWrap: 'wrap',
    gap: 6,
    padding: '4px 9px',
  },
  gameName: { color: '#fdba74', fontSize: 10, fontWeight: 800 },
  gameDuration: { color: theme.textMuted, fontSize: 9, fontWeight: 600 },
  highlightStrip: { display: 'grid', gap: 6 },
  highlightButton: {
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 10,
    color: theme.textPrimary,
    cursor: 'pointer',
    display: 'flex',
    gap: 10,
    justifyContent: 'space-between',
    padding: '8px 10px',
    textAlign: 'left',
    width: '100%',
  },
  highlightButtonSelected: {
    background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.08)',
    border: '1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.22)',
  },
  highlightLabel: { fontSize: 11, fontWeight: 800 },
  highlightValue: {
    color: theme.textSecondary,
    fontSize: 11,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 700,
  },
  highlightValueRow: {
    alignItems: 'center',
    color: theme.textSecondary,
    display: 'inline-flex',
    fontSize: 11,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 700,
    gap: 6,
  },
  burstEmote: { display: 'block', objectFit: 'contain' },
  listCaption: {
    color: theme.textMuted,
    display: 'block',
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.06em',
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  momentsExpandButton: {
    alignItems: 'center',
    background: 'transparent',
    border: 0,
    color: theme.accentSoft,
    cursor: 'pointer',
    display: 'flex',
    fontSize: 10,
    fontWeight: 700,
    gap: 6,
    justifyContent: 'center',
    padding: '8px 0 0',
    width: '100%',
  },
  momentsExpandChevron: {
    color: theme.accentSoft,
    fontSize: 11,
    fontWeight: 900,
    lineHeight: 1,
  },
  momentList: { display: 'grid', gap: 4 },
  stateBlock: { display: 'grid', gap: 10 },
  stateText: { color: theme.textSecondary, fontSize: 12, lineHeight: 1.45, margin: 0 },
  secondaryButton: {
    background: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 10,
    color: theme.textPrimary,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 800,
    padding: '8px 12px',
    width: 'fit-content',
  },
  emptyText: { color: theme.textMuted, fontSize: 12, lineHeight: 1.5, margin: 0 },
  offlineTitle: { color: theme.textPrimary, fontSize: 13, fontWeight: 700, lineHeight: 1.35 },
  offlineCategory: { color: theme.textSecondary, fontSize: 12, fontWeight: 700 },
  offlineMeta: { color: theme.textMuted, fontSize: 11, fontWeight: 600 },
  fallbackCta: { display: 'flex', gap: 8 },
  actionPrimary: {
    background: theme.accent,
    border: 0,
    borderRadius: 10,
    color: theme.onAccent,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 800,
    padding: '8px 12px',
  },
  srOnly: {
    border: 0,
    clip: 'rect(0 0 0 0)',
    height: 1,
    margin: -1,
    overflow: 'hidden',
    padding: 0,
    position: 'absolute',
    whiteSpace: 'nowrap',
    width: 1,
  },
}
