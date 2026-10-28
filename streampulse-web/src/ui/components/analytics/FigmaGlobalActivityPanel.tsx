import type { ReactNode } from "react";
import type { ActivitySummary } from "../../../lib/hubActivitySummary";
import {
  hubActivityHonestyChipLabel,
  hubActivityHonestyDetail,
} from "../../../lib/hubActivityHonesty";
import type { FigmaMomentRow } from "../../../lib/figmaSessionAnalytics";
import type { HubEmote, HubLiveChannel, PublicHub } from "../../../lib/publicHub";
import type { HubActivityRangeControl } from "../hub/HubActivityChart";
import type { HubSuggestion } from "../hub/HubSearch";
import { SystemStatusBadge } from "./primitives/SystemStatusBadge";
import { compact } from "./hubFormat";
// Keep this before hub.css: its readability floor overrides hub.css rules of the
// same weight (it used to arrive first through the HubActivityChart import).
import "../hub/hub-public-audit.css";
import "../hub/hub.css";

/**
 * The hub activity panel's status chips and props, shared with the d3-v5
 * activity panel (HubActivityPanelV5).
 */

export function CollectorHealthChip({ hub }: { hub: PublicHub }) {
  const roster = hub.corpusPipeline.roster;
  const active = roster.collectorTracking || hub.corpusPipeline.collectorActive;
  const expected =
    roster.expectedCollectorRows || hub.corpusPipeline.collectorMax;
  const deficit = roster.liveCollectorDeficitRows;
  const admissionStalled =
    roster.admissionDisabled > 0 || roster.metadataStale > 0;
  const hasIssue =
    admissionStalled || deficit > 0 || (expected > 0 && active < expected);
  if (!hasIssue) return null;

  const shortLabel = admissionStalled
    ? `Coverage degraded · ${compact(active)}/${compact(expected)} IRC collecting`
    : `Live chat limited · ${compact(active)}/${compact(expected)} IRC collecting`;

  const detail = [
    admissionStalled
      ? "IRC admission disabled or roster metadata stale."
      : "Live chat coverage limited.",
    `${compact(active)} live rows with active IRC collectors`,
    expected > 0 ? `${compact(expected)} expected from live roster` : null,
    deficit > 0 ? `${compact(deficit)} live channels without IRC yet` : null,
    "Chat and emote chart lines require an active IRC collector; viewer counts may still show from Helix.",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <SystemStatusBadge
      state="degraded"
      label={shortLabel}
      className="figma-global-activity__status-chip"
      title={detail}
    />
  );
}

export function ActivityHonestyChip({ hub }: { hub: PublicHub }) {
  const label = hubActivityHonestyChipLabel(hub.activity);
  if (!label) return null;
  const detail = hubActivityHonestyDetail(hub.activity);
  return (
    <SystemStatusBadge
      state="degraded"
      label={label}
      className="figma-global-activity__status-chip"
      title={detail ?? undefined}
    />
  );
}

export interface FigmaGlobalActivityPanelProps {
  hub: PublicHub;
  activitySummary: ActivitySummary;
  suggestions: HubSuggestion[];
  topEmotes?: HubEmote[];
  loading?: boolean;
  unavailable?: boolean;
  rangeControl?: HubActivityRangeControl;
  livePulseSource?:
    | "network"
    | "featured_fallback"
    | "legacy_fallback"
    | "empty";
  chartBucketSelectEnabled?: boolean;
  selectedBucketT?: number | null;
  onBucketSelect?: (bucketT: number | null) => void;
  /** Fired when the chart hover bucket changes (preview inspector). */
  onBucketHover?: (bucketT: number | null) => void;
  showSearch?: boolean;
  updatedAgo?: string;
  activityRefreshing?: boolean;
  /** Changes when the activity time window changes (24h/7d/…) — triggers crossfade. */
  activityWindowKey?: string;
  /** Emotes aggregated from bucket-filtered Pulse Moments (inspector fallback). */
  bucketMomentEmotes?: HubEmote[];
  /** Pulse Moments rows in the active chart bucket (selected or hover preview). */
  bucketMoments?: FigmaMomentRow[];
  /** Historical bucket fetch in flight (selected bucket only). */
  bucketMomentsLoading?: boolean;
  /** Compact link to selected Pulse Moments row (detail stays in table inspector). */
  linkedMoment?: {
    login: string;
    displayName?: string;
    label: string;
  } | null;
  onClearLinkedMoment?: () => void;
  liveChannels?: HubLiveChannel[];
  /** Visual-only bucket highlight when a moment is selected without a locked bucket. */
  accentBucketT?: number | null;
  selectedMomentKey?: string | null;
  onSelectMoment?: (moment: FigmaMomentRow) => void;
  /** Fresh Live Wire breakouts mounted directly above the chart they control. */
  annotationLane?: ReactNode;
}
