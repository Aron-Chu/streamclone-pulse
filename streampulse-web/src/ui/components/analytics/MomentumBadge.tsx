import { useId } from 'react'
import {
  deltaLabel,
  MOMENTUM_NO_SIGNAL_TITLE,
  MOMENTUM_TITLE,
} from './hubFormat'

export interface MomentumBadgeProps {
  pct: number | null | undefined
  /** When false, renders a neutral dash (backend trendSignal). Defaults true for legacy payloads. */
  hasSignal?: boolean
  /** BEM prefix, e.g. `figma-live-rail__trend` or `hub-tracked-table__trend-delta` */
  classPrefix: string
}

export function MomentumBadge({ pct, hasSignal = true, classPrefix }: MomentumBadgeProps) {
  const tipId = useId()

  if (!hasSignal) {
    return (
      <span
        className={`${classPrefix} ${classPrefix}--none`}
        title={MOMENTUM_NO_SIGNAL_TITLE}
        aria-describedby={tipId}
      >
        –
        <span id={tipId} className="sr-only">
          {MOMENTUM_NO_SIGNAL_TITLE}
        </span>
      </span>
    )
  }

  const { text, tone } = deltaLabel(pct)
  const cls =
    tone === 'up'
      ? `${classPrefix} ${classPrefix}--up`
      : tone === 'down'
        ? `${classPrefix} ${classPrefix}--down`
        : `${classPrefix} ${classPrefix}--flat`

  return (
    <span className={cls} title={MOMENTUM_TITLE} aria-describedby={tipId}>
      {text}
      <span id={tipId} className="sr-only">
        {MOMENTUM_TITLE}
      </span>
    </span>
  )
}

export function TrendWithCaption(props: Omit<MomentumBadgeProps, 'hasSignal'> & { hasSignal?: boolean }) {
  return <MomentumBadge {...props} />
}