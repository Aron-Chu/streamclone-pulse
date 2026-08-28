import { useEffect, useMemo, useRef } from 'react'
import { useConsoleMotion } from '../../hooks/useConsoleMotion.ts'
import type {
  EventSessionSignal,
  PeakSessionSignal,
  SessionSignal,
} from '../../signals/signalTypes.ts'
import { DeltaChip } from './DeltaChip.tsx'
import { FlashStat } from './FlashStat.tsx'
import { TickerTape } from './TickerTape.tsx'

function eventOrder(left: EventSessionSignal, right: EventSessionSignal): number {
  return left.minuteTs.localeCompare(right.minuteTs) || left.id.localeCompare(right.id)
}

function selectedEvent(events: EventSessionSignal[], minuteTs: string | null | undefined): string | null {
  if (!minuteTs) return null
  return events
    .filter(event => event.minuteTs === minuteTs)
    .sort((left, right) => {
      const kindPriority = (event: EventSessionSignal) => event.kind === 'peak' ? 0 : 1
      return kindPriority(left) - kindPriority(right) || left.id.localeCompare(right.id)
    })[0]?.id ?? null
}

function PeakChip({
  signal,
  selected,
  motionEnabled,
  onSelect,
}: {
  signal: PeakSessionSignal
  selected: boolean
  motionEnabled: boolean
  onSelect: (minuteTs: string) => void
}) {
  const value = signal.current.value
  if (value === null || !Number.isFinite(value)) return null
  return (
    <button
      type="button"
      className="session-signal-chip session-signal-peak"
      data-selected={selected}
      aria-pressed={selected}
      onClick={() => onSelect(signal.minuteTs)}
    >
      <span className="session-signal-chip-label">{signal.label}</span>
      <FlashStat label={signal.label} value={value} changed={false} motionEnabled={motionEnabled} />
    </button>
  )
}

export function SessionSignalTape({
  signals,
  selectedMinuteTs,
  onSelectMinute,
  autoScroll = 'overflow',
  overflowing = false,
}: {
  signals: SessionSignal[]
  selectedMinuteTs?: string | null
  onSelectMinute: (minuteTs: string) => void
  autoScroll?: 'off' | 'overflow'
  overflowing?: boolean
}) {
  const { motionEnabled } = useConsoleMotion()
  const renderedValues = useRef(new Map<string, number>())
  const hydrated = useRef(false)
  const coverage = signals.find(signal => signal.kind === 'coverage')
  const events = useMemo(
    () => signals.filter((signal): signal is EventSessionSignal => signal.kind !== 'coverage').sort(eventOrder),
    [signals],
  )
  const selectedId = selectedEvent(events, selectedMinuteTs)

  useEffect(() => {
    for (const event of events) {
      if (event.current.value !== null && Number.isFinite(event.current.value)) {
        renderedValues.current.set(event.id, event.current.value)
      }
    }
    hydrated.current = true
  }, [events])

  if (signals.length === 0) return null

  const eventItems = events.map(event => {
    const priorValue = renderedValues.current.get(event.id)
    const isNew = hydrated.current && priorValue === undefined
    if (event.kind === 'peak') {
      return (
        <PeakChip
          key={event.id}
          signal={event}
          selected={event.id === selectedId}
          motionEnabled={motionEnabled}
          onSelect={onSelectMinute}
        />
      )
    }
    return (
      <DeltaChip
        key={event.id}
        signal={event}
        selected={event.id === selectedId}
        motionEnabled={motionEnabled}
        fromValue={priorValue}
        isNew={isNew}
        onSelect={onSelectMinute}
      />
    )
  })

  return (
    <section className="session-signal-tape" aria-label="Session signals">
      {coverage ? (
        <div className={`session-signal-coverage is-${coverage.state}`}>
          <span>{coverage.label}</span>
          {coverage.detail ? <span>{coverage.detail}</span> : null}
        </div>
      ) : null}
      {eventItems.length > 0 ? (
        <TickerTape
          itemIds={events.map(event => event.id)}
          motionEnabled={motionEnabled}
          overflowing={overflowing}
          autoScroll={autoScroll}
        >
          {eventItems}
        </TickerTape>
      ) : null}
    </section>
  )
}
