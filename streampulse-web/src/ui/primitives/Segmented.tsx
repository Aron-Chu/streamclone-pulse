import { useRef } from 'react'
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  count?: number
  'aria-label'?: string
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onValueChange: (value: T) => void
  'aria-label': string
  className?: string
}

export function Segmented<T extends string>({
  options,
  value,
  onValueChange,
  className,
  'aria-label': ariaLabel,
}: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function focusAt(index: number) {
    const clamped = (index + options.length) % options.length
    const next = options[clamped]
    if (!next) return
    onValueChange(next.value)
    refs.current[clamped]?.focus()
  }

  return (
    <div className={cn('sc-segmented', className)} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option['aria-label']}
            tabIndex={selected ? 0 : -1}
            className="sc-segmented__item"
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault()
                focusAt(index + 1)
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault()
                focusAt(index - 1)
              } else if (event.key === 'Home') {
                event.preventDefault()
                focusAt(0)
              } else if (event.key === 'End') {
                event.preventDefault()
                focusAt(options.length - 1)
              }
            }}
          >
            <span>{option.label}</span>
            {typeof option.count === 'number' ? (
              <span className="sc-segmented__count sc-tnum">{option.count}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
