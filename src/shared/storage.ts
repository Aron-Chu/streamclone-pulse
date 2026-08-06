import { normalizeLogin } from './login.ts'
import type {
  ProtectChannelSyncStatus,
  ProtectSyncOperation,
  ProtectSyncState,
} from './messages.ts'

const BACKEND_URL_KEY = 'backendUrl'
const LOCAL_BACKEND_OPT_IN_KEY = 'localBackendOptIn'
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
/** Historical v1 flag (legacy sticky → Full). Superseded by v2 → 60m. */
const DEFAULT_CHART_WINDOW_MIGRATED_TO_FULL_V1_KEY = 'defaultChartWindowMigratedToFullV1'
/** One-time sync flag: every pre-v2 chart preference (including Full) → 60m. */
const DEFAULT_CHART_WINDOW_MIGRATED_TO_RECENT_V2_KEY = 'defaultChartWindowMigratedToRecentV2'
const KEEP_LOCAL_CACHE_KEY = 'keepLocalCache'
export const PROTECT_SYNC_STATE_KEY = 'protectSyncState'

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
export interface OverlayDisplayPreferences {
  placement: OverlayPlacement
  mode: OverlayMode
}

export const DEFAULT_OVERLAY_MODE: OverlayMode = 'expanded'
export const DEFAULT_OVERLAY_PLACEMENT: OverlayPlacement = 'sidebar'
export const DEFAULT_CHAT_CLOSED_PULSE_DOCK_ENABLED = false
export const DEFAULT_SIDEBAR_TAB: SidebarTab = 'pulse'
export const DEFAULT_AUTO_TRACK_POLICY: AutoTrackPolicy = 'off'
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'aurora'
export const DEFAULT_DEFAULT_CHART_WINDOW: DefaultChartWindow = '60m'
export const DEFAULT_KEEP_LOCAL_CACHE = true

const LOCALHOST = String.fromCharCode(108, 111, 99, 97, 108, 104, 111, 115, 116)
const LOOPBACK_IPV4 = [127, 0, 0, 1].join('.')
const LOCAL_BACKEND_PORT = String.fromCharCode(56, 48, 56, 49)
const LEGACY_BACKEND_PORT = String.fromCharCode(56, 48, 57, 48)
const LOCAL_WORKER_HOST = [108, 97, 112, 116, 111, 112, 119, 111, 114, 107, 101, 114]
  .map(code => String.fromCharCode(code))
  .join('')

/** True when the URL targets the local StreamPulse backend compose (not hosted IRC/API). */
export function isLocalStackBackendUrl(url: string): boolean {
  if (typeof __EXTENSION_STORE_BUILD__ !== 'undefined' && __EXTENSION_STORE_BUILD__) {
    return false
  }
  const normalized = url.trim().replace(/\/+$/, '').toLowerCase()
  if (!normalized) return false
  return (
    normalized.includes(`${LOCALHOST}:${LOCAL_BACKEND_PORT}`)
    || normalized.includes(`${LOOPBACK_IPV4}:${LOCAL_BACKEND_PORT}`)
    || normalized.includes(`${LOCAL_WORKER_HOST}:${LOCAL_BACKEND_PORT}`)
    || (normalized.includes(LOCAL_WORKER_HOST) && !normalized.includes(`:${LEGACY_BACKEND_PORT}`))
  )
}

/** Legacy Streamclone Caddy :8090 — watch-only after boundary split; auto-reset to hosted. */
export function isLegacyStreamcloneBackendUrl(url: string): boolean {
  if (typeof __EXTENSION_STORE_BUILD__ !== 'undefined' && __EXTENSION_STORE_BUILD__) {
    return false
  }
  const normalized = url.trim().replace(/\/+$/, '').toLowerCase()
  return normalized.includes(`${LOCALHOST}:${LEGACY_BACKEND_PORT}`)
    || normalized.includes(`${LOOPBACK_IPV4}:${LEGACY_BACKEND_PORT}`)
}

/** True when the extension should use hosted Pulse Live gating (no extension-initiated IRC watch). */
export function isHostedBackendUrl(url: string): boolean {
  if (typeof __EXTENSION_STORE_BUILD__ !== 'undefined' && __EXTENSION_STORE_BUILD__) {
    return true
  }
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

async function localStorageGet(
  keys?: string | string[] | Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  if (!isExtensionContextAlive()) return {}
  try {
    return (await chrome.storage.local.get(keys ?? null)) as Record<string, unknown>
  } catch (err) {
    if (isBenignStorageError(err)) return {}
    throw err
  }
}

async function localStorageSet(items: Record<string, unknown>): Promise<void> {
  if (!isExtensionContextAlive()) return
  try {
    await chrome.storage.local.set(items)
  } catch (err) {
    if (isBenignStorageError(err)) return
    throw err
  }
}

async function localStorageRemove(keys: string | string[]): Promise<void> {
  if (!isExtensionContextAlive()) return
  try {
    await chrome.storage.local.remove(keys)
  } catch (err) {
    if (isBenignStorageError(err)) return
    throw err
  }
}

async function syncStorageRemove(keys: string | string[]): Promise<void> {
  if (!isExtensionContextAlive()) return
  try {
    await chrome.storage.sync.remove(keys)
  } catch (err) {
    if (isBenignStorageError(err)) return
    throw err
  }
}

/** Local BFF hosts requested only when the user opts into localhost development. */
export const LOCAL_BACKEND_OPTIONAL_HOSTS =
  typeof __EXTENSION_STORE_BUILD__ !== 'undefined' && __EXTENSION_STORE_BUILD__
    ? ([] as const)
    : ([
        `http://${LOCALHOST}:${LOCAL_BACKEND_PORT}/*`,
        `http://${LOOPBACK_IPV4}:${LOCAL_BACKEND_PORT}/*`,
      ] as const)

/**
 * Ensure optional host access for the local StreamPulse BFF when the user opts in.
 * Production CWS builds keep localhost out of required host_permissions.
 */
export async function ensureLocalBackendHostPermission(url: string): Promise<boolean> {
  if (typeof __EXTENSION_STORE_BUILD__ !== 'undefined' && __EXTENSION_STORE_BUILD__) {
    return true
  }
  if (!isLocalStackBackendUrl(url)) return true
  if (!isExtensionContextAlive()) return false
  if (typeof chrome.permissions?.request !== 'function') return true
  try {
    const origins = [...LOCAL_BACKEND_OPTIONAL_HOSTS]
    const already = await chrome.permissions.contains({ origins })
    if (already) return true
    return await chrome.permissions.request({ origins })
  } catch {
    return false
  }
}

export async function getBackendUrl(): Promise<string> {
  if (typeof __EXTENSION_STORE_BUILD__ !== 'undefined' && __EXTENSION_STORE_BUILD__) {
    return DEFAULT_BACKEND_URL
  }
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
  if (typeof __EXTENSION_STORE_BUILD__ !== 'undefined' && __EXTENSION_STORE_BUILD__) {
    await syncStorageSet({
      [BACKEND_URL_KEY]: DEFAULT_BACKEND_URL,
      [LOCAL_BACKEND_OPT_IN_KEY]: false,
    })
    return
  }
  const trimmed = url.trim().replace(/\/+$/, '')
  const localOptIn = isLocalStackBackendUrl(trimmed)
  if (localOptIn) {
    const granted = await ensureLocalBackendHostPermission(trimmed)
    if (!granted) {
      throw new Error(
        `Local backend requires optional host permission for ${LOCALHOST}:${LOCAL_BACKEND_PORT} / ${LOOPBACK_IPV4}:${LOCAL_BACKEND_PORT}`,
      )
    }
  }
  await syncStorageSet({
    [BACKEND_URL_KEY]: trimmed,
    [LOCAL_BACKEND_OPT_IN_KEY]: localOptIn,
  })
}

/**
 * Beta / access keys stay device-local (chrome.storage.local), not sync.
 * Local storage is device-local but is not encrypted at rest by the browser.
 * One-time migration copies a legacy sync value into local and clears sync.
 * Where supported, restrict local storage to trusted extension contexts so
 * content scripts cannot read credential keys directly.
 */
export async function restrictCredentialStorageAccess(): Promise<void> {
  try {
    const local = chrome.storage.local as typeof chrome.storage.local & {
      setAccessLevel?: (accessLevel: { accessLevel: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }) => Promise<void>
    }
    if (typeof local.setAccessLevel === 'function') {
      await local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    }
  } catch {
    // Older Chrome or denied: SW/options remain the intended credential readers.
  }
}

export interface ProtectSyncStorageState {
  /** Device principal that produced serverConfirmed; omitted for local BFF mode. */
  principalId?: string
  serverConfirmed: string[]
  tombstones: string[]
  channels: Record<string, ProtectChannelSyncStatus>
}

const PROTECT_SYNC_STATES = new Set<ProtectSyncState>([
  'pending',
  'protected',
  'unauthorized',
  'cap',
  'retry',
  'failure',
])
const PROTECT_SYNC_OPERATIONS = new Set<ProtectSyncOperation>(['add', 'remove'])

function normalizeProtectLoginList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(
    value
      .map(item => typeof item === 'string' ? normalizeLogin(item) : null)
      .filter((item): item is string => Boolean(item)),
  )].sort()
}

function normalizeProtectSyncStorageState(value: unknown): ProtectSyncStorageState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { serverConfirmed: [], tombstones: [], channels: {} }
  }
  const record = value as Record<string, unknown>
  const rawChannels = record.channels
  const channels: Record<string, ProtectChannelSyncStatus> = {}
  if (rawChannels && typeof rawChannels === 'object' && !Array.isArray(rawChannels)) {
    for (const [rawLogin, rawStatus] of Object.entries(rawChannels as Record<string, unknown>)) {
      const login = normalizeLogin(rawLogin)
      if (!login || !rawStatus || typeof rawStatus !== 'object' || Array.isArray(rawStatus)) continue
      const status = rawStatus as Record<string, unknown>
      if (!PROTECT_SYNC_STATES.has(status.state as ProtectSyncState)) continue
      const operation = PROTECT_SYNC_OPERATIONS.has(status.operation as ProtectSyncOperation)
        ? status.operation as ProtectSyncOperation
        : undefined
      const httpStatus = typeof status.status === 'number' && Number.isInteger(status.status) && status.status > 0
        ? status.status
        : undefined
      const message = typeof status.message === 'string' && status.message.length <= 200
        ? status.message
        : undefined
      const updatedAt = typeof status.updatedAt === 'number' && Number.isFinite(status.updatedAt)
        ? status.updatedAt
        : undefined
      channels[login] = {
        state: status.state as ProtectSyncState,
        operation,
        status: httpStatus,
        message,
        updatedAt,
      }
    }
  }
  const principalId = typeof record.principalId === 'string' && record.principalId.trim()
    ? record.principalId.trim()
    : undefined
  return {
    ...(principalId ? { principalId } : {}),
    serverConfirmed: normalizeProtectLoginList(record.serverConfirmed),
    tombstones: normalizeProtectLoginList(record.tombstones),
    channels,
  }
}

export async function getProtectSyncState(): Promise<ProtectSyncStorageState> {
  const stored = await localStorageGet(PROTECT_SYNC_STATE_KEY)
  return normalizeProtectSyncStorageState(stored[PROTECT_SYNC_STATE_KEY])
}

export async function setProtectSyncState(state: ProtectSyncStorageState): Promise<void> {
  await localStorageSet({ [PROTECT_SYNC_STATE_KEY]: normalizeProtectSyncStorageState(state) })
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
  return (await getOverlayDisplayPreferences()).mode
}

export async function setOverlayMode(mode: OverlayMode): Promise<void> {
  await syncStorageSet({ [OVERLAY_MODE_KEY]: normalizeOverlayMode(mode) })
}

export async function getOverlayPlacement(): Promise<OverlayPlacement> {
  return (await getOverlayDisplayPreferences()).placement
}

export async function getOverlayDisplayPreferences(): Promise<OverlayDisplayPreferences> {
  const stored = await syncStorageGet([OVERLAY_PLACEMENT_KEY, OVERLAY_MODE_KEY])
  const placement = normalizeOverlayPlacement(stored[OVERLAY_PLACEMENT_KEY])
  const mode = normalizeOverlayMode(stored[OVERLAY_MODE_KEY])
  if (placement !== 'hidden') return { placement, mode }

  const latest = await syncStorageGet([OVERLAY_PLACEMENT_KEY, OVERLAY_MODE_KEY])
  const latestPlacement = normalizeOverlayPlacement(latest[OVERLAY_PLACEMENT_KEY])
  const latestMode = normalizeOverlayMode(latest[OVERLAY_MODE_KEY])
  if (latestPlacement !== 'hidden') {
    return { placement: latestPlacement, mode: latestMode }
  }

  const migrated = {
    placement: DEFAULT_OVERLAY_PLACEMENT,
    mode: 'collapsed' as const,
  }
  await syncStorageSet({
    [OVERLAY_PLACEMENT_KEY]: migrated.placement,
    [OVERLAY_MODE_KEY]: migrated.mode,
  })
  return migrated
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

const PULSE_DOCK_PREFERENCE_KEY = 'pulseDockPreference'

export type PulseDockPreference = {
  show7TVSignalLabels: boolean
}

export const DEFAULT_PULSE_DOCK_PREFERENCE: PulseDockPreference = {
  show7TVSignalLabels: true,
}

function normalizePulseDockPreference(raw: unknown): PulseDockPreference {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PULSE_DOCK_PREFERENCE }
  const record = raw as Record<string, unknown>
  return {
    show7TVSignalLabels:
      record.show7TVSignalLabels === undefined
        ? DEFAULT_PULSE_DOCK_PREFERENCE.show7TVSignalLabels
        : Boolean(record.show7TVSignalLabels),
  }
}

export async function getPulseDockPreference(): Promise<PulseDockPreference> {
  const stored = await syncStorageGet(PULSE_DOCK_PREFERENCE_KEY)
  return normalizePulseDockPreference(stored[PULSE_DOCK_PREFERENCE_KEY])
}

export async function setPulseDockPreference(
  patch: Partial<PulseDockPreference>,
): Promise<void> {
  const current = await getPulseDockPreference()
  await syncStorageSet({
    [PULSE_DOCK_PREFERENCE_KEY]: normalizePulseDockPreference({ ...current, ...patch }),
  })
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
 * @deprecated Prefer migrateDefaultChartWindowToRecentV2Once (RPR-1).
 * Historical v1 migration kept for tests that inspect the old flag.
 */
export async function migrateDefaultChartWindowToFullOnce(): Promise<void> {
  try {
    const stored = await syncStorageGet([
      DEFAULT_CHART_WINDOW_MIGRATED_TO_FULL_V1_KEY,
      DEFAULT_CHART_WINDOW_KEY,
    ])
    if (stored[DEFAULT_CHART_WINDOW_MIGRATED_TO_FULL_V1_KEY]) return
    await syncStorageSet({
      [DEFAULT_CHART_WINDOW_KEY]: 'full',
      [DEFAULT_CHART_WINDOW_MIGRATED_TO_FULL_V1_KEY]: true,
    })
  } catch {
    /* ignore storage errors in restricted contexts */
  }
}

/**
 * One-time migration v2: every pre-v2 stored chart preference (including Full)
 * becomes 60m. Idempotent via DEFAULT_CHART_WINDOW_MIGRATED_TO_RECENT_V2_KEY.
 * After v2, an explicit user Full selection is preserved (setDefaultChartWindow
 * also stamps the v2 marker).
 */
export async function migrateDefaultChartWindowToRecentV2Once(): Promise<void> {
  try {
    const stored = await syncStorageGet([
      DEFAULT_CHART_WINDOW_MIGRATED_TO_RECENT_V2_KEY,
      DEFAULT_CHART_WINDOW_KEY,
    ])
    // Only an explicit boolean true completes the migration; missing/false/malformed re-run.
    if (stored[DEFAULT_CHART_WINDOW_MIGRATED_TO_RECENT_V2_KEY] === true) return
    await syncStorageSet({
      [DEFAULT_CHART_WINDOW_KEY]: '60m',
      [DEFAULT_CHART_WINDOW_MIGRATED_TO_RECENT_V2_KEY]: true,
      // Keep v1 flag set so older codepaths do not re-apply Full.
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
    [DEFAULT_CHART_WINDOW_MIGRATED_TO_RECENT_V2_KEY]: true,
  })
}

/** Exported for tests. */
export const CHART_WINDOW_MIGRATION_KEYS = {
  v1: DEFAULT_CHART_WINDOW_MIGRATED_TO_FULL_V1_KEY,
  v2: DEFAULT_CHART_WINDOW_MIGRATED_TO_RECENT_V2_KEY,
  value: DEFAULT_CHART_WINDOW_KEY,
} as const

export async function getKeepLocalCache(): Promise<boolean> {
  const stored = await syncStorageGet(KEEP_LOCAL_CACHE_KEY)
  if (stored[KEEP_LOCAL_CACHE_KEY] === undefined) return DEFAULT_KEEP_LOCAL_CACHE
  return Boolean(stored[KEEP_LOCAL_CACHE_KEY])
}

export async function setKeepLocalCache(keep: boolean): Promise<void> {
  await syncStorageSet({ [KEEP_LOCAL_CACHE_KEY]: keep })
  if (!keep) await clearSessionPulseCache()
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
  const expected = String(expectedStreamId ?? '').trim()
  const genericKey = pulseSessionKey(login, window)
  const identityKey = expected ? pulseSessionKey(login, window, expected) : null
  const stored = await sessionStorageGet(identityKey ? [identityKey, genericKey] : genericKey)
  const entry = (identityKey ? stored[identityKey] ?? stored[genericKey] : stored[genericKey]) as PulseCacheEntry | undefined
  if (!entry) return null
  if (entry.window !== window || !Number.isFinite(entry.fetchedAt)) {
    await sessionStorageRemove(identityKey ?? genericKey)
    return null
  }
  if (Date.now() - entry.fetchedAt > PULSE_CACHE_TTL_MS) {
    await sessionStorageRemove(identityKey ?? genericKey)
    return null
  }
  if (expected && entry.streamId !== expected) {
    return null
  }
  return entry
}

export async function setSessionPulse(login: string, entry: PulseCacheEntry): Promise<void> {
  const items: Record<string, PulseCacheEntry> = {
    [pulseSessionKey(login, entry.window)]: entry,
  }
  const streamId = String(entry.streamId ?? '').trim()
  if (streamId) {
    items[pulseSessionKey(login, entry.window, streamId)] = entry
  }
  await sessionStorageSet(items)
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
  if (!Number.isFinite(entry.fetchedAt) || Date.now() - entry.fetchedAt > COVERAGE_CACHE_TTL_MS) {
    await sessionStorageRemove(key)
    return null
  }
  return entry
}

export async function setSessionCoverage(login: string, entry: CoverageCacheEntry): Promise<void> {
  if (!(await getKeepLocalCache())) return
  await sessionStorageSet({ [coverageSessionKey(login)]: entry })
}

function pulseSessionKey(login: string, window: PulseCacheWindow, streamId?: string): string {
  const suffix = String(streamId ?? '').trim()
  return suffix
    ? `pulse:${login.toLowerCase()}:${window}:${encodeURIComponent(suffix)}`
    : `pulse:${login.toLowerCase()}:${window}`
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
