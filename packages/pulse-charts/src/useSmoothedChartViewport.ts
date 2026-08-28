import { useEffect, useRef, useState } from "react";
import type { ChartViewport } from "./chartViewport.ts";

const DEFAULT_VIEWPORT_MOTION_MS = 220;

function sameViewport(a: ChartViewport, b: ChartViewport): boolean {
  return a.startSeconds === b.startSeconds && a.endSeconds === b.endSeconds;
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

/**
 * Animates the rendered viewport while leaving the parent's target viewport
 * authoritative. This keeps wheel bursts and rail jumps readable without
 * changing the controlled/uncontrolled ownership contract.
 */
export function useSmoothedChartViewport(
  target: ChartViewport,
  enabled = true,
  durationMs = DEFAULT_VIEWPORT_MOTION_MS,
): ChartViewport {
  const [displayed, setDisplayed] = useState(target);
  const displayedRef = useRef(displayed);

  useEffect(() => {
    const from = displayedRef.current;
    if (!enabled || sameViewport(from, target)) {
      displayedRef.current = target;
      setDisplayed(target);
      return;
    }

    let frame = 0;
    const startedAt = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / Math.max(1, durationMs));
      const eased = easeOutCubic(progress);
      const next = {
        startSeconds: from.startSeconds + (target.startSeconds - from.startSeconds) * eased,
        endSeconds: from.endSeconds + (target.endSeconds - from.endSeconds) * eased,
      };
      displayedRef.current = next;
      setDisplayed(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [durationMs, enabled, target.endSeconds, target.startSeconds]);

  return displayed;
}
