/**
 * Re-export of the shared rAF scalar smoother.
 *
 * This module used to carry its own copy with different tuning (fixed 0.35
 * alpha, 0.05 snap epsilon) and no consumers — the chart smoothing the console
 * actually renders comes from @streampulse/pulse-charts. Keeping the path as a
 * re-export preserves the package export without a second implementation to
 * drift from.
 */
export {
  useSmoothedScalar,
  lerpScalar,
  type ScalarMotionOptions,
} from '@streampulse/pulse-charts'
