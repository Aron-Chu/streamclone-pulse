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
 * authoritative. Discrete jumps can animate; direct gestures disable motion without
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
    const canAnimate = typeof requestAnimationFrame === "function";
    if (!enabled || !canAnimate || sameViewport(from, target)) {
      displayedRef.current = target;
      setDisplayed(target);
      return;
    }

    const settle = () => {
      displayedRef.current = target;
      setDisplayed(target);
    };

    let frame = 0;
    const startedAt = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / Math.max(1, durationMs));
      if (progress >= 1) {
        settle();
        return;
      }
      const eased = easeOutCubic(progress);
      displayedRef.current = {
        startSeconds: from.startSeconds + (target.startSeconds - from.startSeconds) * eased,
        endSeconds: from.endSeconds + (target.endSeconds - from.endSeconds) * eased,
      };
      setDisplayed(displayedRef.current);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);

    // The target viewport is what the user asked for; the tween is decoration.
    // requestAnimationFrame stops firing whenever the page is not being painted
    // (background tab, occluded window, power saving), which stranded the plot
    // on the old range while the readout and rail already showed the new one —
    // the control looked broken. This guarantees we land on the target.
    const safety = setTimeout(settle, Math.max(1, durationMs) + 120);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(safety);
    };
  }, [durationMs, enabled, target.endSeconds, target.startSeconds]);

  return enabled ? displayed : target;
}
