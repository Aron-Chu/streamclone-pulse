/**
 * The session page's Moments list: the d3-v2 session-original moment rows
 * (moment-rows.js + session-original.css "moment rows", 2026-10-15), on the
 * strip's own ranking (utils/sessionStripMoments.ts, so pin N is row N).
 *
 * `lockMode="strip"` (default): a row click locks that moment on the chart
 * (`onSelectOffset`), the same row again releases it (`onReleaseOffset`), and
 * the locked row is ringed (`aria-pressed`). A lock past the collapsed rows
 * opens the list. `lockMode="row"`: a row click opens the moment's detail in
 * place (player box + `selectedDetail`) and selects it on the chart.
 *
 * Collapsed, the list shows the top SESSION_MOMENTS_SHOWN rows (Aron
 * 2026-10-15: "show at most the top 3 moments"); the footer counts the rest.
 *
 * `reel` (strip mode only; the page passes SESSION_OWNER_SWITCHES.momentsReel):
 * the top three are the highlight reel (MomentReel.tsx, recap-r1 C1, Aron
 * 2026-10-16) instead of rows: #1 large, #2 and #3 side by side, each the
 * moment's VOD preview frame or the game's blurred box art. Rows #4 on open
 * under it, and the cards lock, release and play exactly as the rows do.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  recapMomentAnalyticalOffset,
  recapMomentReasonLabel,
} from '@streampulse/pulse-core'
import type {
  AnalyticsMinuteRollup,
  AnalyticsTopEmote,
  PulseStreamRecap,
} from '../../apiTypes.ts'
import type { ReplayHeatmapPoint } from '../../types/heatmap.ts'
import {
  momentRowClock,
  momentRowGameAt,
  momentRowHms,
  momentRowNamesNotCaptured,
  momentRowRate,
  momentRowReasonLabel,
  momentRowReasonTone,
  momentRowSeries,
  momentRowSparkBars,
  resolveMomentRowRollup,
  type MomentRowGameSegment,
} from '../../utils/momentRowDisplay.ts'
import {
  MOMENTS_MAX_VISIBLE,
  SESSION_MOMENTS_SHOWN,
  useCollapsedList,
} from '../../utils/momentListDisplay.tsx'
import {
  sessionStripMoments,
  stripHasReactionCoverage,
  stripMomentEmotes,
  useStripPinHover,
} from '../../utils/sessionStripMoments.ts'
import { alignedVodOffset } from '../../utils/twitchVodUrl.ts'
import { useVodFrame } from '../../utils/vodFrames.ts'
import { gameArtCandidates, isKnownGenericTwitchArtwork } from './GamesPlayedStrip.tsx'
import { MomentReelCard, REEL_SIZE, reelNote } from './MomentReel.tsx'
import {
  SessionMomentDetail,
  SessionMomentPlayer,
  SessionMomentRow,
  shadeSessionMomentRows,
  type SessionMomentRowModel,
} from './MomentRow.tsx'

export type MomentLockMode = 'strip' | 'row'

const VOD_ID_PATTERN = /^\d{6,20}$/
/** A parent selection this close to a moment rings that moment. */
const LOCK_MATCH_SECONDS = 90
/** The detail's close animation (SessionMomentDetail) before it unmounts. */
const DETAIL_CLOSE_MS = 210

function matchMomentIndex(offsets: number[], selected: number | null | undefined): number {
  if (selected == null || !Number.isFinite(selected) || offsets.length === 0) return -1
  const exact = offsets.indexOf(selected)
  if (exact >= 0) return exact
  let best = -1
  let bestDelta = Infinity
  offsets.forEach((offset, index) => {
    const delta = Math.abs(offset - selected)
    if (delta < bestDelta) {
      best = index
      bestDelta = delta
    }
  })
  return bestDelta <= LOCK_MATCH_SECONDS ? best : -1
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function SessionRecapMomentsStrip({
  recap,
  streamStartedAt,
  selectedOffsetSeconds,
  onSelectOffset,
  onPreviewOffset,
  layout = 'rightRail',
  rollups = [],
  heatmapPoints,
  topEmotesCatalog,
  selectedDetail,
  onReleaseOffset,
  lockMode = 'strip',
  games,
  vodId,
  vodAlignSeconds,
  vodDurationSeconds,
  vodRecording = false,
  onPlayOffset,
  reel = false,
}: {
  recap: PulseStreamRecap
  streamStartedAt?: string
  selectedOffsetSeconds?: number | null
  onSelectOffset: (offsetSeconds: number) => void
  onPreviewOffset?: (offsetSeconds: number | null) => void
  layout?: 'belowChart' | 'rightRail'
  rollups?: AnalyticsMinuteRollup[]
  heatmapPoints?: ReplayHeatmapPoint[]
  topEmotesCatalog?: AnalyticsTopEmote[]
  /** Strip mode: pinned above the list. Row mode: beside the open row's player. */
  selectedDetail?: ReactNode
  /** The locked row clicked again: release that moment's chart lock. */
  onReleaseOffset?: (offsetSeconds: number) => void
  lockMode?: MomentLockMode
  /** The stream's game segments: each row's game and the blurred box-art backdrop. */
  games?: MomentRowGameSegment[] | null
  vodId?: string | null
  vodAlignSeconds?: number | null
  vodDurationSeconds?: number | null
  /** The VOD is still recording (row mode's frame note). */
  vodRecording?: boolean
  /** Strip mode: the row's play button was pressed (after it locks the moment). */
  onPlayOffset?: (offsetSeconds: number) => void
  /** Strip mode: the top three as the highlight reel (MomentReel.tsx) instead of rows. */
  reel?: boolean
}) {
  // Shared with the session chart pins (utils/sessionStripMoments.ts): pin N
  // is row N.
  const hasReactionCoverage = useMemo(() => stripHasReactionCoverage(recap), [recap])
  const moments = useMemo(
    () => sessionStripMoments({ recap, hasReactionCoverage, heatmapPoints, streamStartedAt, topEmotesCatalog }),
    [recap, hasReactionCoverage, heatmapPoints, streamStartedAt, topEmotesCatalog],
  )
  const offsets = useMemo(() => moments.map(recapMomentAnalyticalOffset), [moments])
  const pinHover = useStripPinHover()
  const detailId = `${useId()}-moment-detail`
  const validVodId = vodId && VOD_ID_PATTERN.test(String(vodId).trim()) ? String(vodId).trim() : null

  // ---- the row-mode detail ----
  const [open, setOpen] = useState<{ offset: number; play: boolean } | null>(null)
  const [closing, setClosing] = useState<number | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(closeTimer.current), [])

  // ---- collapsed count: the top rows; the open row stays shown ----
  const baseCollapsed = SESSION_MOMENTS_SHOWN
  const openIndex = open ? offsets.indexOf(open.offset) : -1
  const collapsedCount = Math.max(baseCollapsed, openIndex + 1)
  const {
    visible: visibleMoments,
    expanded: listExpanded,
    canExpand,
    hiddenCount,
    setExpanded: setListExpanded,
  } = useCollapsedList(moments, collapsedCount, MOMENTS_MAX_VISIBLE, recap.streamId)

  // ---- the lock: the moment the chart's selection holds ----
  // A click locks at once (local), then follows the page's selection: any
  // change of `selectedOffsetSeconds` (including Esc clearing it) drops the
  // local value, so the ring never outlives the chart's selection.
  const [localLock, setLocalLock] = useState<{ offset: number | null } | null>(null)
  useEffect(() => {
    setLocalLock(null)
  }, [selectedOffsetSeconds])
  useEffect(() => {
    setLocalLock(null)
    setOpen(null)
    setClosing(null)
  }, [recap.streamId])

  const parentLockIndex = useMemo(
    () => matchMomentIndex(offsets, selectedOffsetSeconds),
    [offsets, selectedOffsetSeconds],
  )
  const lockedIndex = localLock
    ? (localLock.offset == null ? -1 : offsets.indexOf(localLock.offset))
    : parentLockIndex
  const lockedOffset = lockedIndex >= 0 ? offsets[lockedIndex]! : null

  // The glow plays once per new lock; a lock past the collapsed rows opens the list.
  const [pop, setPop] = useState<{ offset: number; token: number } | null>(null)
  const prevLocked = useRef<number | null>(lockedOffset)
  const lockState = useRef({ lockedIndex, collapsedCount, listExpanded })
  lockState.current = { lockedIndex, collapsedCount, listExpanded }
  useEffect(() => {
    if (lockedOffset === prevLocked.current) return
    prevLocked.current = lockedOffset
    if (lockedOffset == null) return
    setPop((current) => ({ offset: lockedOffset, token: (current?.token ?? 0) + 1 }))
    const state = lockState.current
    if (state.lockedIndex >= state.collapsedCount && !state.listExpanded) setListExpanded(true)
  }, [lockedOffset, setListExpanded])

  // ---- game art: the first candidate that loads; a failed URL is skipped everywhere ----
  const [failedArt, setFailedArt] = useState<ReadonlySet<string>>(() => new Set())
  const handleArtError = useCallback((url: string) => {
    setFailedArt((current) => (current.has(url) ? current : new Set(current).add(url)))
  }, [])

  const rows = useMemo((): SessionMomentRowModel[] =>
    visibleMoments.map((moment, index) => {
      const offsetSeconds = offsets[index]!
      const reasonLabel = momentRowReasonLabel(recapMomentReasonLabel(moment))
      const series = momentRowSeries(moment.reasons?.[0])
      const exactRollup = resolveMomentRowRollup({ moment, rollups, streamStartedAt })
      const { exact, emotes } = stripMomentEmotes({ moment, rollups, streamStartedAt, topEmotesCatalog })
      const rawScore = moment.reactionScore ?? moment.score
      const game = momentRowGameAt(games, offsetSeconds)
      return {
        key: `${offsetSeconds}:${moment.score}:${index}`,
        rank: index + 1,
        offsetSeconds,
        offsetLabel: momentRowHms(offsetSeconds),
        clockLabel: momentRowClock(streamStartedAt, offsetSeconds),
        reasonLabel,
        reasonTone: momentRowReasonTone(reasonLabel),
        series,
        score: typeof rawScore === 'number' && Number.isFinite(rawScore) ? Math.round(rawScore) : null,
        rate: momentRowRate(exactRollup, series),
        spark: momentRowSparkBars({ offsetSeconds, rollups, streamStartedAt, series }),
        game: game
          ? {
            name: game.gameName.trim(),
            artUrls: gameArtCandidates(game.boxArtUrl, game.categoryId, game.gameName)
              .filter((url) => !isKnownGenericTwitchArtwork(url, game.categoryId)),
          }
          : null,
        emotes,
        namesNotCaptured: momentRowNamesNotCaptured(exactRollup),
        snapshotOnly: !exact,
      }
    }),
  [visibleMoments, offsets, rollups, streamStartedAt, topEmotesCatalog, games])

  // ---- the reel: the top three as pictures (strip mode only) ----
  const reelOn = reel && lockMode === 'strip'
  const align = typeof vodAlignSeconds === 'number' && Number.isFinite(vodAlignSeconds) ? vodAlignSeconds : null
  // A frame needs the VOD and its verified alignment (PORT-PLAN §2.4); the tile is the one under the
  // middle of the moment's minute (sessionBarStrip frameMid).
  const vodAt = (offset: number) => (validVodId && align != null
    ? alignedVodOffset(offset, align, vodDurationSeconds ?? undefined) ?? null
    : null)
  const reelRows = reelOn ? rows.slice(0, REEL_SIZE) : []
  const listRows = reelOn ? rows.slice(REEL_SIZE) : rows
  const heroFrame = useVodFrame(validVodId, reelRows[0] ? vodAt(reelRows[0].offsetSeconds + 30) : null)

  // ---- shading: each backdrop row's gradient follows its own text (moment-rows.js shadeRows) ----
  const listRef = useRef<HTMLDivElement | null>(null)
  const hasMoments = moments.length > 0
  useLayoutEffect(() => {
    shadeSessionMomentRows(listRef.current)
  })
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => shadeSessionMomentRows(list))
      : null
    observer?.observe(list)
    let live = true
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    fonts?.ready?.then(() => {
      if (live) shadeSessionMomentRows(list)
    }).catch(() => {})
    return () => {
      live = false
      observer?.disconnect()
    }
  }, [hasMoments])

  if (!hasMoments) return null

  function closeDetail() {
    if (!open) return
    const offset = open.offset
    setOpen(null)
    clearTimeout(closeTimer.current)
    if (prefersReducedMotion()) {
      setClosing(null)
      return
    }
    setClosing(offset)
    closeTimer.current = setTimeout(() => setClosing(null), DETAIL_CLOSE_MS)
  }

  function lockMoment(offset: number) {
    setLocalLock({ offset })
    onSelectOffset(offset)
  }

  function releaseMoment(offset: number) {
    if (!onReleaseOffset) {
      // Nothing to release into: keep today's behaviour (the click re-selects).
      onSelectOffset(offset)
      return
    }
    setLocalLock({ offset: null })
    onReleaseOffset(offset)
  }

  function activateRow(offset: number, play: boolean) {
    if (lockMode === 'row') {
      if (open?.offset === offset) {
        if (play) {
          setOpen({ offset, play: true })
          return
        }
        closeDetail()
        // Closing the detail lets go of its chart selection (mockup onClose).
        if (lockedOffset === offset && onReleaseOffset) releaseMoment(offset)
        return
      }
      clearTimeout(closeTimer.current)
      setClosing(null)
      setOpen({ offset, play })
      lockMoment(offset)
      return
    }
    if (lockedOffset === offset) {
      if (play) onPlayOffset?.(offset)
      else releaseMoment(offset)
      return
    }
    lockMoment(offset)
    if (play) onPlayOffset?.(offset)
  }

  function toggleList() {
    if (listExpanded && open && openIndex >= baseCollapsed) {
      setOpen(null)
      setClosing(null)
    }
    setListExpanded(!listExpanded)
  }

  const isRightRail = layout === 'rightRail'
  const artFor = (model: SessionMomentRowModel) =>
    model.game?.artUrls.find((url) => !failedArt.has(url)) ?? null
  const reelCard = (model: SessionMomentRowModel, size: 'hero' | 'small') => (
    <MomentReelCard
      key={model.key}
      model={model}
      size={size}
      artUrl={artFor(model)}
      locked={lockedOffset === model.offsetSeconds}
      ghost={pinHover === model.offsetSeconds}
      showPlay={Boolean(validVodId)}
      pop={pop?.offset === model.offsetSeconds ? pop.token : 0}
      vodId={validVodId}
      frameVodOffset={vodAt(model.offsetSeconds + 30)}
      momentVodStart={vodAt(model.offsetSeconds)}
      alignSeconds={align}
      onActivate={(play) => activateRow(model.offsetSeconds, play)}
      onHover={(hovering) => onPreviewOffset?.(hovering ? model.offsetSeconds : null)}
      onArtError={handleArtError}
    />
  )
  const reelNoteText = reelRows.length > 0
    ? reelNote({
      frame: heroFrame.result?.frame ?? null,
      reason: heroFrame.result?.reason ?? null,
      loading: heroFrame.loading,
      hasArt: reelRows.some((model) => Boolean(artFor(model))),
    })
    : null
  const footerLabel = listExpanded
    ? 'Show fewer moments'
    : `Show ${hiddenCount} more moment${hiddenCount === 1 ? '' : 's'}`

  return (
    <section
      className={`ssr ${isRightRail ? 'ssr--rail' : 'ssr--below scroll-mt-24'}`}
      aria-label="Pulse moments recap"
      data-moment-lock-mode={lockMode}
    >
      {/* Inside the Moments tab the tab is the heading; kept for screen readers.
          The explainer moved into the tab's (i) (F17). */}
      <div className={isRightRail ? 'ssr-vh' : 'ssr-h'}>
        <h3>Pulse Moments</h3>
      </div>
      <p className="ssr-vh">Ranked by how strongly chat reacted, not by clip quality. Select one to watch it.</p>

      {lockMode === 'strip' && selectedDetail ? (
        <div className="ssr-pinned" data-moment-review-pinned>
          {selectedDetail}
        </div>
      ) : null}

      <div className="ssr-list" ref={listRef} data-moment-list>
        {reelRows.length > 0 ? (
          <div className="ssr-reel" data-moment-reel>
            {reelCard(reelRows[0]!, 'hero')}
            {reelRows.length > 1 ? (
              <div className="ssr-reel-two">
                {reelRows.slice(1).map((model) => reelCard(model, 'small'))}
              </div>
            ) : null}
            {reelNoteText ? <p className="ssr-reel-note" data-moment-reel-note>{reelNoteText}</p> : null}
          </div>
        ) : null}
        {listRows.map((model) => {
          const artUrl = artFor(model)
          const isOpen = lockMode === 'row' && open?.offset === model.offsetSeconds
          const isClosing = lockMode === 'row' && !isOpen && closing === model.offsetSeconds
          return (
            <MomentRowWithDetail
              key={model.key}
              model={model}
              artUrl={artUrl}
              lockMode={lockMode}
              locked={lockedOffset === model.offsetSeconds}
              isOpen={isOpen}
              isClosing={isClosing}
              detailId={detailId}
              ghost={pinHover === model.offsetSeconds}
              showPlay={Boolean(validVodId)}
              pop={pop?.offset === model.offsetSeconds ? pop.token : 0}
              autoPlay={isOpen && Boolean(open?.play)}
              selectedDetail={selectedDetail}
              vodId={validVodId}
              vodAlignSeconds={vodAlignSeconds}
              vodDurationSeconds={vodDurationSeconds}
              vodRecording={vodRecording}
              onActivate={(play) => activateRow(model.offsetSeconds, play)}
              onHover={(hovering) => onPreviewOffset?.(hovering ? model.offsetSeconds : null)}
              onArtError={handleArtError}
            />
          )
        })}
      </div>

      {canExpand ? (
        <button
          type="button"
          className="ssr-more"
          aria-expanded={listExpanded}
          onClick={toggleList}
          data-moment-list-more
        >
          {footerLabel}
        </button>
      ) : null}
    </section>
  )
}

function MomentRowWithDetail({
  model,
  artUrl,
  lockMode,
  locked,
  isOpen,
  isClosing,
  detailId,
  ghost,
  showPlay,
  pop,
  autoPlay,
  selectedDetail,
  vodId,
  vodAlignSeconds,
  vodDurationSeconds,
  vodRecording,
  onActivate,
  onHover,
  onArtError,
}: {
  model: SessionMomentRowModel
  artUrl: string | null
  lockMode: MomentLockMode
  locked: boolean
  isOpen: boolean
  isClosing: boolean
  detailId: string
  ghost: boolean
  showPlay: boolean
  pop: number
  autoPlay: boolean
  selectedDetail?: ReactNode
  vodId: string | null
  vodAlignSeconds?: number | null
  vodDurationSeconds?: number | null
  vodRecording: boolean
  onActivate: (play: boolean) => void
  onHover: (hovering: boolean) => void
  onArtError: (url: string) => void
}) {
  return (
    <>
      <SessionMomentRow
        model={model}
        artUrl={artUrl}
        lockMode={lockMode}
        locked={locked}
        expanded={isOpen}
        detailId={detailId}
        ghost={ghost}
        showPlay={showPlay}
        pop={pop}
        onActivate={onActivate}
        onHover={onHover}
        onArtError={onArtError}
      />
      {isOpen || isClosing ? (
        <SessionMomentDetail id={detailId} model={model} closing={isClosing}>
          {/* U14's MomentVodPanel / MomentPreviewTile can take this player's place once frames load. */}
          <SessionMomentPlayer
            model={model}
            artUrl={artUrl}
            vodId={vodId}
            vodAlignSeconds={vodAlignSeconds}
            vodDurationSeconds={vodDurationSeconds}
            vodRecording={vodRecording}
            autoPlay={autoPlay}
            onArtError={onArtError}
          />
          {selectedDetail ? (
            <div className="ssr-det-card" data-moment-review-pinned>
              {selectedDetail}
            </div>
          ) : null}
        </SessionMomentDetail>
      ) : null}
    </>
  )
}
