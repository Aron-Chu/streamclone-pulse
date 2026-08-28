import { useEffect, useRef, useState } from 'react'

function formatValue(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

export function FlashStat({
  label,
  value,
  fromValue,
  changed,
  motionEnabled,
  isNew = false,
}: {
  label: string
  value: number
  fromValue?: number
  changed: boolean
  motionEnabled: boolean
  isNew?: boolean
}) {
  const canTween = (
    motionEnabled
    && changed
    && Number.isFinite(fromValue)
    && Number.isFinite(value)
    && fromValue !== value
  )
  const [displayValue, setDisplayValue] = useState(value)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    if (!canTween || fromValue === undefined) {
      setDisplayValue(value)
      return
    }

    const startedAt = performance.now()
    const duration = 260
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration)
      setDisplayValue(fromValue + (value - fromValue) * progress)
      if (progress < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [canTween, fromValue, value])

  return (
    <span
      className={isNew && motionEnabled ? 'session-signal-flash is-new' : 'session-signal-flash'}
      aria-label={`${label}: ${formatValue(value)}`}
      data-testid="flash-stat"
      data-tweening={canTween}
      data-from-value={canTween ? fromValue : undefined}
    >
      {formatValue(displayValue)}
    </span>
  )
}
