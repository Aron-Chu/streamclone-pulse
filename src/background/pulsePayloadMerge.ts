import type { ExtensionGameSegment, ExtensionRollup, PulsePayload } from '../shared/messages.ts'

function gameSegmentKey(segment: ExtensionGameSegment): string {
  return `${segment.gameName.trim().toLowerCase()}:${segment.offsetSeconds}`
}

function mergeGamesBySegment(
  previous: ExtensionGameSegment[] | undefined,
  incoming: ExtensionGameSegment[] | undefined,
): ExtensionGameSegment[] | undefined {
  const prev = previous ?? []
  const next = incoming ?? []
  if (prev.length === 0) return next.length > 0 ? next : undefined
  if (next.length === 0) return prev
  if (next.length >= prev.length) return next

  const byKey = new Map<string, ExtensionGameSegment>()
  for (const segment of prev) byKey.set(gameSegmentKey(segment), segment)
  for (const segment of next) {
    const key = gameSegmentKey(segment)
    const existing = byKey.get(key)
    if (!existing || segment.durationSeconds >= existing.durationSeconds) {
      byKey.set(key, segment)
    }
  }
  return [...byKey.values()].sort((a, b) => a.offsetSeconds - b.offsetSeconds)
}

function mergeRollupsByOffset(previous: ExtensionRollup[], incoming: ExtensionRollup[]): ExtensionRollup[] {
  if (previous.length === 0) return incoming
  if (incoming.length >= previous.length) return incoming

  const byOffset = new Map<number, ExtensionRollup>()
  for (const rollup of previous) byOffset.set(rollup.offsetSeconds, rollup)
  for (const rollup of incoming) byOffset.set(rollup.offsetSeconds, rollup)
  return [...byOffset.values()].sort((a, b) => a.offsetSeconds - b.offsetSeconds)
}

/** Keep full-stream rollups when a lightweight recent poll returns a slimmer payload. */
export function mergePulsePayload(previous: PulsePayload | null | undefined, incoming: PulsePayload): PulsePayload {
  if (!previous) return incoming

  const prevFull = previous.fullRollups ?? []
  const nextFull = incoming.fullRollups ?? []
  const fullRollups =
    nextFull.length >= prevFull.length && nextFull.length > 0
      ? nextFull
      : prevFull.length > 0
        ? prevFull
        : nextFull

  const rollups = mergeRollupsByOffset(previous.rollups, incoming.rollups)

  const coverage =
    incoming.coverage ??
    previous.coverage ??
    undefined

  const mergedCoverage =
    coverage && previous.coverage?.hasFullStreamCoverage && !incoming.coverage?.hasFullStreamCoverage
      ? { ...previous.coverage, ...incoming.coverage, hasFullStreamCoverage: previous.coverage.hasFullStreamCoverage }
      : coverage

  return {
    ...incoming,
    rollups,
    fullRollups: fullRollups.length > 0 ? fullRollups : incoming.fullRollups,
    coverage: mergedCoverage,
    peaks: (incoming.peaks?.length ?? 0) >= (previous.peaks?.length ?? 0) ? incoming.peaks : previous.peaks,
    games: mergeGamesBySegment(previous.games, incoming.games),
    peakEmotePerMin: incoming.peakEmotePerMin ?? previous.peakEmotePerMin,
    peakViewers: incoming.peakViewers ?? previous.peakViewers,
  }
}
