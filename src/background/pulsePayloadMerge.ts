import type { ExtensionGameSegment, ExtensionPeak, ExtensionRollup, PulsePayload } from '../shared/messages.ts'

function gameSegmentKey(segment: ExtensionGameSegment): string {
  return `${segment.gameName.trim().toLowerCase()}:${segment.offsetSeconds}`
}

/** Drop the pre-descent alias plateau (...22h, then 00:00 live segment). */
export function stripAliasedPriorTimeline(rollups: ExtensionRollup[]): ExtensionRollup[] {
  if (rollups.length < 2) return rollups
  let cut = 0
  for (let i = 1; i < rollups.length; i += 1) {
    const prev = rollups[i - 1]?.offsetSeconds ?? 0
    const next = rollups[i]?.offsetSeconds ?? 0
    if (next + 120 < prev) cut = i
  }
  return cut > 0 ? rollups.slice(cut) : rollups
}

function clipFullRollupsToHorizon(
  rollups: ExtensionRollup[],
  currentOffsetSeconds: number,
): ExtensionRollup[] {
  if (rollups.length === 0 || !(currentOffsetSeconds > 0)) return rollups
  const stripped = stripAliasedPriorTimeline(rollups)
  const limit = Math.floor(currentOffsetSeconds / 60) * 60 + 60
  return stripped.filter(rollup => (rollup.offsetSeconds ?? 0) <= limit)
}

function clipPeaksToHorizon(
  peaks: ExtensionPeak[] | undefined,
  currentOffsetSeconds: number,
): ExtensionPeak[] | undefined {
  if (!peaks?.length) return peaks
  if (!(currentOffsetSeconds > 0)) return peaks
  const limit = currentOffsetSeconds + 60
  const next = peaks.filter(peak => (peak.offsetSeconds ?? 0) <= limit)
  return next.length > 0 ? next : []
}

function clampGamesToDuration(
  games: ExtensionGameSegment[] | undefined,
  durationSeconds: number,
): ExtensionGameSegment[] | undefined {
  if (!games?.length || !(durationSeconds > 0)) return games
  const next = games
    .map(segment => {
      if (segment.offsetSeconds >= durationSeconds) return null
      const maxDur = durationSeconds - segment.offsetSeconds
      const duration = Math.min(Math.max(0, segment.durationSeconds), maxDur)
      if (duration <= 0) return null
      return { ...segment, durationSeconds: duration }
    })
    .filter((segment): segment is ExtensionGameSegment => segment != null)
  return next.length > 0 ? next : undefined
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
  if (!previous) {
    const horizon = incoming.currentOffsetSeconds ?? incoming.durationSeconds ?? 0
    return {
      ...incoming,
      fullRollups: incoming.fullRollups?.length
        ? clipFullRollupsToHorizon(incoming.fullRollups, horizon)
        : incoming.fullRollups,
      peaks: clipPeaksToHorizon(incoming.peaks, horizon),
      games: clampGamesToDuration(incoming.games, horizon),
    }
  }

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

  const horizon = incoming.currentOffsetSeconds ?? incoming.durationSeconds ?? 0
  const mergedPeaks =
    (incoming.peaks?.length ?? 0) >= (previous.peaks?.length ?? 0) ? incoming.peaks : previous.peaks

  return {
    ...incoming,
    rollups,
    fullRollups: fullRollups.length > 0
      ? clipFullRollupsToHorizon(fullRollups, horizon)
      : incoming.fullRollups,
    coverage: mergedCoverage,
    peaks: clipPeaksToHorizon(mergedPeaks, horizon),
    games: clampGamesToDuration(
      mergeGamesBySegment(previous.games, incoming.games),
      horizon,
    ),
    peakEmotePerMin: incoming.peakEmotePerMin ?? previous.peakEmotePerMin,
    peakViewers: incoming.peakViewers ?? previous.peakViewers,
  }
}
