import type { SignalValue } from './signalTypes'

export function isVerifiedSignalValue(value: SignalValue): boolean {
  return (
    (value.state === 'measured' || value.state === 'measured_zero')
    && typeof value.value === 'number'
    && Number.isFinite(value.value)
    && value.observedAt !== null
    && Number.isFinite(Date.parse(value.observedAt))
  )
}

export function getVerifiedTransition(
  previous: SignalValue,
  current: SignalValue,
): { fromValue: number; toValue: number; delta: number } | null {
  if (
    previous.metric !== current.metric
    || !isVerifiedSignalValue(previous)
    || !isVerifiedSignalValue(current)
  ) {
    return null
  }
  const previousValue = previous.value
  const currentValue = current.value
  if (previousValue === null || currentValue === null) return null

  return {
    fromValue: previousValue,
    toValue: currentValue,
    delta: currentValue - previousValue,
  }
}
