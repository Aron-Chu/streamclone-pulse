/**
 * Re-export of the shared rAF scalar smoother.
 *
 * The portal had its own copy here with no consumers — every smoothed value the
 * portal renders comes from the chart package. One implementation means one
 * rAF-settling behaviour to reason about.
 */
export {
  useSmoothedScalar,
  lerpScalar,
  type ScalarMotionOptions,
} from '@streampulse/pulse-charts'
