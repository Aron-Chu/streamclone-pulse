const BACKEND_URL_KEY = 'backendUrl'
const BETA_KEY_KEY = 'betaKey'
const POLL_INTERVAL_MS_KEY = 'pollIntervalMs'
const OVERLAY_MODE_KEY = 'overlayMode'
const OVERLAY_PLACEMENT_KEY = 'overlayPlacement'
const SIDEBAR_TAB_KEY = 'sidebarTab'
const AUTO_TRACK_POLICY_KEY = 'autoTrackPolicy'
const AUTO_UPDATE_ENABLED_KEY = 'autoUpdateEnabled'

export const DEFAULT_BACKEND_URL = 'https://api.streampulse.stream'
export const DEFAULT_POLL_INTERVAL_MS = 30_000
export const DEFAULT_AUTO_UPDATE_ENABLED = true
export const POLL_INTERVAL_OPTIONS_MS = [15_000, 30_000, 60_000] as const

export type OverlayMode = 'collapsed' | 'mini' | 'expanded'
export type OverlayPlacement = 'bottom' | 'right' | 'sidebar' | 'hidden'
export type SidebarTab = 'chat' | 'pulse'
export type AutoTrackPolicy = 'off' | 'followed' | 'ask'

export const DEFAULT_OVERLAY_MODE: OverlayMode = 'expanded'
export const DEFAULT_OVERLAY_PLACEMENT: OverlayPlacement = 'sidebar'
export const DEFAULT_SIDEBAR_TAB: SidebarTab = 'pulse'
export const DEFAULT_AUTO_TRACK_POLICY: AutoTrackPolicy = 'followed'

export async function getBackendUrl(): Promise<string> {
  const stored = await chrome.storage.sync.get(BACKEND_URL_KEY)
  const url = String(stored[BACKEND_URL_KEY] ?? DEFAULT_BACKEND_URL).trim()
  return url.replace(/\/+$/, '')
}

export async function setBackendUrl(url: string): Promise<void> {
  await chrome.storage.sync.set({ [BACKEND_URL_KEY]: url.trim().replace(/\/+$/, '') })
}

export async function getBetaKey(): Promise<string> {
  const stored = await chrome.storage.sync.get(BETA_KEY_KEY)
  return String(stored[BETA_KEY_KEY] ?? '').trim()
}

export async function setBetaKey(key: string): Promise<void> {
  await chrome.storage.sync.set({ [BETA_KEY_KEY]: key.trim() })
}

export async function getPollIntervalMs(): Promise<number> {
  const stored = await chrome.storage.sync.get(POLL_INTERVAL_MS_KEY)
  const value = Number(stored[POLL_INTERVAL_MS_KEY])
  return Number.isFinite(value) && value >= 15_000 ? value : DEFAULT_POLL_INTERVAL_MS
}

export async function setPollIntervalMs(ms: number): Promise<void> {
  const safe = POLL_INTERVAL_OPTIONS_MS.includes(ms as (typeof POLL_INTERVAL_OPTIONS_MS)[number])
    ? ms
    : DEFAULT_POLL_INTERVAL_MS
  await chrome.storage.sync.set({ [POLL_INTERVAL_MS_KEY]: safe })
}

export async function getOverlayMode(): Promise<OverlayMode> {
  const stored = await chrome.storage.sync.get(OVERLAY_MODE_KEY)
  return normalizeOverlayMode(stored[OVERLAY_MODE_KEY])
}

export async function setOverlayMode(mode: OverlayMode): Promise<void> {
  await chrome.storage.sync.set({ [OVERLAY_MODE_KEY]: normalizeOverlayMode(mode) })
}

export async function getOverlayPlacement(): Promise<OverlayPlacement> {
  const stored = await chrome.storage.sync.get(OVERLAY_PLACEMENT_KEY)
  return normalizeOverlayPlacement(stored[OVERLAY_PLACEMENT_KEY])
}

export async function setOverlayPlacement(placement: OverlayPlacement): Promise<void> {
  await chrome.storage.sync.set({ [OVERLAY_PLACEMENT_KEY]: normalizeOverlayPlacement(placement) })
}

export async function getSidebarTab(): Promise<SidebarTab> {
  const stored = await chrome.storage.sync.get(SIDEBAR_TAB_KEY)
  return normalizeSidebarTab(stored[SIDEBAR_TAB_KEY])
}

export async function setSidebarTab(tab: SidebarTab): Promise<void> {
  await chrome.storage.sync.set({ [SIDEBAR_TAB_KEY]: normalizeSidebarTab(tab) })
}

export async function getAutoTrackPolicy(): Promise<AutoTrackPolicy> {
  const stored = await chrome.storage.sync.get(AUTO_TRACK_POLICY_KEY)
  return normalizeAutoTrackPolicy(stored[AUTO_TRACK_POLICY_KEY])
}

export async function setAutoTrackPolicy(policy: AutoTrackPolicy): Promise<void> {
  await chrome.storage.sync.set({ [AUTO_TRACK_POLICY_KEY]: normalizeAutoTrackPolicy(policy) })
}

export async function getAutoUpdateEnabled(): Promise<boolean> {
  const stored = await chrome.storage.sync.get(AUTO_UPDATE_ENABLED_KEY)
  if (stored[AUTO_UPDATE_ENABLED_KEY] === undefined) return true
  return Boolean(stored[AUTO_UPDATE_ENABLED_KEY])
}

export async function setAutoUpdateEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.sync.set({ [AUTO_UPDATE_ENABLED_KEY]: enabled })
}

const DEBUG_LOGGING_KEY = 'debugLoggingEnabled'

export async function getDebugLoggingEnabled(): Promise<boolean> {
  const stored = await chrome.storage.sync.get(DEBUG_LOGGING_KEY)
  return Boolean(stored[DEBUG_LOGGING_KEY])
}

export async function setDebugLoggingEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.sync.set({ [DEBUG_LOGGING_KEY]: enabled })
}

export async function getSessionPulse(login: string): Promise<PulseCacheEntry | null> {
  const key = sessionKey(login)
  const stored = await chrome.storage.session.get(key)
  return (stored[key] as PulseCacheEntry | undefined) ?? null
}

export async function setSessionPulse(login: string, entry: PulseCacheEntry): Promise<void> {
  await chrome.storage.session.set({ [sessionKey(login)]: entry })
}

export interface PulseCacheEntry {
  payload: import('./messages.ts').PulsePayload
  fetchedAt: number
}

function sessionKey(login: string): string {
  return `pulse:${login.toLowerCase()}`
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
