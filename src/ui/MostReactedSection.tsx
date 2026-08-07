import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  LIVE_HEAT_SUBTITLE,
  LIVE_HEAT_TITLE,
  type LiveHeatPoint,
} from '@streampulse/pulse-core'
import type { PulsePayload } from '../shared/messages.ts'
import { resolvePinnedChartSelection, chartPinPeakToleranceSeconds } from './chartSelectedMoment.ts'
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
  onAnalytics: (point: LiveHeatPoint) => void
  onHighlightOffset?: (offsetSeconds: number | null) => void
  onPinOffset?: (offsetSeconds: number | null) => void
  resolveJumpControl?: (point: LiveHeatPoint) => MomentJumpControl
  hasVodContext?: boolean
  demoMode?: boolean
}

export interface MomentJumpControl {
  label: string
  disabled?: boolean
  hint?: string
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
  onAnalytics,
  onHighlightOffset,
  onPinOffset,
  resolveJumpControl,
  hasVodContext = false,
  demoMode = false,
}: MostReactedSectionProps) {
  const heat = resolveMostReactedHeat(payload)
  const [sortMode, setSortMode] = useState<MomentSortMode>('reaction')
  const [hoveredOffset, setHoveredOffset] = useState<number | null>(null)
  const [listExpanded, setListExpanded] = useState(false)
  const selectedRowRef = useRef<HTMLDivElement | null>(null)
  const selectedCardRef = useRef<HTMLDivElement | null>(null)

  const sortedPoints = useMemo(
    () => sortLiveHeatPoints(heat.points, sortMode),
    [heat.points, sortMode],
  )

  const pinnedSelection = useMemo(() => {
    const rollups = (payload.fullRollups?.length ? payload.fullRollups : payload.rollups) ?? []
    const toleranceSeconds = chartPinPeakToleranceSeconds(rollups.length)
    return resolvePinnedChartSelection({
      pinOffsetSeconds: pinnedOffsetSeconds,
      heatPoints: heat.points,
      rollups,
      startedAt: payload.startedAt,
      toleranceSeconds,
    })
  }, [pinnedOffsetSeconds, heat.points, payload.fullRollups, payload.rollups, payload.startedAt])

  const pinnedDisplayPoint = pinnedSelection?.point ?? null

  const visiblePoints = listExpanded
    ? sortedPoints
    : sortedPoints.slice(0, MOST_REACTED_VISIBLE_COUNT)
  const hiddenPointCount = Math.max(0, sortedPoints.length - MOST_REACTED_VISIBLE_COUNT)
  const jumpLabel = resolveJumpLabel(payload, hasVodContext)
  const jumpControl = pinnedDisplayPoint && resolveJumpControl
    ? resolveJumpControl(pinnedDisplayPoint)
    : { label: jumpLabel }

  useEffect(() => {
    setListExpanded(false)
  }, [payload.streamId, sortMode])

  useEffect(() => {
    onHighlightOffset?.(hoveredOffset)
  }, [hoveredOffset, onHighlightOffset])

  useEffect(() => {
    if (pinnedOffsetSeconds == null) return
    const row = selectedRowRef.current
    if (!row) return
    const frame = requestAnimationFrame(() => {
      const panel = row.closest('.pulse-panel-body') as HTMLElement | null
      if (!panel) return
      const rowRect = row.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      if (rowRect.top < panelRect.top) {
        panel.scrollTop -= panelRect.top - rowRect.top
      } else if (rowRect.bottom > panelRect.bottom) {
        panel.scrollTop += rowRect.bottom - panelRect.bottom
      }
    })
    return () => cancelAnimationFrame(frame)
    // Only when the pin changes — not on sort/expand/poll re-renders (avoids random jumps).
  }, [pinnedOffsetSeconds])

  if (!heat.visible && !pinnedDisplayPoint) return null

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
      {pinnedOffsetSeconds != null && pinnedDisplayPoint ? (
        <div
          ref={selectedCardRef}
          style={{
            ...styles.selectedSlot,
            minHeight: 132,
          }}
        >
          <SelectedMomentCard
            point={pinnedDisplayPoint}
            backendUrl={backendUrl}
            jumpLabel={jumpControl.label}
            jumpDisabled={demoMode || jumpControl.disabled}
            jumpHint={jumpControl.hint}
            onJump={demoMode ? () => undefined : onJump}
            onAnalytics={demoMode ? () => undefined : onAnalytics}
          />
        </div>
      ) : null}
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
              scrollRef={selected ? node => { selectedRowRef.current = node } : undefined}
              onHighlight={demoMode ? () => undefined : setHoveredOffset}
              onSelect={demoMode ? () => undefined : next => {
                onPinOffset?.(next.offsetSeconds)
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
  selectedSlot: { flexShrink: 0 },
  momentList: { display: 'grid', gap: 4 },
  expandButton: {
    alignItems: 'center',
    background: 'transparent',
    border: 0,
    color: theme.accentText,
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
