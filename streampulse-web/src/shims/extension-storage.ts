/** Landing-page stub for extension storage helpers (no chrome.storage on the portal). */

export type OverlayMode = 'collapsed' | 'mini' | 'expanded'
export type OverlayPlacement = 'bottom' | 'right' | 'sidebar' | 'hidden'
export type SidebarTab = 'chat' | 'pulse'
export type AutoTrackPolicy = 'off' | 'followed' | 'ask'
export type ThemePreference = 'aurora' | 'volt' | 'azure'
export type ReduceMotionPreference = 'system' | 'on' | 'off'
export type DefaultChartWindow = '15m' | '30m' | '60m' | '2h' | '4h' | 'full'

export const REDUCE_MOTION_PREFERENCE_KEY = 'reduceMotionPreference'

export const DEFAULT_BACKEND_URL = 'https://api.streampulse.stream'
export const DEFAULT_POLL_INTERVAL_MS = 30_000
export const DEFAULT_AUTO_UPDATE_ENABLED = true
export const DEFAULT_OVERLAY_MODE: OverlayMode = 'expanded'
export const DEFAULT_OVERLAY_PLACEMENT: OverlayPlacement = 'sidebar'
export const DEFAULT_SIDEBAR_TAB: SidebarTab = 'pulse'
export const DEFAULT_REDUCE_MOTION_PREFERENCE: ReduceMotionPreference = 'system'
export const DEFAULT_DEFAULT_CHART_WINDOW: DefaultChartWindow = 'full'

export function isLocalStackBackendUrl(url: string): boolean {
  const normalized = url.trim().replace(/\/+$/, '')
  if (!normalized) return false
  if (normalized.toLowerCase().includes('laptopworker')) return true
  try {
    const parsed = new URL(normalized)
    const host = parsed.hostname.toLowerCase()
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
    const localStackPort = `${809}${0}`
    return (host === 'localhost' || host === '127.0.0.1') && port === localStackPort
  } catch {
    return false
  }
}

export function isHostedBackendUrl(url: string): boolean {
  return !isLocalStackBackendUrl(url)
}

export async function getDefaultChartWindow(): Promise<DefaultChartWindow> {
  return DEFAULT_DEFAULT_CHART_WINDOW
}

/** Portal shim — no chrome.storage; LiveStatsBand calls this on mount. */
export async function migrateDefaultChartWindowToFullOnce(): Promise<void> {
  /* no-op */
}

export async function getBackendUrl(): Promise<string> {
  return DEFAULT_BACKEND_URL
}

/** Portal has no extension runtime — always treat storage as unavailable. */
export function isExtensionContextAlive(): boolean {
  return false
}

export async function getBetaKey(): Promise<string> {
  return ''
}

export async function setBetaKey(_key: string): Promise<void> {
  /* no-op */
}

export async function getOverlayMode(): Promise<OverlayMode> {
  return DEFAULT_OVERLAY_MODE
}

export async function getSidebarTab(): Promise<SidebarTab> {
  return DEFAULT_SIDEBAR_TAB
}

export async function getAutoUpdateEnabled(): Promise<boolean> {
  return DEFAULT_AUTO_UPDATE_ENABLED
}

export async function getThemePreference(): Promise<ThemePreference> {
  return 'aurora'
}

function normalizeReduceMotionPreference(value: unknown): ReduceMotionPreference {
  return value === 'system' || value === 'on' || value === 'off'
    ? value
    : DEFAULT_REDUCE_MOTION_PREFERENCE
}

export function resolveReduceMotionPreference(stored: unknown): ReduceMotionPreference {
  return normalizeReduceMotionPreference(stored)
}

/** Effective motion-off flag from stored preference + OS media query. */
export function resolveReducedMotionEnabled(
  preference: ReduceMotionPreference,
  systemPrefersReduce: boolean,
): boolean {
  if (preference === 'on') return true
  if (preference === 'off') return false
  return systemPrefersReduce
}

/** Portal shim — no chrome.storage; always use the default preference. */
export async function getReduceMotionPreference(): Promise<ReduceMotionPreference> {
  return DEFAULT_REDUCE_MOTION_PREFERENCE
}

/** Portal shim — no chrome.storage; chart zoom hint stays dismissed. */
export async function getChartZoomHintDismissed(): Promise<boolean> {
  return true
}

export async function setChartZoomHintDismissed(_dismissed = true): Promise<void> {
  /* no-op */
}
