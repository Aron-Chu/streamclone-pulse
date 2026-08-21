/**
 * Deviation hairlines: how raw per-minute values are shown *around* a smoothed
 * core stroke instead of replacing it.
 *
 * The chart previously swapped geometry on inspection — a calm smoothed line at
 * rest, a raw jagged line on hover — and the two were fitted to different axis
 * ceilings, so hovering changed both the shape and the vertical scale at once.
 * That reads as the chart glitching rather than as detail being revealed.
 *
 * Instead, the core stroke stays smooth in every mode and the raw signal is
 * expressed as a min/max pair drawn behind it. A rise the average flattened
 * still shows up as the upper hairline pulling away; a drop still shows up as
 * the lower hairline pulling away.
 */

export interface DeviationBounds {
  lower: Array<number | null>
  upper: Array<number | null>
}

/**
 * Gaps are preserved rather than bridged: an index is only bounded when both the
 * raw sample and the smoothed value exist there.
 */
export function deviationBounds(
  raw: Array<number | null>,
  smoothed: Array<number | null>,
): DeviationBounds {
  const length = Math.min(raw.length, smoothed.length)
  const lower: Array<number | null> = new Array(length)
  const upper: Array<number | null> = new Array(length)
  for (let index = 0; index < length; index += 1) {
    const rawValue = raw[index]
    const smoothValue = smoothed[index]
    if (
      rawValue == null
      || smoothValue == null
      || !Number.isFinite(rawValue)
      || !Number.isFinite(smoothValue)
    ) {
      lower[index] = null
      upper[index] = null
      continue
    }
    lower[index] = Math.min(rawValue, smoothValue)
    upper[index] = Math.max(rawValue, smoothValue)
  }
  return { lower, upper }
}

/** True when the raw signal never departs from the smoothed core, so hairlines would only add ink. */
export function deviationBoundsAreFlat(bounds: DeviationBounds, epsilon = 1e-6): boolean {
  for (let index = 0; index < bounds.lower.length; index += 1) {
    const low = bounds.lower[index]
    const high = bounds.upper[index]
    if (low == null || high == null) continue
    if (high - low > epsilon) return false
  }
  return true
}
