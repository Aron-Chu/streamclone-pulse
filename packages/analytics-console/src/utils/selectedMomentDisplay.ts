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
import { alignedVodOffset, buildTwitchVodUrl, type VodLinkState } from "./twitchVodUrl.ts";
import { formatVodOffset, rollupOffsetSeconds } from "./consoleFormat.ts";
import { resolveMomentEmotesForOffset } from "./recapEmoteEnrich.ts";
import { recapEmotesToRollupHits } from "./momentRowDisplay.ts";

export interface MomentVodJump {
  url: string;
  /** Verified Twitch VOD timestamp label; absent when alignment is unknown. */
  offsetStr?: string;
  seekOffsetSeconds: number;
}

/** Playback offset a moment should seek to, honouring a refined recap onset. */
export function momentSeekOffsetSeconds(args: {
  rollup: AnalyticsMinuteRollup;
  startedAt?: string;
  recapMoment?: PulseRecapMoment | null;
}): number {
  const { rollup, startedAt, recapMoment } = args;
  if (recapMoment) return recapMomentSeekOffset(recapMoment);
  if (!startedAt) return 0;
  return rollupOffsetSeconds(rollup, startedAt);
}

/**
 * The one place a selected moment turns into a Twitch VOD link.
 *
 * Both the chart's selection line and the Moments rail card call this, so a
 * jump can never be offered in one place and missing in the other, and neither
 * can invent a timestamp when VOD alignment is unverified.
 */
export function resolveMomentVodJump(args: {
  rollup: AnalyticsMinuteRollup;
  startedAt?: string;
  recapMoment?: PulseRecapMoment | null;
  vodLinkState: VodLinkState;
  vodAlignSeconds?: number | null;
  vodDurationSeconds?: number | null;
}): MomentVodJump | null {
  const { startedAt, vodLinkState, vodAlignSeconds, vodDurationSeconds } = args;
  const seekOffsetSeconds = momentSeekOffsetSeconds(args);
  if (vodLinkState.status !== "linked" || !vodLinkState.vodId) return null;
  const jumpOffset = startedAt
    ? alignedVodOffset(seekOffsetSeconds, vodAlignSeconds, vodDurationSeconds)
    : undefined;
  return {
    url: buildTwitchVodUrl(vodLinkState.vodId, jumpOffset ?? 0),
    offsetStr: jumpOffset === undefined ? undefined : formatVodOffset(jumpOffset),
    seekOffsetSeconds,
  };
}

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
  vodDurationSeconds,
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
  vodDurationSeconds?: number | null;
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

  // Keep the detection's score and reason; measured activity and emotes below
  // come from the selected minute so the list and inspector stay consistent.
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
  const measuredEmotes = topEmotesFromRollup(rollup, 3, topEmotesCatalog);
  const momentEmotes: RollupEmoteHit[] = rollup.emotes != null
    ? measuredEmotes
    : fromPulse.length > 0 ? recapEmotesToRollupHits(fromPulse, topEmotesCatalog) : measuredEmotes;

  const jump = resolveMomentVodJump({
    rollup,
    startedAt,
    recapMoment,
    vodLinkState,
    vodAlignSeconds,
    vodDurationSeconds,
  });
  const vodJumpOffsetStr = jump?.offsetStr;
  const vodUrl = jump?.url;
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
