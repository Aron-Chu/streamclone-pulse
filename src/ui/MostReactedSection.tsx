import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  type LiveHeatPoint,
} from '@streampulse/pulse-core'
import { reactionAnalyticalOffset } from '@streampulse/pulse-core'
import type { PulsePayload } from '../shared/messages.ts'
import { resolvePinnedMomentPoint } from './chartSelectedMoment.ts'
import {
  MOST_REACTED_VISIBLE_COUNT,
  resolveMostReactedHeat,
  sortLiveHeatPoints,
  type MomentSortMode,
} from './mostReacted.ts'
import { PulseMomentRow } from './PulseMomentRow.tsx'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { PulseThemedSelect } from './PulseThemedSelect.tsx'
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
  onPreviewMoment?: (point: LiveHeatPoint | null) => void
  onSelectMoment?: (point: LiveHeatPoint) => void
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
  onPreviewMoment,
  onSelectMoment,
  saveBusy = false,
  hasVodContext = false,
  demoMode = false,
}: MostReactedSectionProps) {
  const heat = resolveMostReactedHeat(payload)
  const [sortMode, setSortMode] = useState<MomentSortMode>('reaction')
  const [hoveredOffset, setHoveredOffset] = useState<number | null>(null)
  const [listExpanded, setListExpanded] = useState(false)
  const selectedRowRef = useRef<HTMLDivElement | null>(null)

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

  const visiblePoints = listExpanded
    ? sortedPoints
    : sortedPoints.slice(0, MOST_REACTED_VISIBLE_COUNT)
  const hiddenPointCount = Math.max(0, sortedPoints.length - MOST_REACTED_VISIBLE_COUNT)
  const jumpLabel = resolveJumpLabel(payload, hasVodContext)

  const isPinnedPoint = (point: LiveHeatPoint): boolean => {
    if (pinnedOffsetSeconds == null || !Number.isFinite(pinnedOffsetSeconds)) return false
    return reactionAnalyticalOffset(point) === pinnedOffsetSeconds
  }

  useEffect(() => {
    setListExpanded(false)
  }, [payload.streamId, sortMode])

  useEffect(() => {
    onHighlightOffset?.(hoveredOffset)
  }, [hoveredOffset, onHighlightOffset])

  useEffect(() => {
    if (pinnedOffsetSeconds == null) return
    const frame = requestAnimationFrame(() => {
      selectedRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    })
    return () => cancelAnimationFrame(frame)
  }, [pinnedOffsetSeconds, sortMode, listExpanded])

  if (!heat.visible && !pinnedMomentPoint) return null

  return (
    <PulseSectionCard
      title="Top moments"
      titleTone="muted"
      style={styles.sectionCard}
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
      <div style={styles.momentList}>
        {visiblePoints.map(point => {
          const selected = isPinnedPoint(point)
          return (
            <PulseMomentRow
              key={`${point.offsetSeconds}-${point.reason}-${point.minuteTs}`}
              point={point}
              backendUrl={backendUrl}
              selected={selected}
              scrollRef={selected ? node => { selectedRowRef.current = node } : undefined}
                onHighlight={demoMode ? () => undefined : offset => {
                  setHoveredOffset(offset)
                  onPreviewMoment?.(offset == null ? null : point)
                }}
               onSelect={demoMode ? () => undefined : next => {
                 if (onSelectMoment) onSelectMoment(next)
                 else onPinOffset?.(next.offsetSeconds)
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
  sectionCard: {
    gap: 8,
    marginBottom: 12,
    padding: 12,
  },
  momentList: { display: 'grid', gap: 4 },
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
