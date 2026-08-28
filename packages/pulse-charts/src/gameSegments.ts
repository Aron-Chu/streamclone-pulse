import type { ChartGameSegment } from './types.ts'

export function normalizeGameSegments(
  games: ChartGameSegment[],
  durationSeconds: number,
): ChartGameSegment[] {
  if (!games.length || durationSeconds <= 0) return []

  const cleaned = games
    .filter(game =>
      Number.isFinite(game.offsetSeconds)
      && Number.isFinite(game.durationSeconds)
      && game.offsetSeconds >= 0,
    )
    .map(game => ({
      ...game,
      offsetSeconds: Math.max(0, game.offsetSeconds),
      durationSeconds: Math.max(0, game.durationSeconds),
    }))

  if (!cleaned.length) return []

  const needsRepair = cleaned.every(game => game.durationSeconds <= 0)
  if (needsRepair) {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return []
    const each = Math.max(60, Math.floor(durationSeconds / cleaned.length))
    let offset = 0
    return cleaned.map((game, index) => {
      const segmentDuration = index === cleaned.length - 1
        ? Math.max(60, durationSeconds - offset)
        : each
      const segment = { ...game, offsetSeconds: offset, durationSeconds: segmentDuration }
      offset += segmentDuration
      return segment
    })
  }

  // Clamp to the visible stream window so stale/overlong segments (e.g. 51h on a 2h
  // live session) cannot blow out Games played labels or SVG game geometry.
  return cleaned
    .map(game => {
      if (game.offsetSeconds >= durationSeconds) {
        return { ...game, durationSeconds: 0 }
      }
      const maxDur = durationSeconds - game.offsetSeconds
      return {
        ...game,
        durationSeconds: Math.min(game.durationSeconds, maxDur),
      }
    })
    .filter(game => game.durationSeconds > 0)
}

/** True when there is at least one named game segment worth showing in Games played. */
export function hasMeaningfulGameSegments(
  segments: ChartGameSegment[],
  durationSeconds: number,
): boolean {
  if (!segments.length || durationSeconds <= 0) return false
  if (segments.length > 1) return true
  const only = segments[0]!
  return (only.gameName ?? '').trim().length > 0
}

export function gameSegmentKey(
  segment: Pick<ChartGameSegment, 'gameName' | 'offsetSeconds'>,
): string {
  const name = (segment.gameName ?? '').trim().toLowerCase()
  return `${name}:${segment.offsetSeconds}`
}

function gameSegmentEndOffset(
  segment: Pick<ChartGameSegment, 'offsetSeconds' | 'durationSeconds'>,
): number {
  return segment.offsetSeconds + Math.max(0, segment.durationSeconds)
}

export function gameSegmentOverlapsOffsetRange(
  segment: Pick<ChartGameSegment, 'offsetSeconds' | 'durationSeconds'>,
  rangeStart: number,
  rangeEnd: number,
): boolean {
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) return false
  const start = segment.offsetSeconds
  const end = gameSegmentEndOffset(segment)
  return end > rangeStart && start <= rangeEnd
}

export function gameSegmentVisibleSecondsInRange(
  segment: Pick<ChartGameSegment, 'offsetSeconds' | 'durationSeconds'>,
  rangeStart: number,
  rangeEnd: number,
): number {
  if (!gameSegmentOverlapsOffsetRange(segment, rangeStart, rangeEnd)) return 0
  const start = segment.offsetSeconds
  const end = gameSegmentEndOffset(segment)
  const visibleStart = Math.max(start, rangeStart)
  const visibleEnd = Math.min(end, rangeEnd)
  return Math.max(0, visibleEnd - visibleStart)
}
