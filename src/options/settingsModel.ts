import {
  DEFAULT_AUTO_TRACK_POLICY,
  DEFAULT_AUTO_UPDATE_ENABLED,
  DEFAULT_BACKEND_URL,
  DEFAULT_DEFAULT_CHART_WINDOW,
  DEFAULT_KEEP_LOCAL_CACHE,
  DEFAULT_OVERLAY_PLACEMENT,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_THEME_PREFERENCE,
  type AutoTrackPolicy,
  type DefaultChartWindow,
  type OverlayPlacement,
  type ThemePreference,
} from '../shared/storage.ts'

export interface SettingsForm {
  backendUrl: string
  theme: ThemePreference
  chartWindow: DefaultChartWindow
  autoUpdate: boolean
  pollMs: number
  autoTrack: AutoTrackPolicy
  placement: OverlayPlacement
  show7tvLabels: boolean
  keepCache: boolean
}

export const DEFAULT_FORM: SettingsForm = {
  backendUrl: DEFAULT_BACKEND_URL,
  theme: DEFAULT_THEME_PREFERENCE,
  chartWindow: DEFAULT_DEFAULT_CHART_WINDOW,
  autoUpdate: DEFAULT_AUTO_UPDATE_ENABLED,
  pollMs: DEFAULT_POLL_INTERVAL_MS,
  autoTrack: DEFAULT_AUTO_TRACK_POLICY,
  placement: DEFAULT_OVERLAY_PLACEMENT,
  show7tvLabels: true,
  keepCache: DEFAULT_KEEP_LOCAL_CACHE,
}

/** Approximate cap used to render the cache-usage progress bar. */
export const CACHE_BAR_LIMIT = 12

/** Dirty-tracking comparison: every persisted field must match. */
export function formsEqual(a: SettingsForm, b: SettingsForm): boolean {
  return (
    a.backendUrl === b.backendUrl &&
    a.theme === b.theme &&
    a.chartWindow === b.chartWindow &&
    a.autoUpdate === b.autoUpdate &&
    a.pollMs === b.pollMs &&
    a.autoTrack === b.autoTrack &&
    a.placement === b.placement &&
    a.show7tvLabels === b.show7tvLabels &&
    a.keepCache === b.keepCache
  )
}

/** Compact, human label for the polling slider chip (e.g. "1m 30s"). */
export function formatPollDisplay(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`
}

/** Spoken value for the slider's aria-valuetext. */
export function formatPollAria(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} seconds`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem === 0
    ? `${m} minute${m === 1 ? '' : 's'}`
    : `${m} minute${m === 1 ? '' : 's'} ${rem} seconds`
}

export function backendHost(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url.replace(/^https?:\/\//, '') || 'api.streampulse.stream'
  }
}
