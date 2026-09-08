/** Measurement timestamps are modern UTC instants, not Go zero times or scheduled events. */
export function measurementTimeMs(value: unknown, nowMs = Date.now()): number | null {
  const timestamp = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() ? Date.parse(value) : Number.NaN
  return Number.isFinite(timestamp) && timestamp >= Date.UTC(2000, 0, 1)
    && timestamp <= nowMs + 5 * 60_000 ? timestamp : null
}

export function measurementTimeIso(value: unknown, nowMs = Date.now()): string | undefined {
  const timestamp = measurementTimeMs(value, nowMs)
  return timestamp == null ? undefined : new Date(timestamp).toISOString()
}
