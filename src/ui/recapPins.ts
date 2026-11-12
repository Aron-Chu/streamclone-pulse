/** A replay chart's marker as a pin: `n` is 1–3 for a numbered pin, 0 for a small dot. */
export interface RecapPinHead {
  n: number
  /** Where the pin's head sits; a fanned-out head keeps a leader line to its own x. */
  x: number
}

/** Numbered heads closer than this fan out sideways. */
export const RECAP_PIN_GAP = 16

/**
 * On a replay the chart pins its moments: the ones at `numbered` (the top
 * three, best first) get pins 1–3, the rest small dots. Numbered heads that
 * sit closer than `gap` fan out sideways in time order, then back off the
 * right edge, staying within `min`–`max`. Dots stay on their minute.
 */
export function recapPinHeads(
  markers: readonly { peak: { offsetSeconds: number }; x: number }[],
  numbered: readonly number[],
  min: number,
  max: number,
  gap = RECAP_PIN_GAP,
): RecapPinHead[] {
  const heads = markers.map(marker => ({ n: numbered.indexOf(marker.peak.offsetSeconds) + 1, x: marker.x }))
  const fan = heads.filter(head => head.n).sort((a, b) => a.x - b.x)
  let edge = min - gap
  for (const head of fan) edge = head.x = Math.max(head.x, edge + gap)
  edge = max + gap
  for (const head of fan.reverse()) edge = head.x = Math.min(head.x, edge - gap)
  return heads
}
