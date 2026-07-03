import type { PublicHub } from "../../../lib/publicHub";
import type { ActivitySummary } from "../../../lib/hubActivitySummary";
import { formatActivityWindowLabel } from "../../../lib/hubActivitySummary";
import { compact } from "./hubFormat";
import { FigmaLiveChannelRail } from "./FigmaLiveChannelRail";

const RAIL_COLORS = ["#1e3a5f", "#1a3d2b", "#2d1b4e", "#3d2a1b", "#1b3d3d"];

export interface FigmaMakeHeroProps {
  hub: PublicHub;
  activitySummary: ActivitySummary;
  loading?: boolean;
}

export function FigmaMakeHero({
  hub,
  activitySummary,
  loading,
}: FigmaMakeHeroProps) {
  const windowLabel = formatActivityWindowLabel(hub.activity.windowMinutes);

  const leftStats = [
    {
      label: "Live in hub",
      value: compact(hub.liveChannels.length),
      color: "var(--fma-accent-text)",
    },
    ...(hub.corpusPipeline.roster.live > hub.liveChannels.length
      ? [
          {
            label: "Top-N roster live",
            value: compact(hub.corpusPipeline.roster.live),
            color: "var(--fma-sub)",
          },
        ]
      : []),
    {
      label: "Global activity",
      value:
        activitySummary.coveragePct > 0
          ? `${Math.round(activitySummary.coveragePct)}%`
          : "-",
      color: "var(--fma-green)",
    },
    {
      label: "Emote economy",
      value:
        hub.emoteIntel.emotesPerMin > 0
          ? `${compact(hub.emoteIntel.emotesPerMin)}/m`
          : "-",
      color: "var(--fma-cyan)",
    },
    {
      label: "Tracked streams",
      value: compact(hub.corpus.streamsTracked),
      color: "var(--fma-sub)",
    },
  ];

  const corpusStrip = [
    {
      label: "Streams tracked",
      value: `${compact(hub.corpus.streamsTracked)}+`,
      color: "var(--fma-accent-text)",
    },
    {
      label: "Emotes indexed",
      value: `${compact(hub.corpus.emotesIndexed)}+`,
      color: "var(--fma-green)",
    },
    {
      label: "Chat processed",
      value: `${compact(hub.corpus.chatMessagesProcessed)}+`,
      color: "var(--fma-cyan)",
    },
    {
      label: "VODs analyzed",
      value: `${compact(hub.corpus.vodsAnalyzed)}+`,
      color: "var(--fma-amber)",
    },
  ];

  const liveChannels = hub.liveChannels.slice(0, 12);

  return (
    <section className="figma-hero" aria-labelledby="figma-hero-title">
      <div className="figma-hero__grid">
        <aside className="figma-hero__aside" aria-label="Command center">
          <div className="figma-hero__eyebrow">Command center</div>
          <p className="figma-hero__desc">
            Live rollup window: last {windowLabel} across tracked rooms.
          </p>
          {leftStats.map(({ label, value, color }) => (
            <div key={label} className="figma-hero__stat">
              <span>{label}</span>
              <b style={{ color }}>{loading ? "..." : value}</b>
            </div>
          ))}
        </aside>

        <div className="figma-hero__center">
          <h1 id="figma-hero-title" className="figma-hero__title">
            Stream intelligence
            <br />
            command center
          </h1>
          <p className="figma-hero__lede">
            Track live Twitch rooms, find spikes, and see hosted API + live IRC
            collector coverage across the tracked network.
          </p>

          <div className="figma-hero__live-head">
            <div className="figma-hero__live-label">
              <span className="dot" aria-hidden="true" />
              Live channels
            </div>
            <span className="figma-hero__live-meta">
              Showing {Math.min(liveChannels.length, 20)} of{" "}
              {compact(hub.liveChannels.length)} in hub
              {hub.corpusPipeline.roster.live > hub.liveChannels.length
                ? ` - ${compact(hub.corpusPipeline.roster.live)} live in configured ${compact(hub.corpusPipeline.topN)}-slot roster`
                : ""}
            </span>
          </div>

          <FigmaLiveChannelRail
            channels={liveChannels}
            colors={RAIL_COLORS}
            loading={loading}
          />
        </div>
      </div>

      <div className="figma-corpus-strip" aria-label="Network snapshot">
        <span className="figma-corpus-strip__lbl">Network snapshot</span>
        <div className="figma-corpus-strip__items">
          {corpusStrip.map(({ label, value, color }) => (
            <div key={label} className="figma-corpus-strip__item">
              <small>{label}</small>
              <strong style={{ color }}>{loading ? "..." : value}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
