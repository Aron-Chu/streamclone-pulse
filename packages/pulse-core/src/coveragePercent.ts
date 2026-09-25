/** A rounded label must not claim complete coverage for an incomplete value. */
export function formatCoveragePercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0 || value > 100) return 'Unknown'
  return `${value === 100 ? 100 : Math.floor(value * 10) / 10}%`
}
