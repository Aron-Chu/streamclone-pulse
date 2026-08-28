import type { DeltaSessionSignal } from '../../signals/signalTypes.ts'
import { getVerifiedTransition } from '../../signals/motionEligibility.ts'
import { FlashStat } from './FlashStat.tsx'

function signedDelta(value: number): string {
  return `${value > 0 ? '+' : ''}${new Intl.NumberFormat('en-US').format(value)}`
}

export function DeltaChip({
  signal,
  motionEnabled,
  fromValue,
  isNew,
  selected = false,
  onSelect,
}: {
  signal: DeltaSessionSignal
  motionEnabled: boolean
  fromValue?: number
  isNew?: boolean
  selected?: boolean
  onSelect: (minuteTs: string) => void
}) {
  const transition = getVerifiedTransition(signal.previous, signal.current)
  const currentValue = signal.current.value
  if (currentValue === null || !Number.isFinite(currentValue)) return null

  return (
    <button
      type="button"
      className="session-signal-chip"
      data-selected={selected}
      aria-pressed={selected}
      onClick={() => onSelect(signal.minuteTs)}
    >
      <span className="session-signal-chip-label">{signal.label}</span>
      <FlashStat
        label={signal.label}
        value={currentValue}
        fromValue={fromValue}
        changed={transition !== null && fromValue !== undefined && fromValue !== currentValue}
        motionEnabled={motionEnabled}
        isNew={isNew}
      />
      {transition ? <span className="session-signal-delta">Δ {signedDelta(transition.delta)}</span> : null}
    </button>
  )
}
