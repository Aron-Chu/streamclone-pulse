import type { ActivitySummary } from "../../../lib/hubActivitySummary";
import {
  bucketMinutes,
  formatActivityWindowLabel,
} from "../../../lib/hubActivitySummary";
import type { HubEmote, PublicHub } from "../../../lib/publicHub";
import {
  HubActivityChart,
  type HubActivityRangeControl,
} from "../hub/HubActivityChart";
import { HubSearch, type HubSuggestion } from "../hub/HubSearch";
import { TopEmotesPanel } from "./TopEmotesPanel";
import { HubFreshnessCaption } from "./HubFreshnessCaption";
import { compact } from "./hubFormat";
import { Link } from "react-router-dom";
import "../hub/hub.css";

/**
 * Honest live-collector health note. Live chat/emote lines only exist for
 * channels that have an active IRC collector; when admission is disabled or the
 * roster metadata is stale, most live channels stay viewer-only. Surface that
 * truth instead of implying every live channel is chat-tracked. Renders nothing
 * when the roster is healthy (or the hub omits roster data).
 */
function CollectorHealthNote({ hub }: { hub: PublicHub }) {
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

  const parts = [
    `${compact(active)} active IRC collector${active === 1 ? "" : "s"}`,
  ];
  if (expected > 0) parts.push(`${compact(expected)} expected`);
  if (deficit > 0) parts.push(`${compact(deficit)} live channels uncovered`);

  return (
    <div className="figma-collector-note" role="status">
      <span className="figma-collector-note__dot" aria-hidden="true" />
      <span>
        <strong>
          {admissionStalled
            ? "IRC admission disabled/stale"
            : "Live chat coverage limited"}
        </strong>{" "}
        - {parts.join(" - ")}. Only channels with an active collector show
        chat/emote lines; the rest are viewer-only.
      </span>
    </div>
  );
}

/**
 * Chart provenance strip ("Source: hosted API + IRC worker plane - window - buckets"). Now
 * rendered at the very bottom of the analytics page rather than above the chart,
 * so it reads as a footer/provenance note instead of competing with the search.
 */
export function ChartSourceBanner({
  hub,
  activitySummary,
  className,
}: {
  hub: PublicHub;
  activitySummary: ActivitySummary;
  className?: string;
}) {
  const windowLabel = formatActivityWindowLabel(hub.activity.windowMinutes);
  const bucket = bucketMinutes(hub.activity.windowMinutes);

  return (
    <div
      className={`figma-chart-source${className ? ` ${className}` : ""}`}
      aria-label="Chart rollup source"
    >
      <span>
        <strong>Source:</strong> Hosted API + live IRC collector plane
      </span>
      <span>
        <strong>Window:</strong> last {windowLabel}
      </span>
      <span>
        <strong>Buckets:</strong> ~{bucket} min - {activitySummary.pointCount}/
        {activitySummary.expectedBuckets}
      </span>
      <span className="figma-chart-source__links">
        <Link to="/status">Status</Link>
      </span>
    </div>
  );
}

export interface FigmaGlobalActivityPanelProps {
  hub: PublicHub;
  activitySummary: ActivitySummary;
  suggestions: HubSuggestion[];
  topEmotes?: HubEmote[];
  loading?: boolean;
  rangeControl?: HubActivityRangeControl;
  livePulseSource?:
    | "network"
    | "featured_fallback"
    | "legacy_fallback"
    | "empty";
  chartBucketSelectEnabled?: boolean;
  selectedBucketT?: number | null;
  onBucketSelect?: (bucketT: number | null) => void;
  showSearch?: boolean;
  updatedAgo?: string;
  activityRefreshing?: boolean;
}

function formatPeakTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function FigmaGlobalActivityPanel({
  hub,
  activitySummary,
  suggestions,
  topEmotes = [],
  loading,
  rangeControl,
  livePulseSource = "empty",
  chartBucketSelectEnabled = false,
  selectedBucketT = null,
  onBucketSelect,
  showSearch = true,
  updatedAgo,
  activityRefreshing = false,
}: FigmaGlobalActivityPanelProps) {
  const windowLabel = formatActivityWindowLabel(hub.activity.windowMinutes);
  const emoteImages = new Map<string, string>();
  for (const emote of topEmotes) {
    if (emote.imageUrl) emoteImages.set(emote.name.toLowerCase(), emote.imageUrl);
  }
  const peakPoint = hub.activity.points.reduce(
    (best, point) => (point.viewers > (best?.viewers ?? 0) ? point : best),
    hub.activity.points[0],
  );
  const peakChatPoint = hub.activity.points.reduce(
    (best, point) => (point.chat > (best?.chat ?? 0) ? point : best),
    hub.activity.points[0],
  );
  const chartNote = chartBucketSelectEnabled
    ? "Click a recent bucket (last ~3h) to highlight matching IRC peaks below."
    : livePulseSource === "featured_fallback" ||
        livePulseSource === "legacy_fallback"
      ? "Chart clicks don't filter fallback moments (no wall-clock peaks) — open a channel session for chart-to-moment."
      : "Hover for bucket totals. Switch to 24h and click recent buckets to filter Pulse Moments below.";

  return (
    <section
      className="figma-global-activity"
      aria-label="Global emote activity"
    >
      <div className="figma-global-activity__headline">
        <h2 className="figma-block__title">Live activity</h2>
        <p>
          Viewer totals, chat velocity, and emote provider lines across {compact(hub.activity.channelCount)} tracked
          channels — last {windowLabel}.
          {updatedAgo ? (
            <>
              {" "}
              <HubFreshnessCaption updatedAgo={updatedAgo} className="figma-global-activity__freshness" />
            </>
          ) : null}
        </p>
        {peakPoint && peakPoint.viewers > 0 ? (
          <p className="figma-global-activity__peak">
            Peak: <strong>{compact(peakPoint.viewers)} viewers</strong>
            {peakChatPoint && peakChatPoint.chat > 0
              ? ` · ${compact(peakChatPoint.chat)} chat/min`
              : ""}
            {peakPoint.t ? ` · ${formatPeakTime(peakPoint.t)}` : ""}
          </p>
        ) : null}
      </div>
      {showSearch ? (
      <div
        className="figma-global-activity__search"
        role="search"
        aria-label="Channel search"
      >
        <HubSearch
          suggestions={suggestions}
          placeholder="Search live channels..."
          showKbd
        />
      </div>
      ) : null}
      <CollectorHealthNote hub={hub} />
      <p className="figma-global-activity__chart-note" role="note">
        {chartNote}
        {activityRefreshing ? (
          <span className="figma-global-activity__chart-refresh" role="status">
            {" "}
            Updating chart…
          </span>
        ) : null}
      </p>
      <div className="figma-global-activity__body">
        <div className="hubx figma-global-activity__chart figma-global-activity__hub-chart">
          <HubActivityChart
            points={hub.activity.points}
            windowMinutes={hub.activity.windowMinutes}
            channelCount={hub.activity.channelCount}
            expectedBuckets={activitySummary.expectedBuckets}
            missingBuckets={activitySummary.missingBuckets}
            coveragePct={activitySummary.coveragePct}
            loading={loading}
            rangeControl={rangeControl}
            selectedBucketT={selectedBucketT}
            onBucketSelect={
              chartBucketSelectEnabled ? onBucketSelect : undefined
            }
            emoteImages={emoteImages}
          />
        </div>
        <div className="figma-global-activity__emotes">
          <TopEmotesPanel
            emotes={topEmotes}
            windowLabel={`all providers - ${windowLabel}`}
            className="figma-global-activity__emotes-panel"
            updatedAgo={updatedAgo}
          />
        </div>
      </div>
    </section>
  );
}
