import { momentRowKey, type FigmaMomentRow } from './figmaSessionAnalytics'

/**
 * Resolve which Pulse Moments row the inspector should show.
 * Prefers an explicit selection when still present; otherwise the top filtered row.
 */
export function resolveSelectedPulseMoment(
  moments: FigmaMomentRow[],
  selectedKey: string | null | undefined,
): FigmaMomentRow | null {
  if (selectedKey) {
    const hit = moments.find((moment) => momentRowKey(moment) === selectedKey)
    if (hit) return hit
  }
  return moments[0] ?? null
}

/** True when the key is still among the given moments. */
export function momentKeyInList(
  moments: FigmaMomentRow[],
  selectedKey: string | null | undefined,
): boolean {
  if (!selectedKey) return false
  return moments.some((moment) => momentRowKey(moment) === selectedKey)
}
