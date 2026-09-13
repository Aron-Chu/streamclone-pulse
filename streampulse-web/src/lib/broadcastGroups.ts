import type { DiscoveryMoment } from './discoveryMoments'

/**
 * One indexed broadcast and the detections loaded for it.
 *
 * Everything here is derived from the detections that are actually loaded, and
 * named to say so. The stored-discovery catalogue supplies no broadcast record
 * — no start time, no duration, no per-broadcast coverage — so this type
 * deliberately has no `duration` or `coverage` field to guess with. Day-level
 * coverage in `DiscoveryDay` is scoped to the whole day, not to one stream, and
 * must not be re-labelled as this broadcast's coverage.
 */
export interface BroadcastGroup {
  streamId: string
  login: string
  displayName?: string
  /** Categories seen across loaded detections; a broadcast can change category. */
  categories: string[]
  /** Earliest/latest loaded detection — NOT the broadcast's start and end. */
  firstAt?: number
  lastAt?: number
  /** Offsets of the earliest/latest loaded detection, in stream time. */
  firstOffsetSeconds: number
  lastOffsetSeconds: number
  /** How many detections are loaded for this broadcast so far. */
  loadedCount: number
  moments: DiscoveryMoment[]
}

const byOffset = (left: DiscoveryMoment, right: DiscoveryMoment) =>
  left.offsetSeconds - right.offsetSeconds

/**
 * Group loaded detections by the broadcast that owns them.
 *
 * Distinct `streamId`s are never merged, even for the same creator on the same
 * day — two broadcasts are two broadcasts. Groups are ordered by their earliest
 * loaded detection so the day reads chronologically; detections within a group
 * are ordered by stream offset so a broadcast reads front to back.
 */
export function groupMomentsByBroadcast(moments: DiscoveryMoment[]): BroadcastGroup[] {
  const groups = new Map<string, BroadcastGroup>()
  for (const moment of moments) {
    // Identity is creator + stream: a stream id is only unique within a channel.
    const id = `${moment.login}:${moment.streamId}`
    const existing = groups.get(id)
    if (!existing) {
      groups.set(id, {
        streamId: moment.streamId,
        login: moment.login,
        displayName: moment.displayName,
        categories: moment.category ? [moment.category] : [],
        firstAt: moment.at,
        lastAt: moment.at,
        firstOffsetSeconds: moment.offsetSeconds,
        lastOffsetSeconds: moment.offsetSeconds,
        loadedCount: 1,
        moments: [moment],
      })
      continue
    }
    existing.moments.push(moment)
    existing.loadedCount += 1
    existing.displayName ??= moment.displayName
    if (moment.category && !existing.categories.includes(moment.category)) {
      existing.categories.push(moment.category)
    }
    if (moment.at != null) {
      existing.firstAt = existing.firstAt == null ? moment.at : Math.min(existing.firstAt, moment.at)
      existing.lastAt = existing.lastAt == null ? moment.at : Math.max(existing.lastAt, moment.at)
    }
    existing.firstOffsetSeconds = Math.min(existing.firstOffsetSeconds, moment.offsetSeconds)
    existing.lastOffsetSeconds = Math.max(existing.lastOffsetSeconds, moment.offsetSeconds)
  }
  const ordered = [...groups.values()]
  for (const group of ordered) group.moments.sort(byOffset)
  return ordered.sort((left, right) => {
    // Unknown times sort last rather than pretending to be at the epoch.
    if (left.firstAt == null && right.firstAt == null) return 0
    if (left.firstAt == null) return 1
    if (right.firstAt == null) return -1
    return left.firstAt - right.firstAt
  })
}

/**
 * Positions of the loaded detections along the loaded span of one broadcast, as
 * fractions in [0, 1].
 *
 * This is a locator, not an activity series: it says where the loaded
 * detections sit relative to each other, and says nothing about how busy or
 * quiet the stream was between them. A gap here is "nothing loaded", never
 * "nothing happened". Callers must label it that way.
 *
 * Returns an empty array when the loaded span has no width (a single detection,
 * or several sharing one offset), because a position would be meaningless.
 */
export function loadedDetectionPositions(group: BroadcastGroup): number[] {
  const span = group.lastOffsetSeconds - group.firstOffsetSeconds
  if (!Number.isFinite(span) || span <= 0) return []
  return group.moments.map(moment =>
    Math.min(1, Math.max(0, (moment.offsetSeconds - group.firstOffsetSeconds) / span)),
  )
}
