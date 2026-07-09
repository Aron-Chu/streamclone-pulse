import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  LIVE_HEAT_SUBTITLE,
  LIVE_HEAT_TITLE,
  extensionRollupsForDerivation,
  type LiveHeatPoint,
} from '@streampulse/pulse-core'
import type { ExtensionRollup, PulsePayload } from '../shared/messages.ts'
import {
  hasFullTimelineRollups,
  prepareChartRollups,
  resolvePayloadCoverageStartOffset,
} from './chatActivityEmotes.ts'
import { downsampleRollupsForChart } from './extensionChartPoints.ts'
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
  const rollups = extensionRollupsForDerivation(payload) as ExtensionRollup[]
  const chartRollups = useMemo(
    () =>
      downsampleRollupsForChart(
        prepareChartRollups(payload, {
          chartWindow: hasFullTimelineRollups(payload) ? 'full' : '60m',
          currentOffsetSeconds: Math.max(0, payload.currentOffsetSeconds ?? 0),
          coverageStartOffsetSeconds: resolvePayloadCoverageStartOffset(payload),
        }),
      ),
    [payload],
  )
  const [sortMode, setSortMode] = useState<MomentSortMode>('reaction')
  const [hoveredOffset, setHoveredOffset] = useState<number | null>(null)
  const [listExpanded, setListExpanded] = useState(false)
  const selectedRowRef = useRef<HTMLDivElement | null>(null)
  const selectedCardRef = useRef<HTMLDivElement | null>(null)

  const sortedPoints = useMemo(
    () => sortLiveHeatPoints(heat.points, sortMode),
    [heat.points, sortMode],
  )

  const pinnedMomentPoint = useMemo(
    () =>
      resolvePinnedMomentPoint({
        pinOffsetSeconds: pinnedOffsetSeconds,
        heatPoints: heat.points,
        rollups,
        chartRollups,
        startedAt: payload.startedAt,
        catalog: payload.topEmotes,
      }),
    [pinnedOffsetSeconds, heat.points, rollups, chartRollups, payload.startedAt, payload.topEmotes],
  )

  const visiblePoints = listExpanded
    ? sortedPoints
    : sortedPoints.slice(0, MOST_REACTED_VISIBLE_COUNT)
  const hiddenPointCount = Math.max(0, sortedPoints.length - MOST_REACTED_VISIBLE_COUNT)
  const jumpLabel = resolveJumpLabel(payload, hasVodContext)

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
      {pinnedOffsetSeconds != null && pinnedMomentPoint ? (
        <div
          ref={selectedCardRef}
          style={{
            ...styles.selectedSlot,
            minHeight: 132,
          }}
        >
          <SelectedMomentCard
            point={pinnedMomentPoint}
            backendUrl={backendUrl}
            jumpLabel={jumpLabel}
            onJump={demoMode ? () => undefined : onJump}
            onSave={demoMode ? () => undefined : onSave}
            saveBusy={saveBusy}
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
