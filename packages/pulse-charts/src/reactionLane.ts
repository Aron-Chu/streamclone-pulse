import {
  reactionMomentReason,
  reactionMomentSeekOffset,
  reactionMomentScore,
  reactionMomentWindow,
  sanitizeReactionMoment,
  type ReactionMoment,
} from '@streampulse/pulse-core'

export interface ReactionLaneGeometryOptions {
  moments: readonly ReactionMoment[]
  plotLeft: number
  plotWidth: number
  bandTop: number
  bandBottom: number
  xForOffset: (offsetSeconds: number) => number | null
  minHitWidth?: number
  maxMoments?: number
}

export interface ReactionLaneGeometry {
  key: string
  moment: ReactionMoment
  /** The authored interval used for the visible bar. Keep this truthful for
   * second-level refinements instead of inflating every bar to a hit target. */
  x: number
  y: number
  width: number
  height: number
  centerX: number
  /** Forgiving pointer target, independent from the visible interval width. */
  hitX: number
  hitWidth: number
  score: number
  confidence: number
  reason: string
  color: string
  /** Coarse candidate offset retained for backwards-compatible readouts. */
  offsetSeconds: number
  seekOffsetSeconds: number
  startSeconds: number
  endSeconds: number
  durationSeconds: number
  precisionSeconds?: number
  refined: boolean
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

const REACTION_MARKER_HEIGHT = 7

function reactionLaneColor(reason: string): string {
  const normalized = reason.toLowerCase()
  if (normalized.includes('chat')) return '#a78bfa'
  if (normalized.includes('emote')) return '#34d399'
  if (normalized.includes('viewer')) return '#22d3ee'
  return '#f59e0b'
}

/**
 * Build the same reaction geometry for the portal and extension. Projection
 * remains host-owned (timestamp scale vs index scale); interval, score,
 * confidence, precision, sanitization, ordering, and hit semantics are shared.
 */
export function buildReactionLaneGeometry(options: ReactionLaneGeometryOptions): ReactionLaneGeometry[] {
  const {
    moments,
    plotLeft,
    plotWidth,
    bandTop,
    bandBottom,
    xForOffset,
    minHitWidth = 6,
    maxMoments = 40,
  } = options
  if (plotWidth <= 0 || bandBottom <= bandTop || moments.length === 0) return []
  const mapped: ReactionLaneGeometry[] = []
  const unique = new Set<string>()
  for (let index = 0; index < moments.length && mapped.length < maxMoments; index += 1) {
    const moment = sanitizeReactionMoment(moments[index]!)
    const score = reactionMomentScore(moment)
    if (score <= 0) continue
    const window = reactionMomentWindow(moment)
    const startX = xForOffset(window.startSeconds)
    const endX = xForOffset(window.endSeconds)
    if (startX == null || endX == null) continue
    const rawLeft = Math.min(startX, endX)
    const rawRight = Math.max(startX, endX)
    // A projector may clamp out-of-domain offsets to an edge. Reject a
    // wholly off-screen window before clamping so a sidebar click cannot
    // manufacture a marker at the first/last visible bucket.
    if (rawRight < plotLeft || rawLeft > plotLeft + plotWidth) continue
    const left = clamp(rawLeft, plotLeft, plotLeft + plotWidth)
    const right = clamp(rawRight, plotLeft, plotLeft + plotWidth)
    const keyBase = `${moment.offsetSeconds}:${window.startSeconds}:${window.endSeconds}`
    if (unique.has(keyBase)) continue
    unique.add(keyBase)
    // Refined moments are often one or two seconds wide. The old geometry
    // used the same minimum width for rendering and hit testing, which made
    // every amber reaction marker look identical on a long stream. Preserve
    // the authored interval visually and keep a separate forgiving target so
    // exact moments remain easy to click.
    const visualWidth = Math.max(0.75, right - left)
    const centerX = (left + right) / 2
    const hitWidth = Math.max(minHitWidth, visualWidth)
    const confidence = clamp(
      moment.refinementConfidence ?? moment.confidence ?? (moment.precisionSeconds === 1 ? 0.92 : 0.58),
      0,
      1,
    )
    const reason = reactionMomentReason(moment)
    const y = bandBottom - REACTION_MARKER_HEIGHT
    mapped.push({
      key: `reaction-${index}-${keyBase}`,
      moment,
      x: left,
      y,
      width: visualWidth,
      height: Math.max(1, bandBottom - y),
      centerX,
      hitX: centerX - hitWidth / 2,
      hitWidth,
      score,
      confidence,
      reason,
      color: reactionLaneColor(reason),
      offsetSeconds: moment.offsetSeconds,
      seekOffsetSeconds: reactionMomentSeekOffset(moment),
      startSeconds: window.startSeconds,
      endSeconds: window.endSeconds,
      durationSeconds: window.durationSeconds,
      precisionSeconds: moment.precisionSeconds,
      refined: moment.refinementStatus === 'refined',
    })
  }
  return mapped.sort((a, b) => a.startSeconds - b.startSeconds || b.score - a.score)
}

/** Hit-test a rendered reaction using a forgiving interaction width. */
export function findReactionMomentAtPlotX(
  geometry: readonly ReactionLaneGeometry[],
  plotX: number,
  maxDistance = 8,
): ReactionLaneGeometry | null {
  if (!Number.isFinite(plotX)) return null
  let best: ReactionLaneGeometry | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  let bestCenterDistance = Number.POSITIVE_INFINITY
  for (const item of geometry) {
    const left = item.hitX
    const right = item.hitX + item.hitWidth
    const distance = plotX < left ? left - plotX : plotX > right ? plotX - right : 0
    const centerDistance = Math.abs(plotX - item.centerX)
    if (
      distance < bestDistance
      || (distance === bestDistance && centerDistance < bestCenterDistance)
    ) {
      best = item
      bestDistance = distance
      bestCenterDistance = centerDistance
    }
  }
  return bestDistance <= Math.max(0, maxDistance) ? best : null
}
