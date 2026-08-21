export interface SourceStatus {
  source: string;
  state: string;
  label?: string;
}

export interface AnalyticsStream {
  streamId: string;
  broadcasterId?: string;
  canonicalStreamId?: string;
  login: string;
  displayName?: string;
  title?: string;
  category?: string;
  categoryId?: string;
  gamesSummary?: string;
  startedAt: string;
  endedAt?: string | null;
  lastSeenAt?: string;
  currentViewers?: number;
  peakViewers?: number;
  avgViewers?: number;
  viewerSamples?: number;
  chatMessages?: number;
  vodId?: string;
}

export interface ChannelEmote {
  name: string;
  emote_id: string;
  url: string;
  zw: boolean;
  provider?: string;
}

export interface ChatCoverageSummary {
  coveragePct?: number;
  chatSpanMinutes?: number;
  streamSpanMinutes?: number;
  partial?: boolean;
}

/**
 * Per-metric provenance for a single minute. Backend-authored: the client must
 * never synthesise these. Absent until the BFF emits them, in which case every
 * consumer degrades to `unknown` rather than guessing.
 */
export type SignalObservationMetric = "chat" | "emotes" | "viewers";

export interface SignalObservationFact {
  state: "measured" | "missing" | "partial" | "unknown";
  observedAt: string | null;
  coveragePct?: number;
  source?: string;
}

export interface SignalWatermarkFact {
  state: "current" | "partial" | "stale" | "unknown";
  observedThrough: string | null;
  coveragePct?: number;
  source?: string;
}

export interface AnalyticsMinuteRollup {
  minuteTs: string;
  viewerAvg?: number;
  viewerMax?: number;
  viewerLatest?: number;
  viewerSamples?: number;
  chatCount?: number;
  totalEmoteCount?: number;
  seventvEmoteCount?: number;
  emotes?: Record<string, number>;
  missing?: boolean;
  /** Backend-authored per-metric provenance; omitted until the BFF emits it. */
  signalObservations?: Partial<
    Record<SignalObservationMetric, SignalObservationFact>
  >;
}

export interface AnalyticsTopEmote {
  key: string;
  name: string;
  id?: string;
  provider?: string;
  imageUrl?: string;
  count: number;
}

/** Backend-authored session facts — do not invent client heuristics from these. */
export interface CoverageGapRange {
  fromOffsetSeconds: number;
  toOffsetSeconds: number;
}

export interface SessionAvailability {
  version?: string;
  chartUsable?: boolean;
  chartState?: "usable" | "warming" | "limited" | "unavailable" | string;
  coveragePct?: number;
  missingRanges?: CoverageGapRange[];
  coverageMessage?: string;
  liveDvrState?: "live" | "ended" | "unknown" | string;
  vodState?:
    | "pending_live"
    | "resolving"
    | "linked"
    | "unavailable"
    | "request_failed"
    | "none"
    | string;
  vodId?: string;
  vodMessage?: string;
  backfillState?: string;
  corpusState?: "ready" | "missing" | "optional_absent" | string;
  corpusMessage?: string;
}

export interface AnalyticsStreamDetail {
  channel: string;
  state: "live" | "historical" | "not_collected" | "syncing" | string;
  stream?: AnalyticsStream;
  rollups: AnalyticsMinuteRollup[];
  /** Full timeline rollups for moments panel; chart uses downsampled `rollups`. */
  momentRollups?: AnalyticsMinuteRollup[];
  topEmotes: AnalyticsTopEmote[];
  sources: SourceStatus[];
  updatedAt: number;
  vodId?: string;
  vodAlignSeconds?: number;
  syncPhase?: string;
  chatCoveragePct?: number;
  chatCoverage?: ChatCoverageSummary;
  viewerSource?: string;
  timelineMinutes?: number;
  analyticsQuality?: string;
  coverageStartOffsetSeconds?: number;
  /** Hosted portal: detail loaded but /minutes fetch failed or returned empty. */
  minutesUnavailable?: boolean;
  /** Independent quality / coverage / VOD / corpus facts from the BFF. */
  availability?: SessionAvailability;
  /** Backend-authored per-metric freshness watermarks; omitted until the BFF emits them. */
  signalWatermarks?: Partial<
    Record<SignalObservationMetric, SignalWatermarkFact>
  >;
}

export interface AnalyticsStreamsResponse {
  channel: string;
  items: AnalyticsStream[];
  sources: SourceStatus[];
  updatedAt: number;
}

export interface GameSegment {
  id: number;
  streamId: string;
  gameName: string;
  boxArtUrl: string;
  categoryId?: string;
  offsetSeconds: number;
  durationSeconds: number;
  createdAt: string;
  source?: string;
}

export type SyncPhase =
  | "starting"
  | "scraping_tracker"
  | "parsing_tracker"
  | "resolving_vod"
  | "fetching_comments"
  | "writing_rollups"
  | "exporting_archive"
  | "export_pending"
  | "completed"
  | "failed"
  | string;

export interface StreamSummaryMetrics {
  sync_health_state?: string;
  data_coverage_pct?: number;
  minutesWithData?: number;
  viewerSampleCount?: number;
}

export interface StreamSummaryResponse {
  channel?: string;
  metrics?: StreamSummaryMetrics;
  topEmotes?: AnalyticsTopEmote[];
  analyticsQuality?: string;
  updatedAt?: number;
}

export interface SyncStatus {
  streamId: string;
  phase: SyncPhase;
  message?: string;
  startedAt?: string;
  updatedAt: string;
  stale?: boolean;
  error?: string;
  viewerStatus?: string;
  rollupsWritten?: number;
  viewersOnly?: boolean;
}

export interface PulseBookmark {
  id: string;
  login?: string;
  streamId?: string;
  label?: string;
}

export interface PulseRecapEmote {
  code: string;
  count: number;
  provider?: string;
  id?: string;
  imageUrl?: string;
}

/**
 * Backend-confirmed peak detection for a recap moment. Consumers must treat an
 * absent or unconfirmed observation as "not a peak" — never infer one locally.
 */
export interface PeakObservationFact extends SignalObservationFact {
  confirmed?: boolean;
  detector?: string;
  value?: number;
}

export interface PulseRecapMoment {
  offsetSeconds: number;
  score: number;
  compositeScore?: number;
  reactionScore?: number;
  viewerMomentumScore?: number;
  reactionOnsetOffsetSeconds?: number;
  reactionApexOffsetSeconds?: number;
  seekOffsetSeconds?: number;
  precisionSeconds?: number;
  refinementStatus?: string;
  refinementConfidence?: number;
  reactionScoringVersion?: string;
  reasons?: string[];
  topEmotes?: PulseRecapEmote[];
  viewerCount?: number;
  chatCount?: number;
  emoteCount?: number;
  /** Backend-authored peak confirmation; omitted until the BFF emits it. */
  peakObservation?: PeakObservationFact;
}

export interface PulseStreamRecap {
  streamId: string;
  login?: string;
  vodId?: string;
  durationSeconds?: number;
  totalMessages?: number;
  peakChatPerMin?: number;
  topMoments?: PulseRecapMoment[];
  topEmotes?: PulseRecapEmote[];
  biggestChatSpike?: {
    offsetSeconds: number;
    chatPerMin: number;
  };
  funniestEmoteBurst?: {
    offsetSeconds: number;
    code?: string;
    count: number;
  };
  clipCandidates?: PulseRecapMoment[];
}
