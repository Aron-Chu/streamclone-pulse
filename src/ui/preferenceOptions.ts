/**
 * Canonical option lists for the preference pickers.
 *
 * These were previously duplicated in `PulseSettingsPanel` (overlay) and
 * `SettingsWorkspace` (full page), which let the two surfaces drift: the same
 * placement value was labelled "Right" in one and "Right dock" in the other,
 * and accent/placement descriptions were nested ternaries that silently fell
 * through for any new value. One list per preference, one set of copy.
 *
 * Accent options live in `overlayTheme.ts` beside their palettes so a swatch
 * cannot drift from the accent it represents.
 */
import type { DefaultChartWindow, DensityPreference, OverlayPlacement } from '../shared/storage.ts'
import type { ChoiceOption } from './ChoicePicker.tsx'

export const PLACEMENT_OPTIONS: ReadonlyArray<ChoiceOption<OverlayPlacement>> = [
  { value: 'sidebar', label: 'Sidebar' },
  { value: 'right', label: 'Right dock' },
  { value: 'bottom', label: 'Bottom dock' },
]

export const DENSITY_OPTIONS: ReadonlyArray<ChoiceOption<DensityPreference>> = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
]

export const CHART_WINDOW_OPTIONS: ReadonlyArray<{ value: DefaultChartWindow; label: string }> = [
  { value: '15m', label: '15 minutes' },
  { value: '30m', label: '30 minutes' },
  { value: '60m', label: '1 hour' },
  { value: '2h', label: '2 hours' },
  { value: '4h', label: '4 hours' },
  { value: 'full', label: 'Full stream' },
]
