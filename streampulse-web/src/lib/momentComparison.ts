import type { LiveWireMetricComparison, LiveWireMomentComparison } from './liveWire'

export type MomentReactionSignal = 'chat' | 'emotes'

/** Preserve the detector's stated signal; never infer a quality score from rates. */
export function momentReactionSignal(kind?: string): MomentReactionSignal | undefined {
  const value = kind?.trim().toLowerCase() ?? ''
  if (value.includes('emote') || value.includes('seventv') || ['7tv', 'twitch', 'bttv', 'ffz'].includes(value)) return 'emotes'
  if (value.includes('chat')) return 'chat'
  return undefined
}

/** Signal order for a headline: the detector's stated signal first, never the larger number. */
function comparisonCandidates(comparison?: LiveWireMomentComparison, signal?: MomentReactionSignal): Array<[string, LiveWireMetricComparison | undefined]> {
  return signal === 'emotes'
    ? [['Emotes', comparison?.emotes], ['Chat', comparison?.chat]]
    : [['Chat', comparison?.chat], ['Emotes', comparison?.emotes]]
}

const multiplierText = (multiplier: number) => `${multiplier.toFixed(multiplier >= 10 ? 0 : 1)}×`

export interface MomentComparisonBadge {
  /** The signal this ratio belongs to, so a row never leaves it to be guessed. */
  label: string
  /** Room-for-one-cell form, e.g. `14×`. Meaningless without `label`/`long`. */
  short: string
  /** The same claim in full, for the title/label a badge alone cannot carry. */
  long: string
  /** Under the earlier average — a dip, which must not be styled as a spike. */
  belowBaseline: boolean
}

/**
 * The compact form of the same headline, for a dense row.
 *
 * Only a supplied multiplier (or a stated new-activity baseline) compresses
 * honestly; percentage and absolute-delta fallbacks do not, so they return null
 * and the row shows its measured rates alone rather than an ambiguous chip.
 */
export function momentComparisonBadge(comparison?: LiveWireMomentComparison, signal?: MomentReactionSignal): MomentComparisonBadge | null {
  for (const [label, metric] of comparisonCandidates(comparison, signal)) {
    if (!metric || metric.currentPerMin == null || !Number.isFinite(metric.currentPerMin) || metric.currentPerMin < 0) continue
    if (metric.state === 'new_activity') return { label, short: 'new', long: `${label} is new from a zero earlier baseline`, belowBaseline: false }
    if (metric.state !== 'ready') continue
    if (metric.multiplier != null && Number.isFinite(metric.multiplier) && metric.multiplier >= 0) {
      return { label, short: multiplierText(metric.multiplier), long: `${label} ${multiplierText(metric.multiplier)} this stream's earlier average`,
        belowBaseline: metric.multiplier < 1 }
    }
    return null
  }
  return null
}

/** One headline policy for discovery and review. Fallback always names its actual metric. */
export function momentComparisonSummary(comparison?: LiveWireMomentComparison, signal?: MomentReactionSignal): string | null {
  for (const [label, metric] of comparisonCandidates(comparison, signal)) {
    if (!metric || metric.currentPerMin == null || !Number.isFinite(metric.currentPerMin) || metric.currentPerMin < 0) continue
    if (metric.state === 'new_activity') return `${label} is new from a zero earlier baseline`
    if (metric.state !== 'ready') continue
    if (metric.multiplier != null && Number.isFinite(metric.multiplier) && metric.multiplier >= 0) {
      return `${label} ${metric.multiplier.toFixed(metric.multiplier >= 10 ? 0 : 1)}× this stream's earlier average`
    }
    if (metric.changePct != null && Number.isFinite(metric.changePct)) {
      return `${label} ${metric.changePct > 0 ? '+' : ''}${Math.round(metric.changePct)}% versus earlier`
    }
    if (metric.absoluteDeltaPerMin != null && Number.isFinite(metric.absoluteDeltaPerMin)) {
      return `${label} ${metric.absoluteDeltaPerMin > 0 ? '+' : ''}${Math.round(metric.absoluteDeltaPerMin).toLocaleString('en-US')}/min versus earlier`
    }
  }
  return null
}
