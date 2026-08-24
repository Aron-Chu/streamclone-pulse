import type { HubActivityPoint } from './publicHub'
import type { HubTimeDomain } from './hubTimeScale'

export interface BarDims {
  height: number
  paddingBottom: number
}

export interface RhythmLines {
  avg: number | null
  loud: number | null
}

/** X percent (0..100) of the bucket start whose timestamp is `t`. */
export function barXPercent(t: number, domain: HubTimeDomain): number | null {
  if (t < domain.start || t >= domain.endExclusive) return null
  const span = domain.endExclusive - domain.start
  if (!(span > 0)) return null
  return ((t - domain.start) / span) * 100
}

/** Width percent of a single bar (one bucket). */
export function barWidthPercent(domain: HubTimeDomain): number {
  const span = domain.endExclusive - domain.start
  if (!(span > 0)) return 0
  return (domain.bucketDurationMs / span) * 100
}

/** Avg (median viewers) and loud (p90 viewers) given the visible chart points. */
export function rhythmLines(
  points: HubActivityPoint[],
  opts: { dims: BarDims; excludeTrailingBucket?: boolean },
): RhythmLines | null {
  if (points.length === 0) return null
  const pts = opts.excludeTrailingBucket ? points.slice(0, -1) : points
  if (pts.length === 0) return null
  const viewers = pts.map((p) => p.viewers).sort((a, b) => a - b)
  const max = Math.max(...viewers, 1)
  const median = viewers[Math.floor(viewers.length / 2)]
  const p90 = viewers[Math.floor(viewers.length * 0.9)]
  const usable = Math.max(0, opts.dims.height - opts.dims.paddingBottom)
  // When dims.height is 0 we return raw ratios (0..1) so the subcomponent can
  // map them into its own coordinate space. The subcomponents assume height>=0.
  const scale = opts.dims.height > 0 ? usable / max : 1 / max
  return {
    avg: median * scale,
    loud: viewers.length > 1 ? p90 * scale : null,
  }
}

/** X percent of the trailing in-progress bucket. Stays at 100 if a domain exists. */
export function trailingBucketXPercent(domain: HubTimeDomain | null): number | null {
  if (!domain) return null
  return 100
}

export type StackSegmentColor = 'viewers' | 'chat' | 'emotes'

export interface StackSegment {
  color: StackSegmentColor
  /** Height in pixels (negative offset from baseline). */
  height: number
}

/** Stack segments for a single bar. Skips zero-valued segments. */
export function barStackSegments(
  point: HubActivityPoint,
  dims: BarDims,
  maxes: { viewers: number; chat: number; emotes: number },
): StackSegment[] {
  const usable = Math.max(0, dims.height - dims.paddingBottom)
  const segments: StackSegment[] = []
  if (point.viewers > 0 && maxes.viewers > 0) {
    segments.push({ color: 'viewers', height: (point.viewers / maxes.viewers) * usable })
  }
  if (point.chat > 0 && maxes.chat > 0) {
    segments.push({ color: 'chat', height: (point.chat / maxes.chat) * usable })
  }
  const emotes = Math.max(point.emotes ?? 0, point.seventv ?? 0, point.twitch ?? 0, point.bttv ?? 0, point.ffz ?? 0)
  if (emotes > 0 && maxes.emotes > 0) {
    segments.push({ color: 'emotes', height: (emotes / maxes.emotes) * usable })
  }
  return segments
}
