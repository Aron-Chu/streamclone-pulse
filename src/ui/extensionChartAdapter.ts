import {
  gameSegmentKey,
  gameSegmentOverlapsOffsetRange,
  hasMeaningfulGameSegments,
  normalizeGameSegments,
  resolveGamesPlayedTimelineRange,
  type ChartGameSegment,
  type ChartMinuteRollup,
} from '@streampulse/pulse-charts'
import type { ExtensionEmote, ExtensionGameSegment, ExtensionRollup } from '../shared/messages.ts'
import type { GamesPlayedVisibleRange } from './GamesPlayedStrip.tsx'
import { emoteSelectionKey } from './chatActivityEmotes.ts'

function minuteTsFromOffset(startedAt: string | undefined, offsetSeconds: number): string {
  if (startedAt) {
    const startMs = Date.parse(startedAt)
    if (Number.isFinite(startMs)) {
      return new Date(startMs + Math.max(0, offsetSeconds) * 1000).toISOString()
    }
  }
  return new Date(Math.max(0, offsetSeconds) * 1000).toISOString()
}

export function extensionRollupsToChartMinutes(
  rollups: ExtensionRollup[],
  startedAt?: string,
): ChartMinuteRollup[] {
  return rollups.map(rollup => {
    const emotes: Record<string, number> = {}
    for (const emote of rollup.topEmotes ?? []) {
      const key = emoteSelectionKey(emote)
      if (!key) continue
      emotes[key] = (emotes[key] ?? 0) + (emote.count ?? 0)
    }
    const viewerCount = rollup.viewerCount ?? 0
    return {
      minuteTs: minuteTsFromOffset(startedAt, rollup.offsetSeconds),
      viewerAvg: viewerCount,
      viewerMax: viewerCount,
      viewerLatest: viewerCount,
      viewerSamples: viewerCount > 0 ? 1 : 0,
      chatCount: rollup.chatCount ?? 0,
      totalEmoteCount: rollup.totalEmoteCount ?? rollup.sevenTvEmoteCount ?? 0,
      seventvEmoteCount: rollup.sevenTvEmoteCount ?? 0,
      emotes,
      missing: rollup.missing,
    }
  })
}

/** Tolerance (seconds) a game timeline may overrun the known stream duration before it is treated as cross-stream stale data. */
export const GAME_TIMELINE_TOLERANCE_SECONDS = 120

/**
 * Coherence guard for backend-supplied game timelines: rejects the ENTIRE array
 * when it cannot belong to the current stream — any segment starting at/beyond
 * the stream duration, any segment ending more than the tolerance beyond it, or
 * segments whose total covered time overruns the stream by more than the
 * tolerance. Unknown/zero durations never reject (nothing to compare against).
 */
export function rejectIncoherentGameTimeline(
  games: ExtensionGameSegment[],
  durationSeconds: number,
): boolean {
  if (!games.length) return false
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false

  let totalCoveredSeconds = 0
  for (const game of games) {
    if (!Number.isFinite(game.offsetSeconds) || !Number.isFinite(game.durationSeconds)) continue
    if (game.offsetSeconds >= durationSeconds) return true
    const covered = Math.max(0, game.durationSeconds)
    totalCoveredSeconds += covered
    if (game.offsetSeconds + covered > durationSeconds + GAME_TIMELINE_TOLERANCE_SECONDS) {
      return true
    }
  }
  return totalCoveredSeconds > durationSeconds + GAME_TIMELINE_TOLERANCE_SECONDS
}

/**
 * Sanitized game timeline for recap/VOD surfaces: returns the array only when
 * it coherently belongs to the given duration, otherwise undefined so callers
 * render an honest empty/fallback state instead of a stale cross-stream list.
 */
export function safeGameTimeline(
  games: ExtensionGameSegment[] | undefined,
  durationSeconds: number,
): ExtensionGameSegment[] | undefined {
  if (!games?.length) return undefined
  return rejectIncoherentGameTimeline(games, durationSeconds) ? undefined : games
}

/**
 * Live overlay chart: show current category when backend omits games (rc15 live gap)
 * or supplies an incoherent cross-stream timeline (stale game segments).
 */
export function extensionGamesForOverviewChart(
  games: ExtensionGameSegment[] | undefined,
  category: string | undefined,
  durationSeconds: number,
): ExtensionGameSegment[] {
  const suppliedGames =
    games?.length && !rejectIncoherentGameTimeline(games, durationSeconds) ? games : undefined
  if (suppliedGames?.length) return suppliedGames
  const gameName = String(category ?? '').trim()
  if (!gameName || durationSeconds <= 0) return []
  return [{
    gameName,
    offsetSeconds: 0,
    durationSeconds,
  }]
}

export function extensionGamesToChartGames(
  games: ExtensionGameSegment[] | undefined,
  durationSeconds: number,
): ChartGameSegment[] {
  const normalized = normalizeGameSegments(
    (games ?? []).map(game => ({
      gameName: game.gameName,
      boxArtUrl: game.boxArtUrl,
      categoryId: game.categoryId,
      offsetSeconds: game.offsetSeconds,
      durationSeconds: game.durationSeconds,
    })),
    durationSeconds,
  )
  if (!hasMeaningfulGameSegments(normalized, durationSeconds)) return []
  return normalized
}

/**
 * Chart-visible offset window. Minute rollups are bucket starts — the last minute
 * covers `[last, last+60)`, so endOffset is exclusive of the open end of that bucket.
 */
export function chartVisibleRangeFromRollups(
  rollups: Array<{ offsetSeconds: number }>,
): GamesPlayedVisibleRange | null {
  if (rollups.length === 0) return null
  const startOffset = rollups[0]!.offsetSeconds
  const lastOffset = rollups[rollups.length - 1]!.offsetSeconds
  return {
    startOffset,
    endOffset: lastOffset + 60,
  }
}

export function chartHighlightedGameKey(
  hoveredGameKey: string | null,
  games: ExtensionGameSegment[] | undefined,
  durationSeconds: number,
  visibleRange: GamesPlayedVisibleRange | null,
): string | null {
  if (!hoveredGameKey) return null
  const segments = normalizeGameSegments(games ?? [], durationSeconds)
  const segment = segments.find(game => gameSegmentKey(game) === hoveredGameKey)
  if (!segment) return null
  // Align with GamesPlayedStrip: prefer chart window, else full stream duration.
  const range = resolveGamesPlayedTimelineRange(visibleRange, durationSeconds, segments)
  if (!range) return null
  return gameSegmentOverlapsOffsetRange(segment, range.startOffset, range.endOffset)
    ? hoveredGameKey
    : null
}

export function emoteKeysFromExtension(
  catalog: ExtensionEmote[],
  selectedKeys: string[],
): Set<string> {
  const keys = new Set<string>()
  for (const key of selectedKeys.slice(0, 5)) {
    const emote = catalog.find(item => emoteSelectionKey(item) === key)
    if (emote) keys.add(emoteSelectionKey(emote))
  }
  return keys
}

export function chartRollupIndexForOffset(
  chartRollups: ChartMinuteRollup[],
  startedAt: string | undefined,
  offsetSeconds: number,
): number | null {
  if (!Number.isFinite(offsetSeconds) || chartRollups.length === 0) return null
  const targetMs = startedAt
    ? Date.parse(startedAt) + offsetSeconds * 1000
    : offsetSeconds * 1000
  if (!Number.isFinite(targetMs)) return null
  let best = 0
  let bestDist = Infinity
  chartRollups.forEach((rollup, index) => {
    const ms = Date.parse(rollup.minuteTs)
    if (!Number.isFinite(ms)) return
    const dist = Math.abs(ms - targetMs)
    if (dist < bestDist) {
      bestDist = dist
      best = index
    }
  })
  return best
}
