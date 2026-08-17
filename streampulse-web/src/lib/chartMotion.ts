// src/lib/chartMotion.ts

export const CHART_MOTION = {
  trailingBucket: {
    durationMs: 700,
    easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  },
  spikeGlowEnter: {
    durationMs: 320,
    easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  },
  spikeGlowPulse: {
    durationMs: 1200,
    easing: 'ease-in-out',
  },
  spikeGlowPulseMinOpacity: 0.92,
  annotationLabelFadeIn: {
    durationMs: 200,
    easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  },
} as const

export type ChartMotionToken = keyof typeof CHART_MOTION
