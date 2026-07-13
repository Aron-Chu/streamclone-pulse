const BACKEND_URL_KEY = 'backendUrl'
const LOCAL_BACKEND_OPT_IN_KEY = 'localBackendOptIn'
const BETA_KEY_KEY = 'betaKey'
const POLL_INTERVAL_MS_KEY = 'pollIntervalMs'
const OVERLAY_MODE_KEY = 'overlayMode'
const OVERLAY_PLACEMENT_KEY = 'overlayPlacement'
const SIDEBAR_TAB_KEY = 'sidebarTab'
const CHAT_CLOSED_PULSE_DOCK_ENABLED_KEY = 'chatClosedPulseDockEnabled'
/** @deprecated Migrated to CHAT_CLOSED_PULSE_DOCK_ENABLED_KEY */
const LEGACY_SIDEBAR_PULSE_TAB_ENABLED_KEY = 'sidebarPulseTabEnabled'
const AUTO_TRACK_POLICY_KEY = 'autoTrackPolicy'
const AUTO_UPDATE_ENABLED_KEY = 'autoUpdateEnabled'
const THEME_PREFERENCE_KEY = 'themePreference'
export { THEME_PREFERENCE_KEY, CHAT_CLOSED_PULSE_DOCK_ENABLED_KEY }
const DEFAULT_CHART_WINDOW_KEY = 'defaultChartWindow'
/** One-time sync flag: legacy sticky non-full defaults → Full stream. */
const DEFAULT_CHART_WINDOW_MIGRATED_TO_FULL_V1_KEY = 'defaultChartWindowMigratedToFullV1'
const KEEP_LOCAL_CACHE_KEY = 'keepLocalCache'

export const DEFAULT_BACKEND_URL = 'https://api.streampulse.stream'
export const DEFAULT_POLL_INTERVAL_MS = 30_000
export const DEFAULT_AUTO_UPDATE_ENABLED = true
export const POLL_INTERVAL_OPTIONS_MS = [15_000, 30_000, 60_000] as const

export type OverlayMode = 'collapsed' | 'mini' | 'expanded'
export type OverlayPlacement = 'bottom' | 'right' | 'sidebar' | 'hidden'
export type SidebarTab = 'chat' | 'pulse'
export type AutoTrackPolicy = 'off' | 'followed' | 'ask'
export type ThemePreference = 'aurora' | 'volt' | 'azure'
export type DefaultChartWindow = '15m' | '30m' | '60m' | '2h' | '4h' | 'full'

export const DEFAULT_OVERLAY_MODE: OverlayMode = 'expanded'
export const DEFAULT_OVERLAY_PLACEMENT: OverlayPlacement = 'sidebar'
export const DEFAULT_CHAT_CLOSED_PULSE_DOCK_ENABLED = false
export const DEFAULT_SIDEBAR_TAB: SidebarTab = 'pulse'
export const DEFAULT_AUTO_TRACK_POLICY: AutoTrackPolicy = 'off'
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'aurora'
export const DEFAULT_DEFAULT_CHART_WINDOW: DefaultChartWindow = 'full'
export const DEFAULT_KEEP_LOCAL_CACHE = true

/** True when the URL targets the local StreamPulse backend compose (not hosted IRC/API). */
export function isLocalStackBackendUrl(url: string): boolean {
  const normalized = url.trim().replace(/\/+$/, '').toLowerCase()
  if (!normalized) return false
  return (
    normalized.includes('localhost:8081')
    || normalized.includes('127.0.0.1:8081')
    || normalized.includes('laptopworker:8081')
    || (normalized.includes('laptopworker') && !normalized.includes(':8090'))
  )
}

/** Legacy Streamclone Caddy :8090 — watch-only after boundary split; auto-reset to hosted. */
export function isLegacyStreamcloneBackendUrl(url: string): boolean {
  const normalized = url.trim().replace(/\/+$/, '').toLowerCase()
  return normalized.includes('localhost:8090') || normalized.includes('127.0.0.1:8090')
}

/** True when the extension should use hosted Pulse Live gating (no extension-initiated IRC watch). */
export function isHostedBackendUrl(url: string): boolean {
  const normalized = url.trim().replace(/\/+$/, '').toLowerCase()
  if (!normalized) return true
  return !isLocalStackBackendUrl(normalized)
}

export function clampPollIntervalMs(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_POLL_INTERVAL_MS
  const clamped = Math.min(300_000, Math.max(10_000, ms))
  const step = 5_000
  return Math.round(clamped / step) * step
}

/** False after extension reload/disable while a Twitch page still holds an old content script. */
export function isExtensionContextAlive(): boolean {
  try {
    return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id)
  } catch {
    return false
  }
}

function isBenignStorageError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  return /Access to storage is not allowed|Extension context invalidated|storage is not allowed from this context/i.test(
    message,
  )
}

async function syncStorageGet(
  keys?: string | string[] | Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  if (!isExtensionContextAlive()) return {}
  try {
    return (await chrome.storage.sync.get(keys ?? null)) as Record<string, unknown>
  } catch (err) {
    if (isBenignStorageError(err)) return {}
    throw err
  }
}

async function syncStorageSet(items: Record<string, unknown>): Promise<void> {
  if (!isExtensionContextAlive()) return
  try {
    await chrome.storage.sync.set(items)
  } catch (err) {
    if (isBenignStorageError(err)) return
    throw err
  }
}

async function sessionStorageGet(
  keys?: string | string[] | Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  if (!isExtensionContextAlive()) return {}
  try {
    return (await chrome.storage.session.get(keys ?? null)) as Record<string, unknown>
  } catch (err) {
    if (isBenignStorageError(err)) return {}
    throw err
  }
}

async function sessionStorageSet(items: Record<string, unknown>): Promise<void> {
  if (!isExtensionContextAlive()) return
  try {
    await chrome.storage.session.set(items)
  } catch (err) {
    if (isBenignStorageError(err)) return
    throw err
  }
}

async function sessionStorageRemove(keys: string | string[]): Promise<void> {
  if (!isExtensionContextAlive()) return
  try {
    await chrome.storage.session.remove(keys)
  } catch (err) {
    if (isBenignStorageError(err)) return
    throw err
  }
}

export async function getBackendUrl(): Promise<string> {
  const stored = await syncStorageGet([BACKEND_URL_KEY, LOCAL_BACKEND_OPT_IN_KEY])
  const raw = String(stored[BACKEND_URL_KEY] ?? DEFAULT_BACKEND_URL).trim()
  const url = raw.replace(/\/+$/, '')

  if (isLegacyStreamcloneBackendUrl(url)) {
    await syncStorageSet({
      [BACKEND_URL_KEY]: DEFAULT_BACKEND_URL,
      [LOCAL_BACKEND_OPT_IN_KEY]: false,
    })
    return DEFAULT_BACKEND_URL
  }

  if (isLocalStackBackendUrl(url) && !stored[LOCAL_BACKEND_OPT_IN_KEY]) {
    await syncStorageSet({
      [BACKEND_URL_KEY]: DEFAULT_BACKEND_URL,
      [LOCAL_BACKEND_OPT_IN_KEY]: false,
    })
    return DEFAULT_BACKEND_URL
  }

  return url || DEFAULT_BACKEND_URL
}

export async function setBackendUrl(url: string): Promise<void> {
  const trimmed = url.trim().replace(/\/+$/, '')
  const localOptIn = isLocalStackBackendUrl(trimmed)
  await syncStorageSet({
    [BACKEND_URL_KEY]: trimmed,
    [LOCAL_BACKEND_OPT_IN_KEY]: localOptIn,
  })
}

export async function getBetaKey(): Promise<string> {
  const stored = await syncStorageGet(BETA_KEY_KEY)
  return String(stored[BETA_KEY_KEY] ?? '').trim()
}

export async function setBetaKey(key: string): Promise<void> {
  await syncStorageSet({ [BETA_KEY_KEY]: key.trim() })
}

export async function getPollIntervalMs(): Promise<number> {
  const stored = await syncStorageGet(POLL_INTERVAL_MS_KEY)
  const value = Number(stored[POLL_INTERVAL_MS_KEY])
  return Number.isFinite(value) && value >= 15_000 ? value : DEFAULT_POLL_INTERVAL_MS
}

export async function setPollIntervalMs(ms: number): Promise<void> {
  const safe = clampPollIntervalMs(ms)
  await syncStorageSet({ [POLL_INTERVAL_MS_KEY]: safe })
}

export async function getOverlayMode(): Promise<OverlayMode> {
  const stored = await syncStorageGet(OVERLAY_MODE_KEY)
  return normalizeOverlayMode(stored[OVERLAY_MODE_KEY])
}

export async function setOverlayMode(mode: OverlayMode): Promise<void> {
  await syncStorageSet({ [OVERLAY_MODE_KEY]: normalizeOverlayMode(mode) })
}

export async function getOverlayPlacement(): Promise<OverlayPlacement> {
  const stored = await syncStorageGet(OVERLAY_PLACEMENT_KEY)
  return normalizeOverlayPlacement(stored[OVERLAY_PLACEMENT_KEY])
}

export async function setOverlayPlacement(placement: OverlayPlacement): Promise<void> {
  await syncStorageSet({ [OVERLAY_PLACEMENT_KEY]: normalizeOverlayPlacement(placement) })
}

export async function getSidebarTab(): Promise<SidebarTab> {
  const stored = await syncStorageGet(SIDEBAR_TAB_KEY)
  return normalizeSidebarTab(stored[SIDEBAR_TAB_KEY])
}

export async function setSidebarTab(tab: SidebarTab): Promise<void> {
  await syncStorageSet({ [SIDEBAR_TAB_KEY]: normalizeSidebarTab(tab) })
}

export function resolveChatClosedPulseDockEnabled(stored: boolean | undefined): boolean {
  if (stored !== undefined) return Boolean(stored)
  return DEFAULT_CHAT_CLOSED_PULSE_DOCK_ENABLED
}

export async function getChatClosedPulseDockEnabled(): Promise<boolean> {
  const stored = await syncStorageGet([
    CHAT_CLOSED_PULSE_DOCK_ENABLED_KEY,
    LEGACY_SIDEBAR_PULSE_TAB_ENABLED_KEY,
  ])
  const raw = stored[CHAT_CLOSED_PULSE_DOCK_ENABLED_KEY]
  if (raw !== undefined) {
    return resolveChatClosedPulseDockEnabled(Boolean(raw))
  }
  const legacy = stored[LEGACY_SIDEBAR_PULSE_TAB_ENABLED_KEY]
  if (legacy !== undefined) {
    const migrated = resolveChatClosedPulseDockEnabled(Boolean(legacy))
    await syncStorageSet({ [CHAT_CLOSED_PULSE_DOCK_ENABLED_KEY]: migrated })
    return migrated
  }
  return DEFAULT_CHAT_CLOSED_PULSE_DOCK_ENABLED
}

export async function setChatClosedPulseDockEnabled(enabled: boolean): Promise<void> {
  await syncStorageSet({ [CHAT_CLOSED_PULSE_DOCK_ENABLED_KEY]: enabled })
}

export async function getAutoTrackPolicy(): Promise<AutoTrackPolicy> {
  const stored = await syncStorageGet(AUTO_TRACK_POLICY_KEY)
  return normalizeAutoTrackPolicy(stored[AUTO_TRACK_POLICY_KEY])
}

export async function setAutoTrackPolicy(policy: AutoTrackPolicy): Promise<void> {
  await syncStorageSet({ [AUTO_TRACK_POLICY_KEY]: normalizeAutoTrackPolicy(policy) })
}

export async function getAutoUpdateEnabled(): Promise<boolean> {
  const stored = await syncStorageGet(AUTO_UPDATE_ENABLED_KEY)
  if (stored[AUTO_UPDATE_ENABLED_KEY] === undefined) return true
  return Boolean(stored[AUTO_UPDATE_ENABLED_KEY])
}

export async function setAutoUpdateEnabled(enabled: boolean): Promise<void> {
  await syncStorageSet({ [AUTO_UPDATE_ENABLED_KEY]: enabled })
}

export async function getThemePreference(): Promise<ThemePreference> {
  const stored = await syncStorageGet(THEME_PREFERENCE_KEY)
  return normalizeThemePreference(stored[THEME_PREFERENCE_KEY])
}

export async function setThemePreference(pref: ThemePreference): Promise<void> {
  await syncStorageSet({ [THEME_PREFERENCE_KEY]: normalizeThemePreference(pref) })
}

/**
 * One-time migration: sticky legacy chart defaults (e.g. 60m from an older product
 * default) become Full stream. Explicit setDefaultChartWindow writes also mark the
 * flag so a deliberate preference is not overwritten later.
 */
export async function migrateDefaultChartWindowToFullOnce(): Promise<void> {
  try {
    const stored = await syncStorageGet([
      DEFAULT_CHART_WINDOW_MIGRATED_TO_FULL_V1_KEY,
      DEFAULT_CHART_WINDOW_KEY,
    ])
    if (stored[DEFAULT_CHART_WINDOW_MIGRATED_TO_FULL_V1_KEY]) return
    await syncStorageSet({
      [DEFAULT_CHART_WINDOW_KEY]: DEFAULT_DEFAULT_CHART_WINDOW,
      [DEFAULT_CHART_WINDOW_MIGRATED_TO_FULL_V1_KEY]: true,
    })
  } catch {
    /* ignore storage errors in restricted contexts */
  }
}

export async function getDefaultChartWindow(): Promise<DefaultChartWindow> {
  const stored = await syncStorageGet(DEFAULT_CHART_WINDOW_KEY)
  return normalizeDefaultChartWindow(stored[DEFAULT_CHART_WINDOW_KEY])
}

export async function setDefaultChartWindow(window: DefaultChartWindow): Promise<void> {
  await syncStorageSet({
    [DEFAULT_CHART_WINDOW_KEY]: normalizeDefaultChartWindow(window),
    [DEFAULT_CHART_WINDOW_MIGRATED_TO_FULL_V1_KEY]: true,
  })
}

export async function getKeepLocalCache(): Promise<boolean> {
  const stored = await syncStorageGet(KEEP_LOCAL_CACHE_KEY)
  if (stored[KEEP_LOCAL_CACHE_KEY] === undefined) return DEFAULT_KEEP_LOCAL_CACHE
  return Boolean(stored[KEEP_LOCAL_CACHE_KEY])
}

export async function setKeepLocalCache(keep: boolean): Promise<void> {
  await syncStorageSet({ [KEEP_LOCAL_CACHE_KEY]: keep })
}

export async function countSessionPulseEntries(): Promise<number> {
  const stored = await sessionStorageGet(null)
  return Object.keys(stored).filter(key => key.startsWith('pulse:')).length
}

export async function clearSessionPulseCache(): Promise<void> {
  const stored = await sessionStorageGet(null)
  const keys = Object.keys(stored).filter(
    key => key.startsWith('pulse:') || key.startsWith('coverage:'),
  )
  if (keys.length === 0) return
  await sessionStorageRemove(keys)
}

const DEBUG_LOGGING_KEY = 'debugLoggingEnabled'

export async function getDebugLoggingEnabled(): Promise<boolean> {
  const stored = await syncStorageGet(DEBUG_LOGGING_KEY)
  return Boolean(stored[DEBUG_LOGGING_KEY])
}

export async function setDebugLoggingEnabled(enabled: boolean): Promise<void> {
  await syncStorageSet({ [DEBUG_LOGGING_KEY]: enabled })
}

export const PULSE_CACHE_TTL_MS = 45_000
export const COVERAGE_CACHE_TTL_MS = 60_000

export type PulseCacheWindow = 'recent' | 'full'

export async function getSessionPulse(
  login: string,
  window: PulseCacheWindow = 'recent',
  expectedStreamId?: string | null,
): Promise<PulseCacheEntry | null> {
  const key = pulseSessionKey(login, window)
  const stored = await sessionStorageGet(key)
  const entry = stored[key] as PulseCacheEntry | undefined
  if (!entry) return null
  if (entry.window !== window) return null
  if (Date.now() - entry.fetchedAt > PULSE_CACHE_TTL_MS) return null
  const expected = String(expectedStreamId ?? '').trim()
  if (expected && entry.streamId && entry.streamId !== expected) return null
  return entry
}

export async function setSessionPulse(login: string, entry: PulseCacheEntry): Promise<void> {
  await sessionStorageSet({ [pulseSessionKey(login, entry.window)]: entry })
}

/** Respects the "Remember recently opened channels" setting before writing session cache. */
export async function cacheSessionPulseIfEnabled(login: string, entry: PulseCacheEntry): Promise<void> {
  if (!(await getKeepLocalCache())) return
  await setSessionPulse(login, entry)
}

export interface PulseCacheEntry {
  payload: import('./messages.ts').PulsePayload
  fetchedAt: number
  window: PulseCacheWindow
  streamId: string
}

export interface CoverageCacheEntry {
  coverageTier: import('./messages.ts').ExtensionCoverageTierResponse
  fetchedAt: number
}

export async function getSessionCoverage(login: string): Promise<CoverageCacheEntry | null> {
  const key = coverageSessionKey(login)
  const stored = await sessionStorageGet(key)
  const entry = stored[key] as CoverageCacheEntry | undefined
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > COVERAGE_CACHE_TTL_MS) return null
  return entry
}

export async function setSessionCoverage(login: string, entry: CoverageCacheEntry): Promise<void> {
  await sessionStorageSet({ [coverageSessionKey(login)]: entry })
}

function pulseSessionKey(login: string, window: PulseCacheWindow): string {
  return `pulse:${login.toLowerCase()}:${window}`
}

function coverageSessionKey(login: string): string {
  return `coverage:${login.toLowerCase()}`
}

function normalizeOverlayMode(value: unknown): OverlayMode {
  return value === 'collapsed' || value === 'mini' || value === 'expanded'
    ? value
    : DEFAULT_OVERLAY_MODE
}

export function normalizeOverlayPlacement(value: unknown): OverlayPlacement {
  return value === 'bottom' || value === 'right' || value === 'sidebar' || value === 'hidden'
    ? value
    : DEFAULT_OVERLAY_PLACEMENT
}

export function normalizeSidebarTab(value: unknown): SidebarTab {
  return value === 'chat' || value === 'pulse' ? value : DEFAULT_SIDEBAR_TAB
}

function normalizeAutoTrackPolicy(value: unknown): AutoTrackPolicy {
  return value === 'off' || value === 'followed' || value === 'ask'
    ? value
    : DEFAULT_AUTO_TRACK_POLICY
}

function normalizeThemePreference(value: unknown): ThemePreference {
  if (value === 'aurora' || value === 'volt' || value === 'azure') return value
  if (value === 'volcano') return 'volt'
  if (value === 'ocean') return 'azure'
  return DEFAULT_THEME_PREFERENCE
}

function normalizeDefaultChartWindow(value: unknown): DefaultChartWindow {
  return value === '15m'
    || value === '30m'
    || value === '60m'
    || value === '2h'
    || value === '4h'
    || value === 'full'
    ? value
    : DEFAULT_DEFAULT_CHART_WINDOW
}
