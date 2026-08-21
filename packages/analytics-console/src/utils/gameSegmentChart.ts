export type GameSegmentPlotInput = {
  offsetSeconds: number
  durationSeconds: number
}

export type RollupMinuteTs = {
  minuteTs: string
}

const PLACEHOLDER_CATEGORIES = /^(live|syncing\.{3}|syncing…)$/i

/** Span in seconds covered by minute rollup timestamps (inclusive of last bucket). */
export function minuteRollupSpanSeconds(rollups: Array<{ minuteTs: string }>): number {
  if (rollups.length === 0) return 0
  if (rollups.length === 1) return 60
  const first = Date.parse(rollups[0].minuteTs)
  const last = Date.parse(rollups[rollups.length - 1].minuteTs)
  if (!Number.isFinite(first) || !Number.isFinite(last)) return rollups.length * 60
  return Math.max(60, Math.round((last - first) / 1000) + 60)
}

const WALL_DURATION_SKEW_SECONDS = 120

/** Helix/session wall length — caps overlong TwitchTracker rollup spans. */
export function streamWallDurationSeconds(
  stream?: { startedAt?: string; endedAt?: string | null } | null,
  nowMs: number = Date.now(),
): number {
  const startMs = Date.parse(stream?.startedAt ?? '')
  if (!Number.isFinite(startMs)) return 0
  const endedMs = stream?.endedAt ? Date.parse(stream.endedAt) : Number.NaN
  const endMs = Number.isFinite(endedMs) ? endedMs : nowMs
  if (!Number.isFinite(endMs) || endMs < startMs) return 0
  return Math.max(0, Math.round((endMs - startMs) / 1000) + WALL_DURATION_SKEW_SECONDS)
}

/** Prefer the shorter of rollup span vs wall duration so Games/chart stay honest. */
export function clampGamesDurationSeconds(rollupSpan: number, wallDuration: number): number {
  if (wallDuration > 0 && rollupSpan > 0) return Math.min(rollupSpan, wallDuration)
  if (wallDuration > 0) return wallDuration
  return Math.max(0, rollupSpan)
}

/** Drop reconstructed rollups that sit past wall duration (defense in depth). */
export function trimRollupsToWallDuration<T extends { minuteTs: string }>(
  rollups: T[],
  streamStartedAt: string | undefined,
  wallDuration: number,
): T[] {
  if (!rollups.length || wallDuration <= 0 || !streamStartedAt) return rollups
  const startMs = Date.parse(streamStartedAt)
  if (!Number.isFinite(startMs)) return rollups
  const maxMs = startMs + wallDuration * 1000
  return rollups.filter(point => {
    const ts = Date.parse(point.minuteTs)
    return Number.isFinite(ts) && ts <= maxMs
  })
}

type ChartGameSegment = {
  id: number
  streamId: string
  gameName: string
  boxArtUrl: string
  categoryId?: string
  offsetSeconds: number
  durationSeconds: number
  createdAt: string
  source?: string
}

/** Game covering a stream offset, if any (for Selected Moment / readout). */
export function gameNameAtOffset(
  games: Array<{ gameName: string; offsetSeconds: number; durationSeconds: number }> | null | undefined,
  offsetSeconds: number,
): string | null {
  if (!games?.length || !Number.isFinite(offsetSeconds)) return null
  for (const game of games) {
    if (!Number.isFinite(game.offsetSeconds) || !Number.isFinite(game.durationSeconds)) continue
    const end = game.offsetSeconds + Math.max(0, game.durationSeconds)
    if (offsetSeconds >= game.offsetSeconds && offsetSeconds < end) {
      const name = game.gameName.trim()
      return name || null
    }
  }
  // Live tail: last segment may still be "current" at/after its start.
  const last = games[games.length - 1]
  if (
    last
    && Number.isFinite(last.offsetSeconds)
    && offsetSeconds >= last.offsetSeconds
    && last.gameName.trim()
  ) {
    return last.gameName.trim()
  }
  return null
}

/** Synthesize one chart segment when the games API is empty but stream category is known. */
export function deriveChartGameSegments(
  streamId: string,
  detail: { stream?: { category?: string; categoryId?: string }; rollups?: Array<{ minuteTs: string }> } | null | undefined,
  apiSegments: ChartGameSegment[] | null | undefined,
  options?: { allowCategoryFallback?: boolean },
): ChartGameSegment[] {
  const category = detail?.stream?.category?.trim() ?? ''
  const categoryId = detail?.stream?.categoryId?.trim() || undefined
  if (apiSegments?.length) {
    // A segment can be valid but still lack identity when the portal stream
    // record was synthesized from the current category. Only repair a segment
    // whose name matches that category; never apply one game's id to another
    // historical segment.
    if (!categoryId || !category) return apiSegments
    const normalizedCategory = category.toLowerCase()
    return apiSegments.map(segment => {
      if (segment.categoryId?.trim() || segment.gameName.trim().toLowerCase() !== normalizedCategory) {
        return segment
      }
      return { ...segment, categoryId }
    })
  }
  if (options?.allowCategoryFallback === false) return []
  if (!category || PLACEHOLDER_CATEGORIES.test(category)) return []
  const rollups = detail?.rollups ?? []
  const durationSeconds = minuteRollupSpanSeconds(rollups)
  if (durationSeconds <= 0) return []
  return [
    {
      id: 0,
      streamId,
      gameName: category,
      boxArtUrl: '',
      categoryId,
      offsetSeconds: 0,
      durationSeconds,
      createdAt: new Date(0).toISOString(),
      source: 'category_fallback',
    },
  ]
}

/** Map absolute stream game segments onto the visible chart rollup window. */
export function gameSegmentPlotBounds(
  segment: GameSegmentPlotInput,
  rollups: RollupMinuteTs[],
  streamStartedAt: string | undefined,
  plotLeft: number,
  plotWidth: number,
): { startX: number; endX: number; centerX: number; textWidth: number } | null {
  if (
    rollups.length < 1
    || !Number.isFinite(segment.offsetSeconds)
    || !Number.isFinite(segment.durationSeconds)
    || segment.durationSeconds <= 0
    || plotWidth <= 0
  ) {
    return null
  }

  const chartFirstMs = Date.parse(rollups[0].minuteTs)
  const chartLastMs = Date.parse(rollups[rollups.length - 1].minuteTs)
  if (!Number.isFinite(chartFirstMs) || !Number.isFinite(chartLastMs)) return null
  const chartSpanMs = chartLastMs - chartFirstMs
  if (!Number.isFinite(chartSpanMs) || chartSpanMs <= 0) return null

  const streamStartMs = streamStartedAt ? Date.parse(streamStartedAt) : chartFirstMs
  if (!Number.isFinite(streamStartMs)) return null

  const segStartMs = streamStartMs + Math.max(0, segment.offsetSeconds) * 1000
  const segEndMs = segStartMs + segment.durationSeconds * 1000
  const visibleStartMs = Math.max(chartFirstMs, segStartMs)
  const visibleEndMs = Math.min(chartLastMs, segEndMs)
  if (visibleEndMs <= visibleStartMs) return null

  const startPct = (visibleStartMs - chartFirstMs) / chartSpanMs
  const endPct = (visibleEndMs - chartFirstMs) / chartSpanMs
  const startX = plotLeft + startPct * plotWidth
  const endX = plotLeft + endPct * plotWidth
  if (!Number.isFinite(startX) || !Number.isFinite(endX)) return null

  return {
    startX,
    endX,
    centerX: (startX + endX) / 2,
    textWidth: endX - startX,
  }
}
