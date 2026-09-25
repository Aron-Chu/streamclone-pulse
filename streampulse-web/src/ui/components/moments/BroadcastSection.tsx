import { useMemo, useState } from 'react'
import { formatStreamOffset } from '../../../lib/formatStreamOffset'
import { loadedDetectionPositions, type BroadcastGroup } from '../../../lib/broadcastGroups'
import { rankBroadcastMoments } from '../../../lib/momentRanking'
import type { ArchiveArtwork } from '../../../lib/archiveArtwork'
import type { DiscoveryMoment } from '../../../lib/discoveryMoments'
import type { PortalStreamRecapResponse } from '../../../lib/streamcloneAnalytics'
import { MomentRow } from './MomentRow'

function timeRange(group: BroadcastGroup): string {
  if (group.firstAt == null || group.lastAt == null) return 'Times unavailable'
  const first = new Date(group.firstAt)
  const last = new Date(group.lastAt)
  const time = (value: Date) => value.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return first.getTime() === last.getTime() ? time(first) : `${time(first)} – ${time(last)}`
}

/**
 * Where the loaded detections sit relative to one another within this
 * broadcast. Explicitly *not* an activity chart: the catalogue supplies no
 * per-minute series, so a gap here means "nothing loaded", not "a quiet
 * stretch". One strip per broadcast, shared by every row beneath it — no chart
 * instance, request or subscription is created per detection.
 */
function LoadedDetectionStrip({ group, selectedKey }: { group: BroadcastGroup; selectedKey?: string }) {
  const positions = loadedDetectionPositions(group)
  if (!positions.length) return null
  return (
    <div className="moments-broadcast__strip">
      <div
        className="moments-broadcast__strip-track"
        role="img"
        aria-label={`Positions of ${positions.length} loaded detections between ${formatStreamOffset(group.firstOffsetSeconds)} and ${formatStreamOffset(group.lastOffsetSeconds)} into this broadcast. Gaps mean nothing was loaded there, not that the stream was quiet.`}
      >
        {positions.map((position, index) => (
          <i
            key={group.moments[index].key}
            style={{ left: `${position * 100}%` }}
            data-selected={group.moments[index].key === selectedKey ? 'true' : undefined}
            aria-hidden="true"
          />
        ))}
      </div>
      <div className="moments-broadcast__strip-scale" aria-hidden="true">
        <span>{formatStreamOffset(group.firstOffsetSeconds)}</span>
        <span>{formatStreamOffset(group.lastOffsetSeconds)}</span>
      </div>
    </div>
  )
}

/**
 * One indexed broadcast on the selected day, as a header over the same compact
 * rows the rest of the page uses.
 *
 * A busy broadcast can load a hundred detections, and every adjacent minute of
 * one reaction is its own detection. Rather than page through all of them, this
 * shows what the backend already ranked for this exact stream and holds the
 * rest behind one disclosure. When no ranking is available the rows are plain
 * stream order and say so — a time-ordered list is never labelled "top".
 */
export function BroadcastSection({
  group,
  index,
  total,
  selectedKey,
  recap,
  rankingLoading,
  resolveArtwork,
  onSelect,
}: {
  group: BroadcastGroup
  index: number
  total: number
  selectedKey?: string
  recap?: PortalStreamRecapResponse | null
  rankingLoading?: boolean
  resolveArtwork?: (moment: DiscoveryMoment) => ArchiveArtwork | undefined
  onSelect: (moment: DiscoveryMoment) => void
}) {
  const heading = `${group.displayName || group.login} · broadcast ${index + 1} of ${total}`
  const ranking = useMemo(() => rankBroadcastMoments(group, recap), [group, recap])
  const [shown, setShown] = useState(20)
  const selectedHidden =
    selectedKey != null &&
    ranking.remainder.some(moment => moment.key === selectedKey)
  const ordered = ranking.ranked.map(row => row.moment).concat(ranking.remainder)
  const rows = (selectedHidden ? ordered : ordered.slice(0, shown)).map(moment => {
    const ranked = ranking.ranked.find(row => row.moment.key === moment.key)
    return { moment, rank: ranked?.rank ?? null, clipCandidate: ranked?.clipCandidate ?? false }
  })
  const showAll = rows.length >= group.loadedCount
  const ordering = ranking.ordering === 'server_score'
    ? ranking.ranked.length >= group.loadedCount
      ? `All ${group.loadedCount.toLocaleString()} loaded detections for this broadcast, in the server's ranked order.`
      : `Top ${ranking.ranked.length} of ${group.loadedCount.toLocaleString()} loaded detections, ranked by the server's reaction score for this broadcast.`
    : rankingLoading
      ? `Loading this broadcast's ranking. Showing the first ${ranking.ranked.length} loaded detections in stream order.`
      // A read can fail as easily as a stream can have no ranking, and this
      // cannot tell them apart — so it reports what happened, not why.
      : `No ranking was returned for this broadcast. Showing the first ${ranking.ranked.length} of ${group.loadedCount.toLocaleString()} loaded detections in stream order.`
  return (
    <section className="moments-broadcast" aria-label={heading}>
      <header className="moments-broadcast__header">
        <h3>{group.displayName || group.login}</h3>
        <p className="moments-broadcast__meta">
          <span>{group.categories.length ? group.categories.join(' · ') : 'Category unavailable'}</span>
          <span aria-hidden="true">·</span>
          <span>{timeRange(group)}</span>
          <span aria-hidden="true">·</span>
          <span>
            {formatStreamOffset(group.firstOffsetSeconds)} – {formatStreamOffset(group.lastOffsetSeconds)} into stream
          </span>
          <span aria-hidden="true">·</span>
          {/* Duration and per-broadcast coverage are day-scoped or absent in the
              catalogue, so they are disclosed as unavailable rather than inferred. */}
          <span
            className="moments-broadcast__stream-id"
            title="Broadcast duration and per-broadcast coverage are not supplied for stored days."
          >
            stream {group.streamId}
          </span>
        </p>
        <LoadedDetectionStrip group={group} selectedKey={selectedKey} />
        <p className="moments-muted">
          {showAll
            ? `Every one of the ${group.loadedCount.toLocaleString()} detections loaded for this broadcast, in stream order.`
            : ordering}
        </p>
      </header>
      <div className="moments-result-list">
        {rows.map(({ moment, rank, clipCandidate }) => (
          <MomentRow
            key={moment.key}
            moment={moment}
            rank={rank}
            clipCandidate={clipCandidate}
            selected={moment.key === selectedKey}
            artwork={resolveArtwork?.(moment)}
            onSelect={onSelect}
          />
        ))}
      </div>
      {ranking.remainder.length > 0 ? (
        <div className="moments-broadcast__more">
          <button
            type="button"
            aria-expanded={showAll}
            disabled={selectedHidden && showAll}
            onClick={() => setShown(value => Math.min(group.loadedCount, value + 20))}
          >
             {showAll ? 'All loaded detections shown' : `Show 20 more (${group.loadedCount - rows.length} remaining)`}
          </button>
          <p className="moments-muted">
             {showAll
               ? 'Already loaded — this disclosure requested nothing further.'
              : `${ranking.remainder.length.toLocaleString()} more are already loaded. Adjacent minutes of one reaction each count as a detection.`}
          </p>
        </div>
      ) : null}
    </section>
  )
}
