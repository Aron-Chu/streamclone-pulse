import type { ExtensionEmote, ExtensionGameSegment, ExtensionPeak, ExtensionRollup, PulseCoverage, PulsePayload } from '../shared/messages.ts'
import { makeFullHistoryActivation, sameFullHistoryActivation } from '../shared/fullHistoryAuth.ts'

export type PulsePayloadMergeSource = 'recent' | 'full'

export interface PulsePayloadMergeOptions {
  /** Explicit transport source; omitted callers retain shape-based compatibility. */
  source?: PulsePayloadMergeSource
}

const RECENT_AUTHORITATIVE_FIELDS = [
  'login',
  'streamId',
  'vodId',
  'isLive',
  'tracking',
  'mode',
  'provisional',
  'resolutionState',
  'retryable',
  'currentOffsetSeconds',
  'startedAt',
  'endedAt',
  'latestEndedAt',
  'title',
  'category',
  'durationSeconds',
  'coverageStartOffsetSeconds',
  'viewerStartOffsetSeconds',
  'helixEnabled',
  'rosterEligible',
  'top500Eligible',
] as const satisfies readonly (keyof PulsePayload)[]

function preserveRecentAuthoritativeFields(
  previous: PulsePayload,
  incoming: PulsePayload,
  source: PulsePayloadMergeSource,
  sameSurface: boolean,
  sameActivation: boolean,
): PulsePayload {
  if (source !== 'full' || !sameSurface || !sameActivation) return incoming

  // Full history is enrichment. A response can be archival or stale even when
  // its rollups belong to the same stream, so recent live identity/status wins.
  const next: Record<string, unknown> = { ...incoming }
  for (const field of RECENT_AUTHORITATIVE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(previous, field)) {
      next[field] = previous[field]
    }
  }
  // A live recent payload may legitimately omit end timestamps. Do not let a
  // stale Full response manufacture an ended-looking payload while isLive is
  // retained as true.
  if (previous.isLive === true) {
    if (!Object.prototype.hasOwnProperty.call(previous, 'endedAt')) delete next.endedAt
    if (!Object.prototype.hasOwnProperty.call(previous, 'latestEndedAt')) delete next.latestEndedAt
  }
  return next as unknown as PulsePayload
}

function samePayloadValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== typeof b) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
      if (!samePayloadValue(a[i], b[i])) return false
    }
    return true
  }

  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (!samePayloadValue(left[key], right[key])) return false
  }
  return true
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
      || x.providerEmoteId !== y.providerEmoteId
      || x.imageUrl !== y.imageUrl
      || Boolean(x.zeroWidth) !== Boolean(y.zeroWidth)
      || Boolean(x.animated) !== Boolean(y.animated)
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
    && (a.keywordCount ?? 0) === (b.keywordCount ?? 0)
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
    || a.reasonLabel !== b.reasonLabel
    || (a.chatCount ?? 0) !== (b.chatCount ?? 0)
    || (a.emoteCount ?? 0) !== (b.emoteCount ?? 0)
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
  // An omitted field means the lightweight response did not carry peaks;
  // an explicit empty array is authoritative and must be allowed to clear
  // stale peaks from a previous activation/window.
  if (next == null) return previous
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
    && a.categoryId === b.categoryId
    && a.boxArtUrl === b.boxArtUrl
  )
}

function preferStableGames(
  previous: ExtensionGameSegment[] | undefined,
  next: ExtensionGameSegment[] | undefined,
): ExtensionGameSegment[] | undefined {
  if (next === previous) return previous
  // Preserve only omitted game timelines. An explicit [] is a valid
  // authoritative response, especially after a stream/route change.
  if (next == null) return previous
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

/**
 * Ordinary poll fields may only be retained on the same visible channel
 * surface. Full-history retention is stricter and still requires a stable
 * stream/VOD activation; this looser identity also supports the initial
 * lightweight payloads that do not carry either id yet.
 */
function samePayloadSurface(previous: PulsePayload, incoming: PulsePayload): boolean {
  const previousLogin = String(previous.login ?? '').trim().toLowerCase()
  const incomingLogin = String(incoming.login ?? '').trim().toLowerCase()
  if (!previousLogin || previousLogin !== incomingLogin) return false

  const previousStreamId = String(previous.streamId ?? '').trim()
  const incomingStreamId = String(incoming.streamId ?? '').trim()
  if (previousStreamId || incomingStreamId) {
    return Boolean(previousStreamId && incomingStreamId && previousStreamId === incomingStreamId)
  }

  const previousVodId = String(previous.vodId ?? '').trim()
  const incomingVodId = String(incoming.vodId ?? '').trim()
  if (previousVodId || incomingVodId) {
    return Boolean(previousVodId && incomingVodId && previousVodId === incomingVodId)
  }

  return true
}

function mergeGamesBySegment(
  previous: ExtensionGameSegment[] | undefined,
  incoming: ExtensionGameSegment[] | undefined,
): ExtensionGameSegment[] | undefined {
  // Backend game timelines are authoritative per response: an explicitly
  // supplied array replaces the previous timeline outright. Unioning a shorter
  // corrected response with a longer stale one would resurrect cross-stream or
  // removed segments client-side. Only an omitted field is non-authoritative.
  return incoming === undefined ? previous : incoming
}

function mergeRollupsByOffset(previous: ExtensionRollup[], incoming: ExtensionRollup[]): ExtensionRollup[] {
  if (previous.length === 0) return incoming
  if (incoming.length >= previous.length) return incoming

  const byOffset = new Map<number, ExtensionRollup>()
  for (const rollup of previous) byOffset.set(rollup.offsetSeconds, rollup)
  for (const rollup of incoming) byOffset.set(rollup.offsetSeconds, rollup)
  return [...byOffset.values()].sort((a, b) => a.offsetSeconds - b.offsetSeconds)
}

/**
 * Merge a payload without letting a Full-history enrichment downgrade recent
 * live truth or let a recent poll discard validated same-stream Full rollups.
 */
export function mergePulsePayload(
  previous: PulsePayload | null | undefined,
  incoming: PulsePayload,
  options: PulsePayloadMergeOptions = {},
): PulsePayload {
  if (!previous) return incoming

  // The response envelope predates explicit source metadata. Full responses
  // carry fullRollups, so retain that inference for existing callers while
  // allowing request-aware callers/tests to pass the source explicitly.
  const source = options.source ?? (incoming.fullRollups !== undefined ? 'full' : 'recent')
  const sameSurface = samePayloadSurface(previous, incoming)
  const sameActivation = sameFullHistoryActivation(
    makeFullHistoryActivation(previous),
    makeFullHistoryActivation(incoming),
  )

  const prevFull = sameActivation ? previous.fullRollups : undefined
  // Recent responses omit fullRollups when they intentionally provide only a
  // recent tail. A full-window response supplies the field, including [] on a
  // validated empty/error result; never use array length as provenance.
  const mergedFull = source === 'full'
    ? incoming.fullRollups === undefined
      ? prevFull
      : incoming.fullRollups
    : prevFull ?? (sameActivation ? incoming.fullRollups : undefined)

  const mergedRollups = sameSurface
    ? mergeRollupsByOffset(previous.rollups, incoming.rollups)
    : incoming.rollups

  const coverage =
    incoming.coverage ??
    (sameSurface ? previous.coverage : undefined) ??
    undefined

  const mergedCoverage =
    coverage && sameActivation && previous.coverage?.hasFullStreamCoverage && !incoming.coverage?.hasFullStreamCoverage
      ? { ...previous.coverage, ...incoming.coverage, hasFullStreamCoverage: previous.coverage.hasFullStreamCoverage }
      : coverage

  const mergedPeaks = incoming.peaks === undefined
    ? (sameSurface ? previous.peaks : undefined)
    : incoming.peaks

  const rollups = sameSurface
    ? preferStableRollups(previous.rollups, mergedRollups) ?? mergedRollups
    : mergedRollups
  const fullRollups = mergedFull === undefined
    ? undefined
    : sameSurface
      ? preferStableRollups(previous.fullRollups, mergedFull)
      : mergedFull
  const peaks = sameSurface
    ? preferStablePeaks(previous.peaks, mergedPeaks)
    : mergedPeaks
  const games = preferStableGames(
    sameSurface ? previous.games : undefined,
    sameSurface ? mergeGamesBySegment(previous.games, incoming.games) : incoming.games,
  )
  const stableCoverage = sameSurface
    ? preferStableCoverage(previous.coverage, mergedCoverage)
    : mergedCoverage

  const next: PulsePayload = {
    ...preserveRecentAuthoritativeFields(previous, incoming, source, sameSurface, sameActivation),
    rollups,
    fullRollups,
    coverage: stableCoverage,
    peaks,
    games,
    peakEmotePerMin: incoming.peakEmotePerMin ?? (sameSurface ? previous.peakEmotePerMin : undefined),
    peakViewers: incoming.peakViewers ?? (sameSurface ? previous.peakViewers : undefined),
    topEmotes: sameSurface && sameTopEmotes(previous.topEmotes, incoming.topEmotes)
      ? previous.topEmotes
      : incoming.topEmotes,
  }

  // Identical polls often clone empty lane/recap objects; keep the previous root
  // so overlay mounts can skip React work via reference equality.
  if (
    sameSurface
    && next.rollups === previous.rollups
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
    && next.mode === previous.mode
    && next.provisional === previous.provisional
    && next.resolutionState === previous.resolutionState
    && next.retryable === previous.retryable
    && next.vodOriginDeltaSeconds === previous.vodOriginDeltaSeconds
    && next.startedAt === previous.startedAt
    && next.endedAt === previous.endedAt
    && next.latestEndedAt === previous.latestEndedAt
    && next.durationSeconds === previous.durationSeconds
    && next.coverageStartOffsetSeconds === previous.coverageStartOffsetSeconds
    && next.viewerStartOffsetSeconds === previous.viewerStartOffsetSeconds
    && next.helixEnabled === previous.helixEnabled
    && next.rosterEligible === previous.rosterEligible
    && next.top500Eligible === previous.top500Eligible
    && samePayloadValue(next.lanes, previous.lanes)
    && samePayloadValue(next.recap, previous.recap)
    && samePayloadValue(next.emoteSync, previous.emoteSync)
  ) {
    return previous
  }

  return next
}
