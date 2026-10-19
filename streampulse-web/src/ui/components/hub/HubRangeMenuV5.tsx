/**
 * The activity window control: a segmented row of 30m / 24h / 7d (d3-v2
 * hub.html #win, AD-14). A long window that only the URL can ask for
 * (1mo / 3mo / 1 year) shows as a fourth, pressed button while it is active,
 * so the page never hides the window it is showing.
 */
import { HUB_URL_ONLY_WINDOWS, HUB_VISIBLE_WINDOWS } from '../../../lib/hubWindows'

export interface HubActivityRangeOption {
  key: string
  label: string
  /** Long form shown in the menu row and announced with the option. */
  description?: string
}

export interface HubActivityRangeControl {
  active: string
  options: HubActivityRangeOption[]
  onSelect: (key: string) => void
}

export interface HubWindowSegOption extends HubActivityRangeOption {
  pressed: boolean
  /** A URL-only long window, shown because it is the active one. */
  urlOnly: boolean
}

const DEFAULT_ACTIVE = '24h'

/** The buttons for a range control: the offered visible windows, plus the active URL-only one. */
export function hubWindowSegOptions(control: HubActivityRangeControl | null | undefined): HubWindowSegOption[] {
  const active = control?.active ?? DEFAULT_ACTIVE
  const offered: HubActivityRangeOption[] = control?.options ?? HUB_VISIBLE_WINDOWS.map(({ key, label }) => ({ key, label }))
  const out: HubWindowSegOption[] = []
  for (const visible of HUB_VISIBLE_WINDOWS) {
    const option = offered.find((candidate) => candidate.key === visible.key)
    if (option) out.push({ ...option, pressed: option.key === active, urlOnly: false })
  }
  if (!out.some((option) => option.pressed)) {
    const option = offered.find((candidate) => candidate.key === active)
      ?? HUB_URL_ONLY_WINDOWS.find((candidate) => candidate.key === active)
    if (option) out.push({ key: option.key, label: option.label, pressed: true, urlOnly: true })
  }
  return out
}

interface HubRangeMenuProps {
  control?: HubActivityRangeControl | null
  label?: string
}

export function HubRangeMenu({ control, label = 'Window' }: HubRangeMenuProps) {
  const options = hubWindowSegOptions(control)
  return (
    <div className="seg" role="group" aria-label={label} data-hub-window-seg="">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          data-hub-window={option.key}
          data-hub-window-url-only={option.urlOnly ? '' : undefined}
          aria-pressed={option.pressed}
          onClick={() => {
            if (!option.pressed) control?.onSelect(option.key)
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** The same control under its role name. */
export const HubWindowSeg = HubRangeMenu
