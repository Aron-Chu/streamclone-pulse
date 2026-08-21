import type { SignalWatermark } from './signalTypes'

export function finiteCoveragePct(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : undefined
}

export function parseTimestamp(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function watermarkState(
  watermark: SignalWatermark | undefined,
  observedAt: string | null,
): 'current' | 'partial' | 'stale' | 'unknown' {
  if (!watermark) return 'current'
  const observedAtMs = parseTimestamp(observedAt)
  const observedThroughMs = parseTimestamp(watermark.observedThrough)
  if (observedAtMs !== null && observedThroughMs !== null && observedAtMs > observedThroughMs) {
    return 'unknown'
  }
  return watermark.state
}
