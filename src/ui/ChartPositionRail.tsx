import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { formatHeatOffset } from "@streampulse/pulse-core";
import type { ExtensionRollup } from "../shared/messages.ts";
import { chartViewerValue, minuteEmoteTotal } from "./chartRollupUtils.ts";
import {
  FOLLOW_LIVE_EPSILON_SECONDS,
  isFollowingLive,
  jumpToOffset,
  MIN_VIEWPORT_SECONDS,
  panViewport,
  railGeometry,
  resolveViewport,
  viewportDurationSeconds,
  type ChartViewport,
} from "./chartViewport.ts";
import type { ChartViewportChangeCause } from './chartNavigation.ts'
import { useReducedMotion } from './motion/useReducedMotion.ts'
import { theme } from "./theme.ts";

export interface ChartPositionRailProps {
  viewport: ChartViewport;
  durationSeconds: number;
  /** Overview series (full timeline) — mirrors portal `rollups` vs detail plot. */
  minuteRollups?: ExtensionRollup[];
  onViewportChange: (
    viewport: ChartViewport,
    cause?: ChartViewportChangeCause,
  ) => void;
  onJumpToOffset?: (offsetSeconds: number) => void;
  disabled?: boolean;
  /** Activity silhouette height in px. Default 14 for a usable sidebar target. */
  height?: number;
  ariaLabel?: string;
  /**
   * First covered minute offset (seconds). Region before this is uncovered
   * (480-min tail trim / late attach) and must not look navigable.
   */
  coverageStartSeconds?: number;
  plotInsetLeft?: number;
  plotInsetRight?: number;
  /** Animate programmatic selection/restore changes, never direct manipulation. */
  animateChanges?: boolean;
}

/** Always show overview brush once the stream is this long. */
export const LONG_STREAM_OVERVIEW_SECONDS = 90 * 60;
const DEFAULT_FOCUS_SECONDS = 60 * 60;
const MIN_PAN_SECONDS = 1 * 60;
const SHIFT_PAN_SECONDS = 10 * 60;
const RESIZE_HANDLE_PX = 8;
const SILHOUETTE_MAX_POINTS = 160;

/**
 * Portal parity (`/analytics/:login/:date` position rail). Measured from the
 * running analytics console so the extension zoom bar reads as the same
 * control: a compact white-tint track with an emerald window thumb.
 */
const RAIL_TRACK_BG = "rgba(255, 255, 255, 0.035)";
const RAIL_TRACK_BORDER = "rgba(255, 255, 255, 0.1)";
const RAIL_WINDOW_FILL = "rgba(52, 211, 153, 0.82)";
const RAIL_WINDOW_BORDER = "rgba(110, 231, 183, 0.98)";
const RAIL_WINDOW_FILL_PANNED = "rgba(52, 211, 153, 0.62)";
export const RAIL_HEIGHT_PX = 14;
export const RAIL_PROGRAMMATIC_TRANSITION =
  'transform 180ms cubic-bezier(0.22, 1, 0.36, 1), width 180ms cubic-bezier(0.22, 1, 0.36, 1)';

export function railThumbTransition(args: {
  animateChanges: boolean;
  dragging: boolean;
  reducedMotion: boolean;
}): string {
  return args.animateChanges && !args.dragging && !args.reducedMotion
    ? RAIL_PROGRAMMATIC_TRANSITION
    : 'none';
}

/** Callers use this to drop the whole rail row instead of leaving orphaned buttons. */
export function shouldShowChartRail(
  viewport: ChartViewport,
  durationSeconds: number,
): boolean {
  const viewportDuration = viewportDurationSeconds(viewport);
  if (durationSeconds <= 0 || viewportDuration <= 0) return false;
  const zoomedIn =
    viewportDuration < durationSeconds - FOLLOW_LIVE_EPSILON_SECONDS;
  return zoomedIn || durationSeconds >= LONG_STREAM_OVERVIEW_SECONDS;
}

function buildSilhouettePath(
  values: number[],
  width: number,
  height: number,
): string {
  if (values.length === 0 || width <= 0 || height <= 0) return "";
  const max = Math.max(...values, 1);
  const stepX = width / Math.max(1, values.length - 1);
  let d = "";
  values.forEach((value, index) => {
    const x = index * stepX;
    const y = height - (value / max) * (height - 1) - 0.5;
    d +=
      index === 0
        ? `M ${x.toFixed(2)} ${y.toFixed(2)}`
        : ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  return d;
}

/** Magnitude series for overview peaks — not binary presence. */
export function magnitudeActivitySeries(
  minuteRollups: ExtensionRollup[] | undefined,
): number[] {
  if (!minuteRollups || minuteRollups.length === 0) return [];
  return minuteRollups.map((rollup) => {
    const chat = Math.max(0, rollup.chatCount ?? 0);
    const emotes = minuteEmoteTotal(rollup);
    const viewers = chartViewerValue(rollup) ?? 0;
    return chat * 1000 + emotes * 100 + viewers;
  });
}

function downsampleMagnitude(values: number[], maxPoints: number): number[] {
  if (values.length <= maxPoints) return values;
  const bucketSize = values.length / maxPoints;
  const out: number[] = [];
  for (let bucket = 0; bucket < maxPoints; bucket += 1) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.min(values.length, Math.floor((bucket + 1) * bucketSize));
    let peak = 0;
    for (let i = start; i < end; i += 1) {
      peak = Math.max(peak, values[i] ?? 0);
    }
    out.push(peak);
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function resizeViewportEdge(
  viewport: ChartViewport,
  edge: "start" | "end",
  deltaSeconds: number,
  durationSeconds: number,
): ChartViewport {
  if (durationSeconds <= 0) return { startSeconds: 0, endSeconds: 0 };
  if (edge === "start") {
    const maxStart = Math.max(0, viewport.endSeconds - MIN_VIEWPORT_SECONDS);
    const startSeconds = clamp(
      viewport.startSeconds + deltaSeconds,
      0,
      maxStart,
    );
    return { startSeconds, endSeconds: viewport.endSeconds };
  }
  const minEnd = viewport.startSeconds + MIN_VIEWPORT_SECONDS;
  const endSeconds = clamp(
    viewport.endSeconds + deltaSeconds,
    minEnd,
    durationSeconds,
  );
  return { startSeconds: viewport.startSeconds, endSeconds };
}

type DragMode = "pan" | "resize-start" | "resize-end";

export const ChartPositionRail = memo(function ChartPositionRail({
  viewport,
  durationSeconds,
  minuteRollups,
  onViewportChange,
  onJumpToOffset,
  disabled = false,
  height = RAIL_HEIGHT_PX,
  ariaLabel = "Chart position",
  coverageStartSeconds = 0,
  plotInsetLeft = 0,
  plotInsetRight = 0,
  animateChanges = false,
}: ChartPositionRailProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [railWidth, setRailWidth] = useState(320);
  const [dragging, setDragging] = useState(false);
  const reducedMotion = useReducedMotion();
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startViewport: ChartViewport;
    dragSeconds: number;
    mode: DragMode;
  } | null>(null);

  const viewportDuration = viewportDurationSeconds(viewport);
  const showRail = shouldShowChartRail(viewport, durationSeconds);

  useEffect(() => {
    const node = trackRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const apply = () => {
      const next = Math.round(node.clientWidth);
      if (next > 0) setRailWidth(next);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, [showRail]);

  const silhouetteValues = useMemo(() => {
    const magnitude = magnitudeActivitySeries(minuteRollups);
    return downsampleMagnitude(magnitude, SILHOUETTE_MAX_POINTS);
  }, [minuteRollups]);

  const silhouette = useMemo(() => {
    if (silhouetteValues.length === 0) return "";
    return buildSilhouettePath(
      silhouetteValues,
      Math.max(1, railWidth),
      height,
    );
  }, [silhouetteValues, railWidth, height]);

  const geo = useMemo(
    () => railGeometry(viewport, durationSeconds, railWidth),
    [viewport, durationSeconds, railWidth],
  );

  const uncoveredWidthPx = useMemo(() => {
    if (coverageStartSeconds <= 0 || durationSeconds <= 0) return 0;
    return Math.min(
      railWidth,
      (coverageStartSeconds / durationSeconds) * railWidth,
    );
  }, [coverageStartSeconds, durationSeconds, railWidth]);

  const following = isFollowingLive(viewport, durationSeconds);

  const beginDrag = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      mode: DragMode,
      nextViewport: ChartViewport,
    ) => {
      dragStateRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startViewport: nextViewport,
        dragSeconds: 0,
        mode,
      };
      setDragging(true);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // setPointerCapture can fail if pointer is already released; safe to ignore.
      }
    },
    [],
  );

  const onTrackPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled || !showRail) return;
      const track = trackRef.current;
      if (!track) return;
      event.preventDefault();
      const rect = track.getBoundingClientRect();
      const offsetX = Math.min(
        rect.width,
        Math.max(0, event.clientX - rect.left),
      );
      const offsetSeconds =
        (offsetX / Math.max(1, rect.width)) * durationSeconds;
      if (coverageStartSeconds > 0 && offsetSeconds < coverageStartSeconds) {
        // Guardrail: do not jump into uncovered / trimmed prefix.
        return;
      }
      let base = viewport;
      const fullView =
        viewportDuration >= durationSeconds - FOLLOW_LIVE_EPSILON_SECONDS;
      if (fullView && durationSeconds > DEFAULT_FOCUS_SECONDS) {
        base = resolveViewport({
          durationSeconds,
          zoomSeconds: DEFAULT_FOCUS_SECONDS,
          anchorSeconds: offsetSeconds,
        });
      }
      const next = jumpToOffset(
        base,
        offsetSeconds,
        durationSeconds,
        viewportDurationSeconds(base),
      );
      onViewportChange(next, "user-pan");
      onJumpToOffset?.(offsetSeconds);
      beginDrag(event, "pan", next);
    },
    [
      disabled,
      showRail,
      viewport,
      durationSeconds,
      viewportDuration,
      coverageStartSeconds,
      onViewportChange,
      onJumpToOffset,
      beginDrag,
    ],
  );

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, edge: "start" | "end") => {
      if (disabled || !showRail) return;
      event.preventDefault();
      event.stopPropagation();
      beginDrag(
        event,
        edge === "start" ? "resize-start" : "resize-end",
        viewport,
      );
    },
    [disabled, showRail, beginDrag, viewport],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      const deltaPx = event.clientX - state.startClientX;
      const secondsPerPx = durationSeconds / rect.width;
      const deltaSeconds = deltaPx * secondsPerPx;
      state.dragSeconds += Math.abs(deltaSeconds);
      if (state.mode === "pan") {
        onViewportChange(
          panViewport(state.startViewport, deltaSeconds, durationSeconds),
          "user-pan",
        );
        return;
      }
      const edge = state.mode === "resize-start" ? "start" : "end";
      let next = resizeViewportEdge(
        state.startViewport,
        edge,
        deltaSeconds,
        durationSeconds,
      );
      if (
        coverageStartSeconds > 0 &&
        next.startSeconds < coverageStartSeconds
      ) {
        next = {
          ...next,
          startSeconds: Math.min(
            coverageStartSeconds,
            next.endSeconds - MIN_VIEWPORT_SECONDS,
          ),
        };
      }
      onViewportChange(next, "user-pan");
    },
    [durationSeconds, onViewportChange, coverageStartSeconds],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      if (
        state.mode === "pan" &&
        state.dragSeconds < FOLLOW_LIVE_EPSILON_SECONDS
      ) {
        onViewportChange(state.startViewport, "user-pan");
      }
      dragStateRef.current = null;
      setDragging(false);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // pointer may already be released; safe to ignore.
      }
    },
    [onViewportChange],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          if (event.altKey) {
            onViewportChange(
              resizeViewportEdge(
                viewport,
                "start",
                event.shiftKey ? -SHIFT_PAN_SECONDS : -MIN_PAN_SECONDS,
                durationSeconds,
              ),
              "user-pan",
            );
          } else {
            onViewportChange(
              panViewport(
                viewport,
                event.shiftKey ? -SHIFT_PAN_SECONDS : -MIN_PAN_SECONDS,
                durationSeconds,
              ),
              "user-pan",
            );
          }
          break;
        case "ArrowRight":
          event.preventDefault();
          if (event.altKey) {
            onViewportChange(
              resizeViewportEdge(
                viewport,
                "end",
                event.shiftKey ? SHIFT_PAN_SECONDS : MIN_PAN_SECONDS,
                durationSeconds,
              ),
              "user-pan",
            );
          } else {
            onViewportChange(
              panViewport(
                viewport,
                event.shiftKey ? SHIFT_PAN_SECONDS : MIN_PAN_SECONDS,
                durationSeconds,
              ),
              "user-pan",
            );
          }
          break;
        case "[":
          event.preventDefault();
          onViewportChange(
            resizeViewportEdge(
              viewport,
              "start",
              event.shiftKey ? SHIFT_PAN_SECONDS : MIN_PAN_SECONDS,
              durationSeconds,
            ),
            "user-pan",
          );
          break;
        case "]":
          event.preventDefault();
          onViewportChange(
            resizeViewportEdge(
              viewport,
              "end",
              event.shiftKey ? -SHIFT_PAN_SECONDS : -MIN_PAN_SECONDS,
              durationSeconds,
            ),
            "user-pan",
          );
          break;
        case "Home":
          event.preventDefault();
          onViewportChange(
            jumpToOffset(
              viewport,
              Math.max(0, coverageStartSeconds),
              durationSeconds,
              viewportDuration,
            ),
            "user-pan",
          );
          onJumpToOffset?.(Math.max(0, coverageStartSeconds));
          break;
        case "End":
          event.preventDefault();
          onViewportChange(
            jumpToOffset(
              viewport,
              durationSeconds,
              durationSeconds,
              viewportDuration,
            ),
            "user-pan",
          );
          onJumpToOffset?.(durationSeconds);
          break;
        case "Escape":
          event.preventDefault();
          onViewportChange(
            { startSeconds: 0, endSeconds: durationSeconds },
            "user-zoom",
          );
          break;
        default:
          break;
      }
    },
    [
      disabled,
      viewport,
      durationSeconds,
      viewportDuration,
      onViewportChange,
      onJumpToOffset,
      coverageStartSeconds,
    ],
  );

  // Keep track mounted for ResizeObserver even when hidden briefly during layout.
  if (!showRail) {
    return <div ref={trackRef} style={{ display: "none" }} aria-hidden />;
  }

  const startLabel = formatHeatOffset(viewport.startSeconds);
  const endLabel = formatHeatOffset(viewport.endSeconds);
  const totalLabel = formatHeatOffset(durationSeconds);
  const summary = `Viewing minutes ${startLabel}–${endLabel} of ${totalLabel}`;

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.round(durationSeconds)}
      aria-valuenow={Math.round(viewport.startSeconds)}
      aria-valuetext={`${summary}. Alt+arrows or [ ] resize the window.`}
      style={{
        ...styles.track,
        height,
        marginLeft: plotInsetLeft,
        marginRight: plotInsetRight,
        cursor: disabled ? "default" : "pointer",
        touchAction: "none",
      }}
      data-chart-rail
      onPointerDown={onTrackPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={handleKeyDown}
    >
      <svg
        viewBox={`0 0 ${Math.max(1, railWidth)} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        style={styles.silhouette}
        aria-hidden
      >
        {uncoveredWidthPx > 0 ? (
          <rect
            x={0}
            y={0}
            width={uncoveredWidthPx}
            height={height}
            fill={theme.borderSubtle}
            opacity={0.55}
          />
        ) : null}
        {silhouette ? (
          <path
            d={silhouette}
            fill="none"
            stroke="rgba(255, 255, 255, 0.4)"
            strokeWidth={1.25}
          />
        ) : null}
      </svg>
      <div
        style={{
          ...styles.thumb,
          width: `${(geo.thumbWidth / railWidth) * 100}%`,
          transform: `translateX(${geo.thumbWidth > 0 ? (geo.thumbX / geo.thumbWidth) * 100 : 0}%)`,
          background: following ? RAIL_WINDOW_FILL : RAIL_WINDOW_FILL_PANNED,
          transition: railThumbTransition({ animateChanges, dragging, reducedMotion }),
        }}
        data-chart-rail-thumb
        aria-hidden
      >
        <div
          style={{ ...styles.resizeHandle, left: 0 }}
          data-chart-rail-resize="start"
          onPointerDown={(event) => onResizePointerDown(event, "start")}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        <div
          style={{ ...styles.resizeHandle, right: 0 }}
          data-chart-rail-resize="end"
          onPointerDown={(event) => onResizePointerDown(event, "end")}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    </div>
  );
});

const styles: Record<string, CSSProperties> = {
  track: {
    background: RAIL_TRACK_BG,
    border: `1px solid ${RAIL_TRACK_BORDER}`,
    borderRadius: 7,
    boxSizing: "border-box",
    flex: "1 1 0",
    minWidth: 96,
    overflow: "hidden",
    position: "relative",
    userSelect: "none",
  },
  silhouette: {
    display: "block",
    left: 0,
    position: "absolute",
    top: 0,
  },
  thumb: {
    border: `1px solid ${RAIL_WINDOW_BORDER}`,
    borderRadius: 6,
    bottom: 1,
    boxSizing: "border-box",
    left: 0,
    position: "absolute",
    top: 1,
    willChange: "transform",
  },
  resizeHandle: {
    background: "rgba(236, 253, 245, 0.2)",
    bottom: 0,
    cursor: "ew-resize",
    position: "absolute",
    top: 0,
    width: RESIZE_HANDLE_PX,
    zIndex: 1,
  },
};
