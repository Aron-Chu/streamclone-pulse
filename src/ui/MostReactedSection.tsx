import { useEffect, useId, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  LIVE_HEAT_MIN_COMPLETED_ROLLUPS,
  reactionAnalyticalOffset,
  type LiveHeatPoint,
} from '@streampulse/pulse-core'
import type { PulsePayload } from '../shared/messages.ts'
import type { ExtensionRollup } from '../shared/messages.ts'
import { resolvePinnedMomentPoint } from './chartSelectedMoment.ts'
import {
  MOST_REACTED_VISIBLE_COUNT,
  liveHeatPointKey,
  resolveMostReactedHeat,
  sortLiveHeatPoints,
  type MomentSortMode,
} from './mostReacted.ts'
import { PulseMomentRow, momentRowKey } from './PulseMomentRow.tsx'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { PulseThemedSelect } from './PulseThemedSelect.tsx'
import { TopMomentCard } from './TopMomentCard.tsx'
import { theme } from './theme.ts'

export interface MostReactedSectionProps {
  payload: PulsePayload
  backendUrl: string
  sidebarFill?: boolean
  pinnedOffsetSeconds?: number | null
  chartMinuteSelection?: ExtensionRollup | null
  onJump: (point: LiveHeatPoint) => void
  onJumpToOffset?: (offsetSeconds: number) => void
  onAnalytics: (point: LiveHeatPoint) => void
  onAnalyticsAtOffset?: (offsetSeconds: number) => void
  onHighlightOffset?: (offsetSeconds: number | null) => void
  /**
   * Pins a moment, or clears the pin. The pinned moment, picked here or as a
   * ranked moment on the chart, opens the card above the list; picking its
   * row again clears the pin.
   */
  onPinOffset?: (offsetSeconds: number | null) => void
  hasVodContext?: boolean
  demoMode?: boolean
}

const SORT_OPTIONS: ReadonlyArray<{ value: MomentSortMode; label: string }> = [
  { value: 'reaction', label: 'Strongest reaction' },
  { value: 'chat', label: 'Chat activity' },
  { value: 'emotes', label: 'Emote activity' },
]

const TOP_MOMENTS_TITLE = 'Top moments'
const TOP_MOMENTS_SUBTITLE = 'Chat and emote spikes'

function resolveJumpLabel(payload: PulsePayload, hasVodContext?: boolean): string {
  if (hasVodContext || payload.vodId) return 'Jump in VOD'
  return 'Jump in player'
}

export function MostReactedSection({
  payload,
  backendUrl,
  pinnedOffsetSeconds = null,
  onJumpToOffset,
  onAnalyticsAtOffset,
  onHighlightOffset,
  onPinOffset,
  hasVodContext = false,
  demoMode = false,
}: MostReactedSectionProps) {
  const heat = resolveMostReactedHeat(payload)
  const [sortMode, setSortMode] = useState<MomentSortMode>('reaction')
  const [listExpanded, setListExpanded] = useState(false)
  const cardId = useId()

  const sortedPoints = useMemo(
    () => sortLiveHeatPoints(heat.points, sortMode),
    [heat.points, sortMode],
  )

  const pinnedMomentPoint = useMemo(
    () =>
      resolvePinnedMomentPoint({
        pinOffsetSeconds: pinnedOffsetSeconds,
        heatPoints: heat.points,
      }),
    [pinnedOffsetSeconds, heat.points],
  )
  const pinnedMomentKey = pinnedMomentPoint
    ? liveHeatPointKey(payload.streamId, pinnedMomentPoint)
    : null

  // Collapsed, a picked row that ranks past the fold (a poll can push it
  // there) stays listed at the end, so its row and its focus stay.
  const visiblePoints = listExpanded
    ? sortedPoints
    : sortedPoints.filter((point, index) => index < MOST_REACTED_VISIBLE_COUNT
      || liveHeatPointKey(payload.streamId, point) === pinnedMomentKey)
  // The card above the list shows only a picked moment.
  const cardPoint = demoMode ? null : pinnedMomentPoint
  const hiddenPointCount = sortedPoints.length - visiblePoints.length
  const hasExplicitPeaks = payload.peaks !== undefined
  const isCollectingMoments = hasExplicitPeaks && (
    (payload.peaks?.length ?? 0) === 0
    || (heat.points.length === 0 && heat.completedRollupCount < LIVE_HEAT_MIN_COMPLETED_ROLLUPS)
  )

  useEffect(() => {
    setListExpanded(false)
    onHighlightOffset?.(null)
  }, [onHighlightOffset, payload.streamId, sortMode])

  const handleHighlight = (offsetSeconds: number | null): void => {
    onHighlightOffset?.(offsetSeconds)
  }

  return (
    <PulseSectionCard
      title={TOP_MOMENTS_TITLE}
      subtitle={TOP_MOMENTS_SUBTITLE}
      stackMeta
      meta={
        heat.visible ? (
          <>
            <span data-most-reacted-count="true" style={styles.momentCount}>
              {heat.points.length} moment{heat.points.length === 1 ? '' : 's'}
            </span>
            <PulseThemedSelect
              label="Sort"
              value={sortMode}
              options={SORT_OPTIONS}
              ariaLabel="Sort most reacted moments"
              disabled={demoMode}
              onChange={setSortMode}
            />
          </>
        ) : undefined
      }
    >
      {!heat.visible && !pinnedMomentPoint ? (
        <div
          data-testid="most-reacted-status"
          data-most-reacted-state={isCollectingMoments ? 'collecting' : 'empty'}
          role="status"
          style={styles.status}
        >
          <strong style={styles.statusTitle}>
            {isCollectingMoments ? 'Collecting reaction moments' : 'No reaction moments yet'}
          </strong>
          <span style={styles.statusText}>
            {isCollectingMoments
              ? `Top moments appear after enough chat and emote rollups are complete. ${heat.completedRollupCount} completed minute${heat.completedRollupCount === 1 ? '' : 's'} recorded.`
              : 'There are no qualifying chat or emote moments in this stream yet.'}
          </span>
        </div>
      ) : null}
      {/*
        The card, the list and its Show more control share one grid child, so
        the card's slot never adds or drops a grid gap, and a row that leaves
        the list hands focus on to Show more (PulseMomentRow).
      */}
      <div>
        <TopMomentCard
          id={cardId}
          point={cardPoint}
          backendUrl={backendUrl}
          jumpLabel={resolveJumpLabel(payload, hasVodContext)}
          onJump={next => onJumpToOffset?.(reactionAnalyticalOffset(next))}
          onAnalytics={next => onAnalyticsAtOffset?.(reactionAnalyticalOffset(next))}
          onClear={() => onPinOffset?.(null)}
        />
        <div style={styles.momentList}>
          {visiblePoints.map(point => {
            const selected =
              pinnedMomentKey != null && liveHeatPointKey(payload.streamId, point) === pinnedMomentKey
            return (
              <PulseMomentRow
                // Stable while the backend refines the moment, so its row (and
                // its focus) stays mounted through a poll.
                key={momentRowKey(point, heat.points)}
                point={point}
                backendUrl={backendUrl}
                selected={selected}
                controls={cardPoint ? cardId : undefined}
                onHighlight={demoMode ? () => undefined : handleHighlight}
                // Picking the picked row again closes its card.
                onSelect={demoMode ? () => undefined : next => {
                  onPinOffset?.(selected ? null : reactionAnalyticalOffset(next))
                }}
              />
            )
          })}
          {heat.collectingPoint ? (
            <PulseMomentRow
              point={heat.collectingPoint}
              backendUrl={backendUrl}
              selected={false}
              onHighlight={() => {}}
              onSelect={() => {}}
            />
          ) : null}
        </div>
        {listExpanded || hiddenPointCount > 0 ? (
          <button
            type="button"
            style={styles.expandButton}
            disabled={demoMode}
            data-chart-action="true"
            data-most-reacted-expand="true"
            aria-expanded={listExpanded}
            onClick={demoMode ? undefined : () => setListExpanded(expanded => !expanded)}
          >
            <span>
              {listExpanded
                ? 'Show less'
                : `Show ${hiddenPointCount} more moment${hiddenPointCount === 1 ? '' : 's'}`}
            </span>
            <span style={styles.expandChevron} aria-hidden="true">
              {listExpanded ? '▾' : '▸'}
            </span>
          </button>
        ) : null}
      </div>
    </PulseSectionCard>
  )
}

const styles: Record<string, CSSProperties> = {
  momentCount: { color: theme.textMuted, fontSize: 9, fontVariantNumeric: 'tabular-nums', marginRight: 6 },
  momentList: { display: 'grid', gap: 4 },
  status: {
    background: 'rgba(255, 255, 255, 0.035)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    display: 'grid',
    gap: 4,
    padding: '10px 12px',
  },
  statusTitle: { color: theme.textSecondary, fontSize: 11, fontWeight: 800 },
  statusText: { color: theme.textMuted, fontSize: 10, lineHeight: 1.4 },
  expandButton: {
    alignItems: 'center',
    background: 'transparent',
    border: 0,
    color: theme.accentSoft,
    cursor: 'pointer',
    display: 'flex',
    fontSize: 10,
    fontWeight: 700,
    gap: 4,
    // The section's 12 px grid gap, plus its own 2 px.
    marginTop: 14,
    padding: '4px 0',
    width: '100%',
  },
  expandChevron: { fontSize: 9, lineHeight: 1 },
}
