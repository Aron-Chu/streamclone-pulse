/**
 * Elapsed-time ticks for the console chart's x axis.
 *
 * Ticks sit on a whole-minute "nice" step (1, 2, 5, 10, 15, 20, 30 minutes, 1h,
 * ...) counted from the first visible minute, never on evenly spread indices:
 * spreading 8 ticks over 14 minutes put two of them on neighbouring minutes and
 * their labels overlapped.
 */
const NICE_STEP_MINUTES = [1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 720, 1440, 2880]

/**
 * Indices into `offsetsSeconds` (ascending broadcast offsets of the visible
 * points) to label, at most `maxTicks` of them. A tick whose minute falls in a
 * gap in the data is skipped rather than moved onto a neighbouring point. Returns
 * null when an offset is unknown, so the caller can fall back.
 */
export function niceMinuteTickIndices(
  offsetsSeconds: ReadonlyArray<number | null | undefined>,
  maxTicks: number,
): number[] | null {
  if (offsetsSeconds.length === 0) return []
  if (offsetsSeconds.some(offset => offset == null || !Number.isFinite(offset))) return null
  const offsets = offsetsSeconds as number[]
  const first = offsets[0]!
  const last = offsets[offsets.length - 1]!
  if (offsets.length === 1 || last <= first || maxTicks <= 1) return [0]
  const spanMinutes = (last - first) / 60
  const stepMinutes = NICE_STEP_MINUTES.find(step => Math.floor(spanMinutes / step + 1e-9) + 1 <= maxTicks)
    ?? Math.ceil(spanMinutes / Math.max(1, maxTicks - 1))
  const stepSeconds = stepMinutes * 60
  // A tick snaps only to a point about one point-spacing away (downsampled
  // series), never across a gap in the data.
  const spacings = offsets.slice(1).map((offset, index) => offset - offsets[index]!).sort((a, b) => a - b)
  const typicalSpacing = spacings[Math.floor(spacings.length / 2)] ?? 60
  const snapSeconds = Math.min(stepSeconds / 2, typicalSpacing / 2 + 1)
  const indices: number[] = []
  let cursor = 0
  for (let target = first; target <= last + 1e-6; target += stepSeconds) {
    while (cursor < offsets.length - 1 && Math.abs(offsets[cursor + 1]! - target) <= Math.abs(offsets[cursor]! - target)) {
      cursor += 1
    }
    if (Math.abs(offsets[cursor]! - target) > snapSeconds) continue
    if (indices[indices.length - 1] !== cursor) indices.push(cursor)
  }
  return indices
}

/**
 * Drops any label whose box would come within `minGapPx` of the label kept
 * before it. `centerX` is where the label is drawn (text-anchor middle) and
 * `halfWidth` half its estimated width.
 */
export function keepUncrowdedAxisLabels<T extends { centerX: number; halfWidth: number }>(
  labels: readonly T[],
  minGapPx = 8,
): T[] {
  const kept: T[] = []
  for (const label of labels) {
    const previous = kept[kept.length - 1]
    if (previous && label.centerX - label.halfWidth - (previous.centerX + previous.halfWidth) < minGapPx) continue
    kept.push(label)
  }
  return kept
}
