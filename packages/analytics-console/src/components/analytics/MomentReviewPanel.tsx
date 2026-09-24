import { useEffect, useMemo, useRef } from 'react'
import {
  findRollupForMomentCandidate,
  formatHeatOffset,
  heatmapEmoteToRollupHit,
  heatmapPointsToMomentCandidates,
  normalizeMinuteBucket,
  rollupFallbackMomentCandidates,
  topEmotesFromRollup,
  type RollupEmoteHit,
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
  embedded?: boolean
}) {
  const { motionEnabled } = useConsoleMotion()
  const scrollRef = useRef<HTMLDivElement>(null)

  const candidates = useMemo(() => {
    const catalog = topEmotesCatalog
    const momentCandidates = heatmapPoints?.length
      ? heatmapPointsToMomentCandidates(heatmapPoints, streamStartedAt, catalog)
      : rollupFallbackMomentCandidates(rollups, catalog, streamStartedAt)

    const rows: Array<{
      rollup: AnalyticsMinuteRollup
      score: number
      scoreLabel: string
      reasonLabel: string
      estimated: boolean
    }> = []
    for (const candidate of momentCandidates) {
      const rollup = findRollupForMomentCandidate(rollups, candidate) as AnalyticsMinuteRollup | undefined
      if (!rollup) continue
      rows.push({
        rollup,
        score: candidate.score,
        scoreLabel: candidate.scoreLabel,
        reasonLabel: candidate.reasonLabel,
        estimated: candidate.estimated,
      })
    }
    return rows
  }, [heatmapPoints, rollups, streamStartedAt, topEmotesCatalog])

  const topScore = useMemo(
    () => candidates.reduce((max, row) => Math.max(max, row.score ?? 0), 0),
    [candidates],
  )

  const rows = useMemo((): MomentRowModel[] =>
    candidates.map(({ rollup, score, reasonLabel, estimated }, index) => {
      const offsetLabel = streamStartedAt
        ? formatHeatOffset(rollupOffsetSeconds(rollup, streamStartedAt))
        : new Date(rollup.minuteTs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      const viewers = viewerReadoutValue(rollup)
      return {
        key: `${rollup.minuteTs}-${index}`,
        rank: index + 1,
        primaryTime: offsetLabel,
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
  [candidates, heatmapPoints, streamStartedAt, topEmotesCatalog, topScore])

  useEffect(() => {
    if (!selectedRollup?.minuteTs) return
    const container = scrollRef.current
    if (!container) return
    const row = container.querySelector<HTMLElement>(
      `[data-moment-scroll-anchor][data-minute-ts="${CSS.escape(selectedRollup.minuteTs)}"]`,
    )
    row?.scrollIntoView({ block: 'nearest', behavior: motionEnabled ? 'smooth' : 'instant' })
  }, [selectedRollup?.minuteTs, motionEnabled])

  if (candidates.length < 2) {
    return (
      <div
        className={`${
          embedded ? 'px-3 py-4' : 'rounded border border-white/[0.07] bg-[#0d0d12] p-3'
        } text-center text-xs font-semibold text-zinc-500`}
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
        <div className="text-xs font-black uppercase text-zinc-500">Top Moments</div>
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
