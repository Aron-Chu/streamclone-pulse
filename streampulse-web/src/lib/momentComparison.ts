import type { LiveWireMetricComparison, LiveWireMomentComparison } from './liveWire'

export type MomentReactionSignal = 'chat' | 'emotes'

/** Preserve the detector's stated signal; never infer a quality score from rates. */
export function momentReactionSignal(kind?: string): MomentReactionSignal | undefined {
  const value = kind?.trim().toLowerCase() ?? ''
  if (value.includes('emote') || value.includes('seventv') || value === '7tv') return 'emotes'
  if (value.includes('chat')) return 'chat'
  return undefined
}

/** One headline policy for discovery and review. Fallback always names its actual metric. */
export function momentComparisonSummary(comparison?: LiveWireMomentComparison, signal?: MomentReactionSignal): string | null {
  const candidates: Array<[string, LiveWireMetricComparison | undefined]> = signal === 'emotes'
    ? [['Emotes', comparison?.emotes], ['Chat', comparison?.chat]]
    : [['Chat', comparison?.chat], ['Emotes', comparison?.emotes]]
  for (const [label, metric] of candidates) {
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
