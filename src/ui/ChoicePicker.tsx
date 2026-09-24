import type { ReactNode } from 'react'

/**
 * One implementation of the segmented preference pickers.
 *
 * The overlay settings tab and the full-page settings workspace previously each
 * had their own markup, class names and option copy for accent, density and
 * placement. That is why the two surfaces drifted out of theme: they were two
 * designs of the same control. Both now render this component and differ only
 * by `variant`, which selects the existing compact (Twitch rail) or detailed
 * (full page) class families. No new CSS is introduced.
 */
export type ChoicePickerKind = 'accent' | 'density' | 'placement'
export type ChoicePickerVariant = 'compact' | 'detailed'

export interface ChoiceOption<T extends string> {
  value: T
  label: string
  /** Shown only in the detailed variant, where there is room for it. */
  description?: string
  swatch?: string
  icon?: ReactNode
}

export function ChoicePicker<T extends string>({
  kind,
  variant,
  groupLabel,
  options,
  value,
  onChange,
}: {
  kind: ChoicePickerKind
  variant: ChoicePickerVariant
  groupLabel: string
  options: ReadonlyArray<ChoiceOption<T>>
  value: T
  onChange: (next: T) => void
}) {
  const detailed = variant === 'detailed'
  const gridClass = detailed ? 'pulse-settings-choice-grid' : `pulse-${kind}-picker`
  const choiceClass = detailed ? 'pulse-settings-choice-card' : `pulse-${kind}-choice`
  const activeClass = detailed ? 'pulse-settings-choice-card-active' : `pulse-${kind}-choice-active`
  const swatchClass = detailed ? 'pulse-settings-choice-swatch' : 'pulse-accent-swatch'

  return (
    <div className={gridClass} role="group" aria-label={groupLabel}>
      {options.map(option => {
        const active = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            className={active ? `${choiceClass} ${activeClass}` : choiceClass}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            {option.swatch
              ? <span className={swatchClass} style={{ background: option.swatch }} aria-hidden="true" />
              : null}
            {option.icon ?? null}
            {detailed
              ? (
                  <span>
                    <strong>{option.label}</strong>
                    {option.description ? <small>{option.description}</small> : null}
                  </span>
                )
              : option.label}
            {!detailed && active
              ? <span className="pulse-choice-check" aria-hidden="true">✓</span>
              : null}
          </button>
        )
      })}
    </div>
  )
}
