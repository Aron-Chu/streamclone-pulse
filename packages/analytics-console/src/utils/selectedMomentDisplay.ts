import {
  buildMomentScoreModel,
  computeMomentScore100,
  computeStreamBaselines,
  detectPickReason,
  heatmapEmotesFromRollup,
  momentScoreReasonLabel,
  recapMomentAnalyticalOffset,
  recapMomentSeekOffset,
  topEmotesFromRollup,
  type RollupEmoteHit,
} from "@streampulse/pulse-core";
import type {
  AnalyticsMinuteRollup,
  AnalyticsTopEmote,
  PulseRecapMoment,
} from "../apiTypes.ts";
import type {
  ReplayHeatmapDetailPoint,
  ReplayHeatmapPoint,
} from "../types/heatmap.ts";
import { minuteEmoteTotal } from "../components/analytics/chartRollupUtils.ts";
import { buildTwitchVodUrl, type VodLinkState } from "./twitchVodUrl.ts";
import { formatVodOffset, rollupOffsetSeconds } from "./consoleFormat.ts";
import { resolveMomentEmotesForOffset } from "./recapEmoteEnrich.ts";
import { recapEmotesToRollupHits } from "./momentRowDisplay.ts";

export interface SelectedMomentDisplay {
  /** Backward-compatible alias of analyticalOffsetSeconds. */
  offsetSeconds: number;
  analyticalOffsetSeconds: number;
  seekOffsetSeconds: number;
  offsetStr: string;
  /** Verified Twitch VOD timestamp label; absent when alignment is unknown. */
  vodJumpOffsetStr?: string;
  vodUrl?: string;
  scoreModel: ReturnType<typeof buildMomentScoreModel>;
  momentEmotes: RollupEmoteHit[];
  activityLine: string;
  gameName: string | null;
}

export function buildSelectedMomentDisplay({
  rollup,
  rollups,
  startedAt,
  vodLinkState,
  topEmotesCatalog,
  heatmapPoint,
  heatmapDetail,
  heatmapPoints,
  recapMoment,
  gameName = null,
  vodAlignSeconds,
}: {
  rollup: AnalyticsMinuteRollup;
  rollups: AnalyticsMinuteRollup[];
  startedAt?: string;
  vodLinkState: VodLinkState;
  topEmotesCatalog?: AnalyticsTopEmote[];
  heatmapPoint?: ReplayHeatmapPoint | null;
  heatmapDetail?: ReplayHeatmapDetailPoint | null;
  heatmapPoints?: ReplayHeatmapPoint[];
  recapMoment?: PulseRecapMoment | null;
  gameName?: string | null;
  /** Verified Twitch VOD alignment; without this, do not emit a jump offset. */
  vodAlignSeconds?: number | null;
}): SelectedMomentDisplay {
  const baselines = computeStreamBaselines(rollups);
  let analyticalOffsetSeconds = 0;
  let seekOffsetSeconds = 0;
  let offsetStr = "";
  if (startedAt) {
    const coarseOffsetSeconds = rollupOffsetSeconds(rollup, startedAt);
    analyticalOffsetSeconds = recapMoment
      ? recapMomentAnalyticalOffset(recapMoment)
      : coarseOffsetSeconds;
    seekOffsetSeconds = recapMoment
      ? recapMomentSeekOffset(recapMoment)
      : analyticalOffsetSeconds;
    offsetStr = formatVodOffset(analyticalOffsetSeconds);
  }

  const fallbackReason = detectPickReason(rollup, baselines, topEmotesCatalog);
  const scoreModel = buildMomentScoreModel({
    heatmapPoint,
    heatmapDetail,
    fallbackScore100: computeMomentScore100(rollup, baselines, rollups),
    fallbackReason,
    fallbackTopEmotes: heatmapEmotesFromRollup(rollup, 5, topEmotesCatalog),
  });

  // When this minute is a Pulse Moments row, prefer that row's score/reason/emotes
  // so Selected Moment and the rail cannot disagree for the same highlight.
  if (recapMoment && Number.isFinite(recapMoment.score)) {
    const reason =
      recapMoment.reasons?.[0]?.trim() || scoreModel.reason || "manual";
    scoreModel.score = Math.max(
      0,
      Math.min(100, Math.round(recapMoment.score)),
    );
    scoreModel.label = `${scoreModel.score}/100`;
    scoreModel.reason = reason;
    scoreModel.reasonLabel = momentScoreReasonLabel(reason);
    scoreModel.estimated = false;
  }

  const fromPulse =
    recapMoment && startedAt
      ? resolveMomentEmotesForOffset({
          moment: recapMoment,
          rollups,
          streamStartedAt: startedAt,
          heatmapPoints,
          topEmotesCatalog,
          limit: 3,
        })
      : [];
  const momentEmotes: RollupEmoteHit[] =
    fromPulse.length > 0
      ? recapEmotesToRollupHits(fromPulse, topEmotesCatalog)
      : topEmotesFromRollup(rollup, 3, topEmotesCatalog);

  const verifiedAlign =
    typeof vodAlignSeconds === "number" && Number.isFinite(vodAlignSeconds);
  const jumpOffset = verifiedAlign
    ? Math.max(0, Math.floor(vodAlignSeconds + seekOffsetSeconds))
    : 0;
  const vodJumpOffsetStr = verifiedAlign ? formatVodOffset(jumpOffset) : undefined;
  const vodUrl =
    vodLinkState.status === "linked" && vodLinkState.vodId
      ? buildTwitchVodUrl(vodLinkState.vodId, verifiedAlign ? jumpOffset : 0)
      : undefined;
  const chatCount = rollup.chatCount ?? 0;
  const emoteCount = minuteEmoteTotal(rollup);

  return {
    offsetSeconds: analyticalOffsetSeconds,
    analyticalOffsetSeconds,
    seekOffsetSeconds,
    offsetStr,
    vodJumpOffsetStr,
    vodUrl,
    scoreModel,
    momentEmotes,
    activityLine: `${chatCount} chat · ${emoteCount} emotes`,
    gameName: gameName?.trim() || null,
  };
}
