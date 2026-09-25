import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  formatMomentTimeLabel,
  mergeRecapMoments,
  recapMomentAnalyticalOffset,
  recapMomentReasonLabel,
} from "@streampulse/pulse-core";
import type {
  AnalyticsMinuteRollup,
  AnalyticsTopEmote,
  PulseRecapMoment,
  PulseStreamRecap,
} from "../../apiTypes.ts";
import type { ReplayHeatmapPoint } from "../../types/heatmap.ts";
import { resolveMomentEmotesForOffset } from "../../utils/recapEmoteEnrich.ts";
import {
  resolveMomentRowStats,
  resolveMomentRowRollup,
  resolveRollupDisplayEmotes,
} from "../../utils/momentRowDisplay.ts";
import {
  CollapseListFooter,
  enrichRecapMomentsFromHeatmap,
  MOMENTS_INITIAL_VISIBLE,
  MOMENTS_MAX_VISIBLE,
  useCollapsedList,
} from "../../utils/momentListDisplay.tsx";
import { count } from "../../utils/consoleFormat.ts";
import {
  MomentListLegend,
  MomentRow,
  type MomentRowEmote,
  type MomentRowModel,
} from "./MomentRow.tsx";

function momentStatsLine(stats: {
  viewers: number | null | undefined;
  chatPerMin: number | null | undefined;
  emotesPerMin: number | null | undefined;
}): string {
  return [
    stats.viewers == null ? "viewer sample unavailable" : `${count(stats.viewers)} viewers`,
    stats.chatPerMin == null ? "chat unavailable" : `${count(stats.chatPerMin)} chat/min`,
    stats.emotesPerMin == null ? "emotes unavailable" : `${count(stats.emotesPerMin)} emotes/min`,
  ].join(" · ");
}

export function SessionRecapMomentsStrip({
  recap,
  streamStartedAt,
  selectedOffsetSeconds,
  onSelectOffset,
  onPreviewOffset,
  layout = "rightRail",
  rollups = [],
  heatmapPoints,
  topEmotesCatalog,
  selectedDetail,
}: {
  recap: PulseStreamRecap;
  streamStartedAt?: string;
  selectedOffsetSeconds?: number | null;
  onSelectOffset: (offsetSeconds: number) => void;
  onPreviewOffset?: (offsetSeconds: number | null) => void;
  layout?: "belowChart" | "rightRail";
  rollups?: AnalyticsMinuteRollup[];
  heatmapPoints?: ReplayHeatmapPoint[];
  topEmotesCatalog?: AnalyticsTopEmote[];
  selectedDetail?: ReactNode;
}) {
  const hasReactionCoverage = useMemo(() => {
    const moments = [
      ...(recap.topMoments ?? []),
      ...(recap.clipCandidates ?? []),
    ];
    return (
      moments.some(
        (moment) => (moment.chatCount ?? 0) > 0 || (moment.emoteCount ?? 0) > 0,
      ) || (recap.totalMessages ?? 0) > 0
    );
  }, [recap]);

  const moments = useMemo(() => {
    const merged = mergeRecapMoments(
      recap,
      undefined,
      MOMENTS_MAX_VISIBLE,
      hasReactionCoverage,
    );
    return enrichRecapMomentsFromHeatmap(
      merged,
      heatmapPoints,
      streamStartedAt,
      topEmotesCatalog,
      MOMENTS_MAX_VISIBLE,
      MOMENTS_INITIAL_VISIBLE,
    );
  }, [
    recap,
    hasReactionCoverage,
    heatmapPoints,
    streamStartedAt,
    topEmotesCatalog,
  ]);

  const {
    visible: visibleMoments,
    expanded: momentsExpanded,
    canExpand: canExpandMoments,
    hiddenCount: hiddenMomentCount,
    toggle: toggleMomentsExpanded,
  } = useCollapsedList(
    moments,
    MOMENTS_INITIAL_VISIBLE,
    MOMENTS_MAX_VISIBLE,
    recap.streamId,
  );

  const [selectedOffset, setSelectedOffset] = useState<number | null>(
    selectedOffsetSeconds ?? null,
  );
  const stripSelectedOffset = useRef<number | null>(null);

  useEffect(() => {
    if (selectedOffsetSeconds == null) return;
    if (stripSelectedOffset.current != null) {
      const delta = Math.abs(
        selectedOffsetSeconds - stripSelectedOffset.current,
      );
      if (delta <= 90) {
        stripSelectedOffset.current = null;
      }
      return;
    }
    setSelectedOffset(selectedOffsetSeconds);
  }, [selectedOffsetSeconds]);

  useEffect(() => {
    stripSelectedOffset.current = null;
    setSelectedOffset(null);
  }, [recap.streamId]);

  // Deliberately no auto-select. Pre-pinning moment #1 dropped the user into a
  // playhead they never set — on a live session, hours behind the live edge —
  // and left an "Esc to release" hint for a selection they never made.

  const highlightOffset = selectedOffset ?? selectedOffsetSeconds ?? null;
  const highlightedMoment = useMemo(() => {
    if (moments.length === 0 || highlightOffset == null) return null;
    let best = moments[0];
    let bestDelta = Math.abs(
      recapMomentAnalyticalOffset(moments[0]) - highlightOffset,
    );
    for (const moment of moments) {
      const delta = Math.abs(recapMomentAnalyticalOffset(moment) - highlightOffset);
      if (delta < bestDelta) {
        best = moment;
        bestDelta = delta;
      }
    }
    return bestDelta <= 90 ? best : null;
  }, [highlightOffset, moments]);

  // Scale the intensity bars against the loudest moment in the full list, not
  // the visible slice, so expanding the list never rescales the top rows.
  const topScore = useMemo(
    () => moments.reduce((max, moment) => Math.max(max, moment.score ?? 0), 0),
    [moments],
  );

  const rows = useMemo((): MomentRowModel[] =>
    visibleMoments.map((moment, index) => {
      const momentOffsetSeconds = recapMomentAnalyticalOffset(moment);
      const time = formatMomentTimeLabel({
        startedAtIso: streamStartedAt,
        offsetSeconds: momentOffsetSeconds,
      });
      const stats = resolveMomentRowStats({ moment, rollups, streamStartedAt });
      const exactRollup = resolveMomentRowRollup({ moment, rollups, streamStartedAt });
      const emotes: MomentRowEmote[] = exactRollup
        ? resolveRollupDisplayEmotes({ rollup: exactRollup, topEmotesCatalog }).map(
            (emote) => ({
              name: emote.name,
              count: emote.count,
              provider: emote.provider,
              imageUrl: emote.image_url,
              key: emote.key,
            }),
          )
        : resolveMomentEmotesForOffset({
            moment,
            rollups: [],
            streamStartedAt,
            topEmotesCatalog,
            limit: 3,
          }).map((emote) => ({
            name: emote.code,
            count: emote.count,
            provider: emote.provider,
            id: emote.id,
            imageUrl: emote.imageUrl,
          }));
      const reasonLabel = recapMomentReasonLabel(moment);

      return {
        key: `${momentOffsetSeconds}:${moment.score}:${index}`,
        rank: index + 1,
        primaryTime: time.primary,
        secondaryTime: time.secondary,
        score: moment.score,
        scoreRatio: topScore > 0 ? moment.score / topScore : 0,
        reasonLabel,
        reasonCode: moment.reasons?.[0] ?? reasonLabel,
        statsLine: momentStatsLine(stats),
        snapshotOnly: !exactRollup,
        emotes,
      };
    }),
  [rollups, streamStartedAt, topEmotesCatalog, topScore, visibleMoments]);

  if (moments.length === 0) return null;

  function selectMoment(moment: PulseRecapMoment) {
    const offsetSeconds = recapMomentAnalyticalOffset(moment);
    stripSelectedOffset.current = offsetSeconds;
    setSelectedOffset(offsetSeconds);
    onSelectOffset(offsetSeconds);
  }

  const isRightRail = layout === "rightRail";
  const highlightedOffset = highlightedMoment
    ? recapMomentAnalyticalOffset(highlightedMoment)
    : null;

  return (
    <section
      className={`relative flex min-h-0 flex-col overflow-hidden rounded border border-white/[0.07] bg-white/[0.025] ${
        isRightRail ? "flex-1" : "scroll-mt-24"
      }`}
      aria-label="Pulse moments recap"
    >
      <div className="absolute left-0 right-0 top-0 h-0.5 bg-gradient-to-r from-amber-500/20 via-amber-400/50 to-amber-500/20" />

      <div className="shrink-0 px-3 pb-2 pt-3">
        <h3 className="text-xs font-black uppercase text-zinc-400">
          Pulse Moments
        </h3>
        <div className="mt-0.5">
          <MomentListLegend />
        </div>
      </div>

      {/* The review card is pinned above the list instead of injected between
          rows. Expanding in place shoved every lower-ranked row down and
          changed the scroll height on each click, so the ranking stopped being
          a stable thing to scan. */}
      {selectedDetail ? (
        <div className="shrink-0 border-t border-white/[0.07] px-2 pb-2 pt-2" data-moment-review-pinned>
          {selectedDetail}
        </div>
      ) : null}

      <div className="sc-console-scroll min-h-0 flex-1 overflow-y-auto border-y border-white/[0.07]">
        <div className="flex flex-col gap-0.5 p-1">
          {rows.map((row, index) => {
            const moment = visibleMoments[index]!;
            const momentOffsetSeconds = recapMomentAnalyticalOffset(moment);
            return (
              <MomentRow
                key={row.key}
                model={row}
                selected={highlightedOffset === momentOffsetSeconds}
                expanded={
                  highlightedOffset === momentOffsetSeconds && Boolean(selectedDetail)
                }
                onSelect={() => selectMoment(moment)}
                onPreview={(hovering) =>
                  onPreviewOffset?.(hovering ? momentOffsetSeconds : null)
                }
              />
            );
          })}
        </div>
      </div>

      <CollapseListFooter
        expanded={momentsExpanded}
        canExpand={canExpandMoments}
        hiddenCount={hiddenMomentCount}
        onToggle={toggleMomentsExpanded}
        expandLabel={(hidden) =>
          `Show ${hidden} more moment${hidden === 1 ? "" : "s"}`
        }
        collapseLabel="Show fewer moments"
      />
    </section>
  );
}
