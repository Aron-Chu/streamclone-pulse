const BACKEND_URL_KEY = 'backendUrl'
const POLL_INTERVAL_MS_KEY = 'pollIntervalMs'

export const DEFAULT_BACKEND_URL = 'http://localhost:8090'
export const DEFAULT_POLL_INTERVAL_MS = 30_000

export async function getBackendUrl(): Promise<string> {
  const stored = await chrome.storage.sync.get(BACKEND_URL_KEY)
  const url = String(stored[BACKEND_URL_KEY] ?? DEFAULT_BACKEND_URL).trim()
  return url.replace(/\/+$/, '')
}

export async function setBackendUrl(url: string): Promise<void> {
  await chrome.storage.sync.set({ [BACKEND_URL_KEY]: url.trim().replace(/\/+$/, '') })
}

export async function getPollIntervalMs(): Promise<number> {
  const stored = await chrome.storage.sync.get(POLL_INTERVAL_MS_KEY)
  const value = Number(stored[POLL_INTERVAL_MS_KEY])
  return Number.isFinite(value) && value >= 15_000 ? value : DEFAULT_POLL_INTERVAL_MS
}

export async function setPollIntervalMs(ms: number): Promise<void> {
  await chrome.storage.sync.set({ [POLL_INTERVAL_MS_KEY]: ms })
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
