import type { ExtensionEmote, ExtensionGameSegment, ExtensionPeak, ExtensionRollup, PulseCoverage, PulsePayload } from '../shared/messages.ts'

function gameSegmentKey(segment: ExtensionGameSegment): string {
  return `${segment.gameName.trim().toLowerCase()}:${segment.offsetSeconds}`
}

function sameTopEmotes(
  a: ExtensionEmote[] | undefined,
  b: ExtensionEmote[] | undefined,
): boolean {
  if (a === b) return true
  const left = a ?? []
  const right = b ?? []
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    const x = left[i]!
    const y = right[i]!
    if (x === y) continue
    if (
      x.id !== y.id
      || x.name !== y.name
      || x.provider !== y.provider
      || (x.count ?? 0) !== (y.count ?? 0)
    ) {
      return false
    }
  }
  return true
}

function sameRollup(a: ExtensionRollup, b: ExtensionRollup): boolean {
  if (a === b) return true
  return (
    a.offsetSeconds === b.offsetSeconds
    && (a.chatCount ?? 0) === (b.chatCount ?? 0)
    && (a.sevenTvEmoteCount ?? 0) === (b.sevenTvEmoteCount ?? 0)
    && (a.totalEmoteCount ?? 0) === (b.totalEmoteCount ?? 0)
    && (a.viewerCount ?? 0) === (b.viewerCount ?? 0)
    && Boolean(a.missing) === Boolean(b.missing)
    && sameTopEmotes(a.topEmotes, b.topEmotes)
  )
}

function sameRollupArray(
  previous: ExtensionRollup[] | undefined,
  next: ExtensionRollup[] | undefined,
): boolean {
  if (previous === next) return true
  if (!previous || !next || previous.length !== next.length) return false
  for (let i = 0; i < previous.length; i += 1) {
    if (!sameRollup(previous[i]!, next[i]!)) return false
  }
  return true
}

function preferStableRollups(
  previous: ExtensionRollup[] | undefined,
  next: ExtensionRollup[] | undefined,
): ExtensionRollup[] | undefined {
  if (next == null) return previous
  if (previous == null) return next
  return sameRollupArray(previous, next) ? previous : next
}

function samePeak(a: ExtensionPeak, b: ExtensionPeak): boolean {
  if (a === b) return true
  if (
    a.offsetSeconds !== b.offsetSeconds
    || a.score !== b.score
    || a.dominantSignal !== b.dominantSignal
  ) {
    return false
  }
  const ar = a.reasons ?? []
  const br = b.reasons ?? []
  if (ar.length !== br.length) return false
  for (let i = 0; i < ar.length; i += 1) {
    if (ar[i] !== br[i]) return false
  }
  return true
}

function preferStablePeaks(
  previous: ExtensionPeak[] | undefined,
  next: ExtensionPeak[] | undefined,
): ExtensionPeak[] | undefined {
  if (next === previous) return previous
  if (!next) return previous
  if (!previous) return next
  if (previous.length !== next.length) return next
  for (let i = 0; i < previous.length; i += 1) {
    if (!samePeak(previous[i]!, next[i]!)) return next
  }
  return previous
}

function sameGame(a: ExtensionGameSegment, b: ExtensionGameSegment): boolean {
  if (a === b) return true
  return (
    a.gameName === b.gameName
    && a.offsetSeconds === b.offsetSeconds
    && a.durationSeconds === b.durationSeconds
    && a.boxArtUrl === b.boxArtUrl
  )
}

function preferStableGames(
  previous: ExtensionGameSegment[] | undefined,
  next: ExtensionGameSegment[] | undefined,
): ExtensionGameSegment[] | undefined {
  if (next === previous) return previous
  if (!next) return previous
  if (!previous) return next
  if (previous.length !== next.length) return next
  for (let i = 0; i < previous.length; i += 1) {
    if (!sameGame(previous[i]!, next[i]!)) return next
  }
  return previous
}

function preferStableCoverage(
  previous: PulseCoverage | undefined,
  next: PulseCoverage | undefined,
): PulseCoverage | undefined {
  if (next === previous) return previous
  if (!next) return previous
  if (!previous) return next
  if (
    previous.state === next.state
    && previous.coverageStartOffsetSeconds === next.coverageStartOffsetSeconds
    && previous.coverageEndOffsetSeconds === next.coverageEndOffsetSeconds
    && previous.hasFullStreamCoverage === next.hasFullStreamCoverage
    && previous.hasGaps === next.hasGaps
    && previous.canBackfill === next.canBackfill
    && previous.message === next.message
    && previous.trackedFromStart === next.trackedFromStart
  ) {
    return previous
  }
  return next
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
  const mergedFull =
    nextFull.length >= prevFull.length && nextFull.length > 0
      ? nextFull
      : prevFull.length > 0
        ? prevFull
        : nextFull

  const mergedRollups = mergeRollupsByOffset(previous.rollups, incoming.rollups)

  const coverage =
    incoming.coverage ??
    previous.coverage ??
    undefined

  const mergedCoverage =
    coverage && previous.coverage?.hasFullStreamCoverage && !incoming.coverage?.hasFullStreamCoverage
      ? { ...previous.coverage, ...incoming.coverage, hasFullStreamCoverage: previous.coverage.hasFullStreamCoverage }
      : coverage

  const mergedPeaks =
    (incoming.peaks?.length ?? 0) >= (previous.peaks?.length ?? 0) ? incoming.peaks : previous.peaks

  const rollups = preferStableRollups(previous.rollups, mergedRollups) ?? mergedRollups
  const fullRollups = preferStableRollups(
    previous.fullRollups,
    mergedFull.length > 0 ? mergedFull : incoming.fullRollups,
  )
  const peaks = preferStablePeaks(previous.peaks, mergedPeaks)
  const games = preferStableGames(
    previous.games,
    mergeGamesBySegment(previous.games, incoming.games),
  )
  const stableCoverage = preferStableCoverage(previous.coverage, mergedCoverage)

  const next: PulsePayload = {
    ...incoming,
    rollups,
    fullRollups: fullRollups?.length ? fullRollups : incoming.fullRollups,
    coverage: stableCoverage,
    peaks,
    games,
    peakEmotePerMin: incoming.peakEmotePerMin ?? previous.peakEmotePerMin,
    peakViewers: incoming.peakViewers ?? previous.peakViewers,
    topEmotes: sameTopEmotes(previous.topEmotes, incoming.topEmotes)
      ? previous.topEmotes
      : incoming.topEmotes,
  }

  // Identical polls often clone empty lane/recap objects; keep the previous root
  // so overlay mounts can skip React work via reference equality.
  if (
    next.rollups === previous.rollups
    && next.fullRollups === previous.fullRollups
    && next.peaks === previous.peaks
    && next.games === previous.games
    && next.coverage === previous.coverage
    && next.topEmotes === previous.topEmotes
    && next.peakEmotePerMin === previous.peakEmotePerMin
    && next.peakViewers === previous.peakViewers
    && next.currentOffsetSeconds === previous.currentOffsetSeconds
    && next.isLive === previous.isLive
    && next.tracking === previous.tracking
    && next.streamId === previous.streamId
    && next.login === previous.login
    && next.vodId === previous.vodId
    && next.title === previous.title
    && next.category === previous.category
  ) {
    return previous
  }

  return next
}
