/**
 * Page-only copy for the detailed preference pickers.
 *
 * Deliberately kept out of `ui/overlayTheme.ts` and `ui/preferenceOptions.ts`:
 * the Twitch content script imports those, and its compact pickers never render
 * a description, so these strings would be dead weight in the bundle with the
 * least headroom. Still one source of truth — only the surfaces that actually
 * show descriptions import it.
 */
import type { ChoiceOption, ChoicePickerKind } from '../ui/ChoicePicker.tsx'

const DESCRIPTIONS: Record<ChoicePickerKind, Record<string, string>> = {
  accent: {
    aurora: 'Purple pulse',
    volt: 'Warm orange',
    emerald: 'Fresh green',
    azure: 'Cool blue',
  },
  density: {
    comfortable: 'Standard spacing and typography',
    compact: 'Tight spacing and rows',
  },
  placement: {
    sidebar: 'Inside chat',
    right: 'Floating right',
    bottom: 'Floating below',
  },
}

/** Attach descriptions by value. A value with no entry simply renders none. */
export function withDescriptions<T extends string>(
  kind: ChoicePickerKind,
  options: ReadonlyArray<ChoiceOption<T>>,
): ReadonlyArray<ChoiceOption<T>> {
  const table = DESCRIPTIONS[kind]
  return options.map(option => {
    const description = table[option.value]
    return description ? { ...option, description } : option
  })
}
