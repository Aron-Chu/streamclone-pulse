import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  LIVE_HEAT_SUBTITLE,
  LIVE_HEAT_TITLE,
  reactionAnalyticalOffset,
  type LiveHeatPoint,
} from '@streampulse/pulse-core'
import type { PulsePayload } from '../shared/messages.ts'
import { resolvePinnedMomentPoint } from './chartSelectedMoment.ts'
import {
  MOST_REACTED_VISIBLE_COUNT,
  heatPointMatchesOffset,
  resolveMostReactedHeat,
  sortLiveHeatPoints,
  type MomentSortMode,
} from './mostReacted.ts'
import { PulseMomentRow } from './PulseMomentRow.tsx'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { PulseThemedSelect } from './PulseThemedSelect.tsx'
import { SelectedMomentCard } from './SelectedMomentCard.tsx'
import { theme } from './theme.ts'

export interface MostReactedSectionProps {
  payload: PulsePayload
  backendUrl: string
  sidebarFill?: boolean
  pinnedOffsetSeconds?: number | null
  onJump: (point: LiveHeatPoint) => void
  onSave: (point: LiveHeatPoint) => void | Promise<void>
  onAnalytics: (point: LiveHeatPoint) => void
  onHighlightOffset?: (offsetSeconds: number | null) => void
  onPinOffset?: (offsetSeconds: number | null) => void
  saveBusy?: boolean
  hasVodContext?: boolean
  demoMode?: boolean
}

const SORT_OPTIONS: ReadonlyArray<{ value: MomentSortMode; label: string }> = [
  { value: 'reaction', label: 'Strongest reaction' },
  { value: 'chat', label: 'Chat activity' },
  { value: 'emotes', label: 'Emote activity' },
]

function resolveJumpLabel(payload: PulsePayload, hasVodContext?: boolean): string {
  if (hasVodContext || payload.vodId) return 'Jump in VOD'
  return 'Jump in player'
}

export function MostReactedSection({
  payload,
  backendUrl,
  sidebarFill: _sidebarFill = false,
  pinnedOffsetSeconds = null,
  onJump,
  onSave,
  onAnalytics,
  onHighlightOffset,
  onPinOffset,
  saveBusy = false,
  hasVodContext = false,
  demoMode = false,
}: MostReactedSectionProps) {
  const heat = resolveMostReactedHeat(payload)
  const [sortMode, setSortMode] = useState<MomentSortMode>('reaction')
  const [hoveredOffset, setHoveredOffset] = useState<number | null>(null)
  const [listExpanded, setListExpanded] = useState(false)

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
  const hoveredMomentPoint = useMemo(
    () =>
      resolvePinnedMomentPoint({
        pinOffsetSeconds: hoveredOffset,
        heatPoints: heat.points,
      }),
    [hoveredOffset, heat.points],
  )
  const inspectionPoint = hoveredMomentPoint ?? pinnedMomentPoint
  const inspectionState = hoveredMomentPoint ? 'preview' : pinnedMomentPoint ? 'active' : 'idle'

  const visiblePoints = listExpanded
    ? sortedPoints
    : sortedPoints.slice(0, MOST_REACTED_VISIBLE_COUNT)
  const hiddenPointCount = Math.max(0, sortedPoints.length - MOST_REACTED_VISIBLE_COUNT)
  const jumpLabel = resolveJumpLabel(payload, hasVodContext)
  const hasExplicitPeaks = payload.peaks !== undefined
  const isCollectingMoments = hasExplicitPeaks && (payload.peaks?.length ?? 0) === 0

  useEffect(() => {
    setListExpanded(false)
  }, [payload.streamId, sortMode])

  useEffect(() => {
    onHighlightOffset?.(hoveredOffset)
  }, [hoveredOffset, onHighlightOffset])

  return (
    <PulseSectionCard
      title={LIVE_HEAT_TITLE}
      subtitle={LIVE_HEAT_SUBTITLE}
      meta={
        heat.visible ? (
          <PulseThemedSelect
            label="Sort"
            value={sortMode}
            options={SORT_OPTIONS}
            ariaLabel="Sort most reacted moments"
            disabled={demoMode}
            onChange={setSortMode}
          />
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
      <div
        data-selected-minute-slot="true"
        data-inspection-tray-state={inspectionState}
        aria-live="polite"
        style={styles.selectedSlot}
      >
        {inspectionPoint ? (
          <SelectedMomentCard
            point={inspectionPoint}
            backendUrl={backendUrl}
            compact
            jumpLabel={jumpLabel}
            onJump={demoMode ? () => undefined : onJump}
            onSave={demoMode ? () => undefined : onSave}
            saveBusy={saveBusy}
            onAnalytics={demoMode ? () => undefined : onAnalytics}
            onClear={demoMode || !pinnedMomentPoint ? undefined : () => onPinOffset?.(null)}
          />
        ) : (
          <div style={styles.idleSlot}>
            <span style={styles.idleTitle}>Moment inspector</span>
            <span style={styles.idleText}>Hover to preview · click to lock a moment</span>
          </div>
        )}
      </div>
      <div style={styles.momentList}>
        {visiblePoints.map(point => {
          const selected =
            pinnedOffsetSeconds != null && heatPointMatchesOffset(point, pinnedOffsetSeconds)
          return (
            <PulseMomentRow
              key={`${point.offsetSeconds}-${point.reason}-${point.minuteTs}`}
              point={point}
              backendUrl={backendUrl}
              selected={selected}
              onHighlight={demoMode ? () => undefined : setHoveredOffset}
              onSelect={demoMode ? () => undefined : next => {
                onPinOffset?.(selected ? null : reactionAnalyticalOffset(next))
                setHoveredOffset(null)
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
      {hiddenPointCount > 0 ? (
        <button
          type="button"
          style={styles.expandButton}
          disabled={demoMode}
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
    </PulseSectionCard>
  )
}

const styles: Record<string, CSSProperties> = {
  selectedSlot: {
    contain: 'layout',
    flexShrink: 0,
    height: 78,
    marginBottom: 6,
    minHeight: 78,
    minWidth: 0,
    overflow: 'hidden',
  },
  idleSlot: {
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.018)',
    border: '1px solid rgba(255, 255, 255, 0.07)',
    borderRadius: 8,
    boxSizing: 'border-box',
    display: 'flex',
    gap: 6,
    height: 72,
    justifyContent: 'center',
    padding: '7px 10px',
    width: '100%',
  },
  idleTitle: {
    color: theme.textSecondary,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  idleText: { color: theme.textMuted, fontSize: 9, fontWeight: 600 },
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
    marginTop: 2,
    padding: '4px 0',
  },
  expandChevron: { fontSize: 9, lineHeight: 1 },
}
