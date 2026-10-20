import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import {
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
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { RecapAnalyticsNav } from './RecapAnalyticsNav.tsx'
import { RecapSkeleton } from './RecapSkeleton.tsx'
import { RecapTimelineChart } from './RecapTimelineChart.tsx'
import {
  mergeRecapMoments,
  recapMomentSelectionKey,
  resolveRecapChartPeakOffsets,
  recapStreamDurationSeconds,
  rollupToRecapHeatPoint,
} from './recapChartPeaks.ts'
import { buildRecapEmoteCatalog } from './recapEmotes.ts'
import { catchMeUpModel, useCatchMeUp } from './catchMeUp.ts'
import { pickRecapRollups, recapMomentToLiveHeatPoint } from './recapMomentMetrics.ts'
import {
  chartHighlightedGameKey,
  chartVisibleRangeFromRollups,
  safeGameTimeline,
} from './extensionChartAdapter.ts'
import type { RecapUiState } from './recapUiState.ts'
import { formatPulseApiError } from './pulseApiErrors.ts'
import type { ExtensionCoverageResponse } from '../shared/coverage.ts'
import type { FullHistoryRequestResult } from '../shared/fullHistoryAuth.ts'
import { PulseMomentRow, momentRowKey } from './PulseMomentRow.tsx'
import { SelectedMomentCard } from './SelectedMomentCard.tsx'
import { MomentCardSlot } from './MomentCardSlot.tsx'
import { MyMomentsLink } from './momentBookmarks.tsx'
import { TopMomentCard, type TopMomentCardProps } from './TopMomentCard.tsx'
import { PulseThemedSelect } from './PulseThemedSelect.tsx'
import {
  MOMENT_SORT_OPTIONS,
  MOST_REACTED_VISIBLE_COUNT,
  TOP_MOMENTS_SUBTITLE,
  TOP_MOMENTS_TITLE,
  sortLiveHeatPoints,
  type MomentSortMode,
} from './mostReacted.ts'
import { usePinnedCardHold } from './pinnedCardExit.ts'
import { prefersReducedMotion } from './motion/useSmoothedScalar.ts'
import { theme } from './theme.ts'

export interface StreamRecapSectionProps {
  externalPoint?: LiveHeatPoint | null
  /** Under the chart: where the viewer came from, while their arrival keeps its minute picked. */
  arrivalNote?: ReactNode
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
  /** A VOD page, where Jump seeks this player. */
  vodPage?: boolean
  /** The VOD stream history names for this stream, when the payload names none (useArchiveVodId). */
  archiveVodId?: string | null
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
      hideWhenUnknown
    />
  )
}

const RECAP_MOMENTS_MAX_COUNT = 20

interface SummarySlot {
  ref: RefObject<HTMLDivElement>
  shown: boolean
  pending: boolean
}

/**
 * The recap's summary (src/ui/catchMeUp.ts). Its place is kept while its
 * script is on its way, so the chart and the list below never move down.
 */
function RecapSummarySlot({ summary }: { summary: SummarySlot }) {
  return <div ref={summary.ref} hidden={!summary.shown && !summary.pending} style={summary.pending ? styles.summaryReserve : undefined} />
}

/**
 * The listed moment a spike marker on the recap chart stands for: the same
 * moment, or else one within a minute of it, as for the highlight strip.
 */
function listedMoment<T extends { offsetSeconds: number; score: number }>(items: T[], peak: ExtensionPeak): T | undefined {
  return items.find(item => item.offsetSeconds === peak.offsetSeconds && Math.round(item.score) === Math.round(peak.score))
    ?? items.find(item => Math.abs(item.offsetSeconds - peak.offsetSeconds) <= 60)
}

/** Escape in a list whose pick the card shows closes the card. */
function clearOnEscape(card: TopMomentCardProps) {
  return (event: { key: string }) => { if (event.key === 'Escape' && card.point) card.onClear() }
}

interface RecapMomentItem {
  /** The selection key the recap picks the moment by. */
  key: string
  point: LiveHeatPoint
}

/**
 * Top moments, as on live (MostReactedSection): the count and Sort, then the
 * card of a moment picked in the list or by its spike marker on the chart,
 * above the first five rows, then Show more. Collapsed, a picked row past the
 * fold stays listed at the end. Hovering a row marks its minute on the chart.
 */
function RecapTopMoments({
  items,
  selectedKey,
  card,
  arrivalNote,
  backendUrl,
  onSelect,
  onHighlight,
}: {
  /** Ranked by the recap, strongest first. */
  items: RecapMomentItem[]
  selectedKey: string | null
  /** The card above the list, which shows a moment picked in it. */
  card: TopMomentCardProps
  /** An arrival's chip, right above the card when the arrival is a ranked moment. */
  arrivalNote?: ReactNode
  backendUrl: string
  onSelect: (key: string) => void
  onHighlight: (offsetSeconds: number | null) => void
}) {
  const [sortMode, setSortMode] = useState<MomentSortMode>('reaction')
  const [expanded, setExpanded] = useState(false)
  const sorted = useMemo(() => {
    if (sortMode === 'reaction') return items
    const byPoint = new Map(items.map(item => [item.point, item]))
    return sortLiveHeatPoints(items.map(item => item.point), sortMode).map(point => byPoint.get(point)!)
  }, [items, sortMode])
  if (items.length === 0 && !card.point) return null
  const points = items.map(item => item.point)
  const shown = expanded ? sorted : sorted.filter((item, index) => index < MOST_REACTED_VISIBLE_COUNT || item.key === selectedKey)
  const hiddenCount = sorted.length - shown.length
  return (
    <>
      <div style={styles.topHead}>
        <div style={styles.topHeadMain}>
          <h4 style={styles.topTitle}>{TOP_MOMENTS_TITLE}</h4>
          <span style={styles.topSubtitle}>{TOP_MOMENTS_SUBTITLE}</span>
        </div>
        {items.length > 0 ? (
          <div style={styles.topMeta}>
            <span style={styles.momentCount}>{items.length} moment{items.length === 1 ? '' : 's'}</span>
            <PulseThemedSelect
              label="Sort"
              value={sortMode}
              options={MOMENT_SORT_OPTIONS}
              ariaLabel="Sort top moments"
              onChange={mode => {
                setSortMode(mode)
                setExpanded(false)
                onHighlight(null)
              }}
            />
          </div>
        ) : null}
      </div>
      {/*
        The card, the list and its Show more control share one grid child, so
        the card's slot never adds or drops a grid gap, and a row that leaves
        the list hands focus on to Show more (PulseMomentRow).
      */}
      <div>
        {arrivalNote}
        <TopMomentCard {...card} />
        <div style={styles.momentList} data-pmf-list="true" onKeyDown={clearOnEscape(card)}>
          {shown.map(({ key, point }) => (
            <PulseMomentRow
              key={momentRowKey(point, points)}
              point={point}
              backendUrl={backendUrl}
              selected={key === selectedKey}
              onHighlight={onHighlight}
              // Picking the moment the card shows again closes the card.
              onSelect={() => (card.point && key === selectedKey ? card.onClear() : onSelect(key))}
              controls={card.point ? card.id : undefined}
            />
          ))}
        </div>
        {expanded || hiddenCount > 0 ? (
          <button type="button" className="pulse-moment-more" style={styles.momentsExpandButton} data-chart-action="true" onClick={() => setExpanded(value => !value)}>
            <span>
              {expanded ? 'Show less' : `Show ${hiddenCount} more moment${hiddenCount === 1 ? '' : 's'}`}
            </span>
            <span style={styles.momentsExpandChevron} aria-hidden="true">
              {expanded ? '▾' : '▸'}
            </span>
          </button>
        ) : null}
      </div>
    </>
  )
}

/**
 * The card under the chart, for a minute or clip the list does not rank. It is
 * held for one exit window, so clearing a selection fades and collapses
 * instead of vanishing on the same frame.
 */
function RecapChartCard({ arrivalNote, hold, backendUrl, games, onJump, onAnalytics, onClear }: {
  arrivalNote?: ReactNode
  hold: { point: LiveHeatPoint | null; exiting: boolean }
  backendUrl: string
  games?: ExtensionGameSegment[]
  onJump: (point: LiveHeatPoint) => void
  onAnalytics: (point: LiveHeatPoint) => void
  onClear: () => void
}) {
  // One grid child, so the card's slot never adds or drops a grid gap.
  return (
    <div>
      {arrivalNote}
      {hold.point ? (
        <MomentCardSlot exiting={hold.exiting} data-chart-inspector-exiting={hold.exiting ? 'true' : undefined}>
          <div style={styles.slotSpacing}>
            <SelectedMomentCard
              point={hold.point}
              backendUrl={backendUrl}
              compact
              onJump={onJump}
              onAnalytics={onAnalytics}
              onClear={onClear}
              games={games}
            />
          </div>
        </MomentCardSlot>
      ) : null}
    </div>
  )
}

/**
 * A clip or an arrival picked outside the section opens its minute here. When
 * it is withdrawn (an arrival unlocked), its pick clears, unless the viewer
 * has picked something else since.
 */
function useExternalPick(
  point: LiveHeatPoint | null | undefined,
  selectedKey: string | null,
  pick: (key: string | null, point?: LiveHeatPoint | null) => void,
): void {
  const last = useRef<string | null>(null)
  useEffect(() => {
    if (point) {
      last.current = `clip:${point.offsetSeconds}`
      pick(last.current, point)
    } else if (last.current) {
      if (selectedKey === last.current) pick(null)
      last.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new external pick acts
  }, [point])
}

function RecapReadyContent({
  externalPoint,
  arrivalNote,
  recap,
  payload,
  backendUrl,
  catalog,
  coverage,
  archiveVodId,
  sidebarFill = false,
  hideHubLink = false,
  vodPage = false,
  onJump,
  onAnalytics,
  onRequestFullRollups,
}: {
  recap: PulseStreamRecap
  externalPoint?: LiveHeatPoint | null
  arrivalNote?: ReactNode
  payload: PulsePayload
  backendUrl: string
  catalog: ExtensionEmote[]
  coverage?: ExtensionCoverageResponse | null
  archiveVodId?: string | null
  sidebarFill?: boolean
  hideHubLink?: boolean
  vodPage?: boolean
  onJump: (point: LiveHeatPoint) => void
  onAnalytics: (point: LiveHeatPoint) => void
  onRequestFullRollups?: () => Promise<FullHistoryRequestResult>
}) {
  const mergedMoments = useMemo(
    () => mergeRecapMoments(recap, payload.peaks, RECAP_MOMENTS_MAX_COUNT, pickRecapRollups(payload)),
    [recap, payload.peaks],
  )
  const [hoveredOffset, setHoveredOffset] = useState<number | null>(null)
  const [hoveredGameKey, setHoveredGameKey] = useState<string | null>(null)
  const rollups = pickRecapRollups(payload)
  // Nothing is selected, highlighted or locked on the chart until the viewer
  // picks something; the strongest moment is not picked for them.
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [overridePoint, setOverridePoint] = useState<LiveHeatPoint | null>(null)
  const cardId = useId()

  // Another stream starts with nothing picked.
  useEffect(() => {
    setSelectedKey(null)
    setOverridePoint(null)
  }, [payload.streamId])

  const selectedMoment = mergedMoments.find(moment => recapMomentKey(payload.streamId, moment) === selectedKey) ?? null
  useExternalPick(externalPoint, selectedKey, pick)
  const selectedPoint = selectedMoment
    ? recapMomentToLiveHeatPoint(selectedMoment, catalog, payload.startedAt, rollups, payload.peaks)
    : overridePoint
  // A ranked moment shows in Top moments' card; anything else, under the chart.
  const recapCardHold = usePinnedCardHold(selectedMoment ? null : selectedPoint, prefersReducedMotion())

  // Selects a listed moment by its key, or anything else by a key and the
  // point it shows; null clears the selection.
  function pick(key: string | null, point: LiveHeatPoint | null = null): void {
    setSelectedKey(key)
    setOverridePoint(point)
    setHoveredOffset(null)
  }

  function clearRecapSelection(): void {
    pick(null)
  }

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

  const items = useMemo(
    () => mergedMoments.map(moment => ({
      key: recapMomentKey(payload.streamId, moment),
      point: recapMomentToLiveHeatPoint(moment, catalog, payload.startedAt, rollups, payload.peaks),
    })),
    [mergedMoments, catalog, payload.streamId, payload.startedAt, rollups, payload.peaks],
  )
  const summary = useCatchMeUp<HTMLDivElement>(
    catchMeUpModel({
      rollups,
      played: recapGames,
      category: payload.category,
      durationSeconds: recapDurationSeconds,
      peakChatPerMin: recap.peakChatPerMin,
      vodId: payload.vodId ?? archiveVodId,
      // A VOD page names its VOD's title, from Twitch; a channel page, its last stream's.
      title: vodPage ? null : coverage?.liveMetadata?.title,
    }),
    { minute: minutePicker(rollups, payload.startedAt, catalog, pick) },
  )

  const duration = formatStreamDuration(recapDurationSeconds)
  const meta = duration
    ? `${duration} · ${formatNumber(recap.totalMessages)} messages`
    : `${formatNumber(recap.totalMessages)} messages`

  return (
    <div style={styles.recapContent}>
      <RecapSummarySlot summary={summary} />
      <RecapGamesStrip
        key={payload.streamId ?? payload.vodId ?? 'recap'}
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
        onSelectPoint={point => pick(`bucket:${point.offsetSeconds}`, point)}
        // A spike marker of a listed moment shows it in the Top Moments card.
        onSelectMoment={peak => {
          const moment = listedMoment(mergedMoments, peak)
          if (moment) pick(recapMomentKey(payload.streamId, moment))
          return moment != null
        }}
        onRequestFullRollups={onRequestFullRollups}
      />
      <RecapChartCard
        arrivalNote={selectedMoment ? undefined : arrivalNote}
        hold={recapCardHold}
        backendUrl={backendUrl}
        games={payload.games}
        onJump={onJump}
        onAnalytics={onAnalytics}
        onClear={clearRecapSelection}
      />
      <RecapTopMoments
        items={items}
        selectedKey={selectedKey}
        arrivalNote={selectedMoment ? arrivalNote : undefined}
        card={{
          id: cardId,
          point: selectedMoment ? selectedPoint : null,
          backendUrl,
          onJump,
          onAnalytics,
          onClear: clearRecapSelection,
          games: payload.games,
        }}
        backendUrl={backendUrl}
        onSelect={key => pick(key)}
        onHighlight={setHoveredOffset}
      />
      <RecapAnalyticsNav
        backendUrl={backendUrl}
        channelLogin={payload.login}
        streamId={payload.streamId}
        offsetSeconds={selectedPoint?.offsetSeconds ?? null}
        hideHubLink={hideHubLink}
      />
      <span style={styles.srOnly}>{meta}</span>
    </div>
  )
}

/** Selects the chart's minute at `offsetSeconds`, as clicking it there does (the Catch me up summary's peak). */
function minutePicker(
  rollups: readonly ExtensionRollup[],
  startedAt: string | undefined,
  catalog: ExtensionEmote[],
  pick: (key: string, point: LiveHeatPoint) => void,
): (offsetSeconds: number) => void {
  return offsetSeconds => {
    const rollup = rollups.find(item => item.offsetSeconds === offsetSeconds)
    if (rollup) pick(`bucket:${offsetSeconds}`, rollupToRecapHeatPoint(rollup, startedAt, catalog))
  }
}

function offlinePointKey(point: LiveHeatPoint): string {
  return `${point.offsetSeconds}:${point.score}`
}

function OfflineFallbackContent({
  externalPoint,
  arrivalNote,
  payload,
  backendUrl,
  coverage,
  archiveVodId,
  sidebarFill = false,
  hideHubLink = false,
  vodPage = false,
  onJump,
  onAnalytics,
  onOpenAnalytics,
  onRequestFullRollups,
}: {
  payload: PulsePayload
  externalPoint?: LiveHeatPoint | null
  arrivalNote?: ReactNode
  backendUrl: string
  coverage?: ExtensionCoverageResponse | null
  archiveVodId?: string | null
  sidebarFill?: boolean
  hideHubLink?: boolean
  vodPage?: boolean
  onJump: (point: LiveHeatPoint) => void
  onAnalytics: (point: LiveHeatPoint) => void
  onOpenAnalytics: (offsetSeconds?: number) => void
  onRequestFullRollups?: () => Promise<FullHistoryRequestResult>
}) {
  const meta = coverage?.liveMetadata ?? null
  const peaks = lastStreamPeakStats(payload)
  const rollups = (payload.fullRollups?.length ?? 0) > 0 ? payload.fullRollups! : payload.rollups
  const totalMessages = rollups.reduce((sum, rollup) => sum + (rollup.chatCount ?? 0), 0)
  const peakChat = peaks?.peakChatPerMin ?? 0
  const catalog = buildRecapEmoteCatalog(payload)
  const peakPoints = peaksToLiveHeatPoints(
    [...(payload.peaks ?? [])].sort((a, b) => b.score - a.score).slice(0, RECAP_MOMENTS_MAX_COUNT) as ExtensionPeak[],
    payload.startedAt,
    catalog,
  )
  const [hoveredOffset, setHoveredOffset] = useState<number | null>(null)
  const [hoveredGameKey, setHoveredGameKey] = useState<string | null>(null)
  // As in the recap: nothing is picked until the viewer picks it.
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [overridePoint, setOverridePoint] = useState<LiveHeatPoint | null>(null)
  const cardId = useId()

  useEffect(() => {
    setSelectedKey(null)
    setOverridePoint(null)
  }, [payload.login, payload.streamId, payload.vodId, payload.startedAt])

  const listedPoint = peakPoints.find(point => offlinePointKey(point) === selectedKey)
  const selectedPoint = selectedKey == null ? null : listedPoint ?? overridePoint

  useExternalPick(externalPoint, selectedKey, pick)

  // A listed moment shows in Top moments' card; anything else, under the chart.
  const recapCardHold = usePinnedCardHold(
    listedPoint ? null : selectedPoint,
    prefersReducedMotion(),
  )

  // As in the recap; null clears the selection.
  function pick(key: string | null, point: LiveHeatPoint | null = null): void {
    setSelectedKey(key)
    setOverridePoint(point)
    setHoveredOffset(null)
  }

  function clearOfflineSelection(): void {
    pick(null)
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

  const summary = useCatchMeUp<HTMLDivElement>(
    catchMeUpModel({
      rollups,
      played: recapGames,
      category: payload.category ?? meta?.category,
      durationSeconds: recapDurationSeconds,
      peakChatPerMin: peakChat,
      vodId: payload.vodId ?? archiveVodId,
      // A VOD page names its VOD's title, from Twitch; a channel page, its last stream's.
      title: vodPage ? null : meta?.title,
    }),
    { minute: minutePicker(rollups, payload.startedAt, catalog, pick) },
  )

  const duration = formatStreamDuration(recapDurationSeconds)
  const endedAgo = formatRelativeTime(payload.endedAt ?? payload.latestEndedAt)
  const metaParts: string[] = []
  if (duration) metaParts.push(duration)
  if (endedAgo) metaParts.push(`ended ${endedAgo}`)

  return (
    <div style={styles.recapContent}>
      <RecapSummarySlot summary={summary} />
      {peakPoints.length === 0 && (peakChat > 0 || totalMessages > 0) ? (
        <div style={styles.fallbackCta}>
          <button type="button" className="pulse-recap-analytics-cta" style={styles.actionPrimary} onClick={() => onOpenAnalytics()}>
            Open analytics
          </button>
        </div>
      ) : null}
      <RecapGamesStrip
        key={payload.streamId ?? payload.vodId ?? 'recap'}
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
        onSelectPoint={point => pick(`bucket:${point.offsetSeconds}`, point)}
        onSelectMoment={peak => {
          const point = listedMoment(peakPoints, peak)
          if (point) pick(offlinePointKey(point))
          return point != null
        }}
        onRequestFullRollups={onRequestFullRollups}
      />
      <RecapChartCard
        arrivalNote={listedPoint ? undefined : arrivalNote}
        hold={recapCardHold}
        backendUrl={backendUrl}
        games={payload.games}
        onJump={onJump}
        onAnalytics={onAnalytics}
        onClear={clearOfflineSelection}
      />
      <RecapTopMoments
        items={peakPoints.map(point => ({ key: offlinePointKey(point), point }))}
        selectedKey={selectedKey}
        arrivalNote={listedPoint ? arrivalNote : undefined}
        card={{
          id: cardId,
          point: listedPoint ?? null,
          backendUrl,
          onJump,
          onAnalytics,
          onClear: clearOfflineSelection,
          games: payload.games,
        }}
        backendUrl={backendUrl}
        onSelect={key => pick(key)}
        onHighlight={setHoveredOffset}
      />
      <RecapAnalyticsNav
        backendUrl={backendUrl}
        channelLogin={payload.login}
        streamId={payload.streamId}
        offsetSeconds={selectedPoint?.offsetSeconds ?? null}
        hideHubLink={hideHubLink}
      />
      {metaParts.length > 0 ? <span style={styles.offlineMeta}>{metaParts.join(' · ')}</span> : null}
    </div>
  )
}

export function StreamRecapSection({
  externalPoint,
  arrivalNote,
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
  vodPage = false,
  archiveVodId = null,
}: StreamRecapSectionProps) {
  if (isLive) return null

  const catalog = useMemo(() => buildRecapEmoteCatalog(payload), [payload])
  const recap = payload.recap
  const title = recap ? 'Stream Recap' : 'Last Stream Recap'
  const recapDurationSeconds = recapStreamDurationSeconds(payload)
  const duration = formatStreamDuration(recapDurationSeconds)
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
            {formatPulseApiError(pollError) ?? 'Stream recap is unavailable right now.'}
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
    <PulseSectionCard title={title} meta={cardMeta} titleAction={<MyMomentsLink />}>
      {recap ? (
        <RecapReadyContent
          externalPoint={externalPoint}
          arrivalNote={arrivalNote}
          recap={recap}
          payload={payload}
          backendUrl={backendUrl}
          catalog={catalog}
          coverage={coverage}
          archiveVodId={archiveVodId}
          sidebarFill={sidebarFill}
          hideHubLink={hideHubLink}
          vodPage={vodPage}
          onJump={onJump}
          onAnalytics={onAnalytics}
          onRequestFullRollups={onRequestFullRollups}
        />
      ) : (
        <OfflineFallbackContent
          externalPoint={externalPoint}
          arrivalNote={arrivalNote}
          payload={payload}
          backendUrl={backendUrl}
          coverage={coverage}
          archiveVodId={archiveVodId}
          sidebarFill={sidebarFill}
          hideHubLink={hideHubLink}
          vodPage={vodPage}
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
  /** The recap grid gap, carried inside the card slot so it animates with it. */
  slotSpacing: { paddingTop: 10 },
  /** The summary's height (catch-me-up.js), kept while its script loads. */
  summaryReserve: { minHeight: 63 },
  topHead: { alignItems: 'flex-start', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', marginBottom: -4, rowGap: 6 },
  topHeadMain: { display: 'grid', flex: '1 1 140px', gap: 2, minWidth: 0 },
  topTitle: { color: theme.textPrimary, fontSize: 11, fontWeight: 900, letterSpacing: '0.05em', margin: 0, textTransform: 'uppercase' },
  topSubtitle: { color: theme.textMuted, fontSize: 11, fontWeight: 600, lineHeight: 1.35 },
  topMeta: { alignItems: 'center', display: 'flex', gap: 6 },
  momentCount: { color: theme.textMuted, fontSize: 9, fontVariantNumeric: 'tabular-nums', fontWeight: 700 },
  // The list's last row: a row's box, gap and text inset (padding, accent, gap).
  momentsExpandButton: {
    alignItems: 'center',
    appearance: 'none',
    background: 'rgba(255, 255, 255, 0.03)',
    border: 0,
    borderRadius: 6,
    color: theme.accentSoft,
    cursor: 'pointer',
    display: 'flex',
    fontSize: 11,
    fontWeight: 700,
    gap: 6,
    marginTop: 4,
    padding: '6px 8px 6px 18px',
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
