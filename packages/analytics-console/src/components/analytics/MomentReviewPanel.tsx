import { useEffect, useMemo, useRef } from 'react'
import {
  OPENING_STREAM_EDGE,
  compareStreamEdgeLast,
  findRollupForMomentCandidate,
  heatmapEmoteToRollupHit,
  heatmapPointsToMomentCandidates,
  momentClockDisplay,
  momentStreamEdge,
  normalizeMinuteBucket,
  rollupFallbackMomentCandidates,
  streamEdgeLabel,
  topEmotesFromRollup,
  type RollupEmoteHit,
  type StreamEdgeKind,
  type StreamEdges,
} from '@streampulse/pulse-core'
import { viewerReadoutValue } from '@streampulse/pulse-charts'
import type { AnalyticsMinuteRollup, AnalyticsTopEmote } from '../../apiTypes.ts'
import type { ReplayHeatmapPoint } from '../../types/heatmap.ts'
import { minuteEmoteTotal, rollupHasMinuteData } from './chartRollupUtils.ts'
import { count, rollupOffsetSeconds } from '../../utils/consoleFormat.ts'
import { useConsoleMotion } from '../../hooks/useConsoleMotion.ts'
import { MomentListLegend, MomentRow, type MomentRowModel } from './MomentRow.tsx'

function momentRowEmotes(
  rollup: AnalyticsMinuteRollup,
  catalog: AnalyticsTopEmote[] | undefined,
  heatmapPoints: ReplayHeatmapPoint[] | undefined,
): RollupEmoteHit[] {
  const fromRollup = topEmotesFromRollup(rollup, 3, catalog)
  if (fromRollup.length > 0) return fromRollup
  if (!heatmapPoints?.length) return []
  const bucket = normalizeMinuteBucket(rollup.minuteTs)
  const point = heatmapPoints.find(
    (entry) =>
      entry.minuteTs === rollup.minuteTs
      || normalizeMinuteBucket(entry.minuteTs) === bucket,
  )
  if (!point?.topEmotes?.length) return []
  return point.topEmotes
    .slice(0, 3)
    .map((emote) => heatmapEmoteToRollupHit(emote, catalog))
    .filter((emote): emote is RollupEmoteHit => Boolean(emote))
}

export function MomentReviewPanel({
  rollups,
  selectedRollup,
  previewRollup,
  onSelectRollup,
  onPreviewRollup,
  topEmotesCatalog,
  heatmapPoints,
  streamStartedAt,
  streamEdges,
  embedded = false,
}: {
  rollups: AnalyticsMinuteRollup[]
  selectedRollup: AnalyticsMinuteRollup | null
  previewRollup?: AnalyticsMinuteRollup | null
  onSelectRollup: (rollup: AnalyticsMinuteRollup) => void
  onPreviewRollup?: (rollup: AnalyticsMinuteRollup | null) => void
  topEmotesCatalog?: AnalyticsTopEmote[]
  heatmapPoints?: ReplayHeatmapPoint[]
  streamStartedAt?: string
  /** The page's stream edges, so a row at either end carries the list's edge tag. */
  streamEdges?: StreamEdges
  embedded?: boolean
}) {
  const { motionEnabled } = useConsoleMotion()
  const scrollRef = useRef<HTMLDivElement>(null)

  const candidates = useMemo(() => {
    const catalog = topEmotesCatalog
    const momentCandidates = heatmapPoints?.length
      ? heatmapPointsToMomentCandidates(heatmapPoints, streamStartedAt, catalog)
      : rollupFallbackMomentCandidates(rollups, catalog, streamStartedAt)

    // A backend streamEdge flag on the heatmap point wins over the offset (pulse-core momentStreamEdge)
    const backendEdgeByMinute = new Map<string, string>()
    for (const point of heatmapPoints ?? []) {
      const flag = (point as { streamEdge?: string | null }).streamEdge
      if (flag) backendEdgeByMinute.set(normalizeMinuteBucket(point.minuteTs), flag)
    }
    const edges = streamEdges ?? OPENING_STREAM_EDGE

    const rows: Array<{
      rollup: AnalyticsMinuteRollup
      score: number
      scoreLabel: string
      reasonLabel: string
      estimated: boolean
      offsetSeconds: number | null
      streamEdge: StreamEdgeKind | undefined
    }> = []
    for (const candidate of momentCandidates) {
      const rollup = findRollupForMomentCandidate(rollups, candidate) as AnalyticsMinuteRollup | undefined
      if (!rollup) continue
      const offsetSeconds = streamStartedAt ? rollupOffsetSeconds(rollup, streamStartedAt) : null
      rows.push({
        rollup,
        score: candidate.score,
        scoreLabel: candidate.scoreLabel,
        reasonLabel: candidate.reasonLabel,
        estimated: candidate.estimated,
        offsetSeconds,
        streamEdge: momentStreamEdge(
          {
            offsetSeconds: offsetSeconds ?? Number.NaN,
            streamEdge: backendEdgeByMinute.get(normalizeMinuteBucket(candidate.minuteTs)),
          },
          edges,
        ),
      })
    }
    // E1 (11-13): hello / goodbye spam at the stream's edges ranks after every other moment, as in every
    // other moment list; the stable sort keeps the score order within each group
    return rows.sort(compareStreamEdgeLast)
  }, [heatmapPoints, rollups, streamEdges, streamStartedAt, topEmotesCatalog])

  const topScore = useMemo(
    () => candidates.reduce((max, row) => Math.max(max, row.score ?? 0), 0),
    [candidates],
  )

  const rows = useMemo((): MomentRowModel[] =>
    candidates.map(({ rollup, score, reasonLabel, estimated, offsetSeconds, streamEdge }, index) => {
      // K1 (11-13): the session's one clock; minute data only knows the minute, so the row prints a quiet
      // 'about' before it (SessionMomentClock) and the list's edge tag at either end of the stream (round 2),
      // from the same edge the rail is sorted by
      const clock = offsetSeconds != null ? momentClockDisplay({ offsetSeconds, precisionSeconds: 60 }) : null
      const offsetLabel = clock
        ? clock.text
        : new Date(rollup.minuteTs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      const viewers = viewerReadoutValue(rollup)
      return {
        key: `${rollup.minuteTs}-${index}`,
        rank: index + 1,
        primaryTime: offsetLabel,
        approximate: clock?.approximate ?? false,
        edgeLabel: streamEdge ? streamEdgeLabel(streamEdge) : null,
        score,
        scoreRatio: topScore > 0 ? score / topScore : 0,
        reasonLabel,
        reasonCode: reasonLabel,
        scoreNote: estimated
          ? 'estimated from rollups until heatmap scoring is available'
          : 'from the backend replay heatmap',
        statsLine: [
          viewers == null ? 'viewer sample unavailable' : `${count(viewers)} viewers`,
          `${count(rollup.chatCount ?? 0)} chat/min`,
          `${count(minuteEmoteTotal(rollup))} emotes/min`,
        ].join(' · '),
        emotes: momentRowEmotes(rollup, topEmotesCatalog, heatmapPoints).map(emote => ({
          name: emote.name,
          count: emote.count,
          provider: emote.provider,
          imageUrl: emote.image_url,
          key: emote.key,
        })),
      }
    }),
  [candidates, heatmapPoints, topEmotesCatalog, topScore])

  useEffect(() => {
    if (!selectedRollup?.minuteTs) return
    const container = scrollRef.current
    if (!container) return
    const row = container.querySelector<HTMLElement>(
      `[data-moment-scroll-anchor][data-minute-ts="${CSS.escape(selectedRollup.minuteTs)}"]`,
    )
    if (!row) return
    // Scroll only the list's own box. scrollIntoView also scrolls the page, and
    // on phones/tablets the list sits below the chart, so selecting a minute
    // pushed the chart off-screen.
    const box = container.getBoundingClientRect()
    const rect = row.getBoundingClientRect()
    const delta = rect.top < box.top
      ? rect.top - box.top
      : rect.bottom > box.bottom ? Math.min(rect.bottom - box.bottom, rect.top - box.top) : 0
    if (delta === 0) return
    container.scrollTo({ top: container.scrollTop + delta, behavior: motionEnabled ? 'smooth' : 'instant' })
  }, [selectedRollup?.minuteTs, motionEnabled])

  if (candidates.length < 2) {
    return (
      <div
        className={`${
          embedded ? 'px-3 py-4' : 'rounded border border-white/[0.07] bg-[#0d0d12] p-3'
        } text-center text-xs font-semibold text-zinc-400`}
      >
        {rollups.some(rollupHasMinuteData)
          ? 'Not enough peaks yet — wait for more minutes.'
          : 'Ranked moments appear once live minute buckets land.'}
      </div>
    )
  }

  return (
    <div className={embedded ? 'p-3' : 'rounded border border-white/[0.07] bg-[#0d0d12] p-3'}>
      <div className="mb-2 flex flex-col gap-0.5">
        <div className="text-xs font-black uppercase text-zinc-400">Top Moments</div>
        <MomentListLegend />
      </div>
      <div ref={scrollRef} className="sc-console-scroll flex max-h-72 flex-col gap-1 overflow-y-auto">
        {rows.map((row, index) => {
          const rollup = candidates[index]!.rollup
          const isSelected = selectedRollup?.minuteTs === rollup.minuteTs
          return (
            <div key={row.key} data-minute-ts={rollup.minuteTs} data-moment-scroll-anchor>
              <MomentRow
                model={row}
                selected={isSelected}
                previewed={!isSelected && previewRollup?.minuteTs === rollup.minuteTs}
                onSelect={() => onSelectRollup(rollup)}
                onPreview={(hovering) => onPreviewRollup?.(hovering ? rollup : null)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
