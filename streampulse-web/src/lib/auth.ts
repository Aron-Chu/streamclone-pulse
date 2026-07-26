const STORAGE_KEY = 'sp.betaKey'
const BACKEND_OVERRIDE_KEY = 'sp.backendUrlOverride'

let cachedPrincipal: { id: string; kind: 'beta' } | null = null

export async function hash16(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}

export function getBetaKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

export async function setBetaKey(key: string): Promise<void> {
  localStorage.setItem(STORAGE_KEY, key.trim())
  await refreshPrincipal()
}

export function clearBetaKey(): void {
  localStorage.removeItem(STORAGE_KEY)
  cachedPrincipal = null
}

export async function refreshPrincipal(): Promise<{ id: string; kind: 'beta' } | null> {
  const key = getBetaKey()
  if (!key) {
    cachedPrincipal = null
    return null
  }
  const id = await hash16(key)
  cachedPrincipal = { id, kind: 'beta' }
  return cachedPrincipal
}

export function currentPrincipal(): { id: string; kind: 'beta' } | null {
  return cachedPrincipal
}

export function hasBetaKey(): boolean {
  return getBetaKey().length > 0
}

export function maskBetaKey(key: string): string {
  const trimmed = key.trim()
  if (!trimmed) return 'PULSE-••••-••••'
  const suffix = trimmed.length >= 4 ? trimmed.slice(-4) : '••••'
  return `PULSE-••••-••••-${suffix}`
}

export const DEFAULT_PRODUCTION_BACKEND_URL = 'https://api.streampulse.stream'
const TAILNET_DEV_HOST_PARTS = ['laptop', 'worker'] as const

function tailnetDevHost(): string {
  return TAILNET_DEV_HOST_PARTS.join('')
}

/** True for localhost / laptopworker StreamPulse backend dev — not used by default portal dev. */
export function isLocalDevBackendUrl(url: string): boolean {
  const normalized = url.trim().replace(/\/+$/, '')
  if (!normalized) return false
  try {
    const host = new URL(normalized).hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === tailnetDevHost()
  } catch {
    return /localhost|127\.0\.0\.1|:8081/i.test(normalized) || normalized.toLowerCase().includes(tailnetDevHost())
  }
}

/** True when `npm run dev:local` (or env) explicitly opts into localhost :8081. */
export function allowsExplicitLocalBackend(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_ALLOW_LOCAL_BACKEND === '1'
}

export function resolvePortalDefaultBackendUrl(opts?: {
  viteBackendUrl?: string
  allowLocal?: boolean
}): string {
  const fromEnv = (opts?.viteBackendUrl ?? import.meta.env.VITE_BACKEND_URL)?.trim().replace(/\/+$/, '')
  if (!fromEnv) return DEFAULT_PRODUCTION_BACKEND_URL
  if (isLocalDevBackendUrl(fromEnv)) {
    const allowLocal = opts?.allowLocal ?? allowsExplicitLocalBackend()
    return allowLocal ? fromEnv : DEFAULT_PRODUCTION_BACKEND_URL
  }
  return fromEnv
}

export const DEFAULT_BACKEND_URL = resolvePortalDefaultBackendUrl()

/** Drop stale session overrides that pointed at local backend from older portal builds. */
export function clearStaleLocalBackendOverride(): void {
  if (import.meta.env.PROD) return
  try {
    const value = sessionStorage.getItem(BACKEND_OVERRIDE_KEY)?.trim()
    if (value && isLocalDevBackendUrl(value)) {
      sessionStorage.removeItem(BACKEND_OVERRIDE_KEY)
    }
  } catch {
    /* ignore */
  }
}

export function getBackendUrlOverride(): string | null {
  if (import.meta.env.PROD) return null
  if (!import.meta.env.DEV && import.meta.env.VITE_ALLOW_LOCAL_BACKEND !== '1') return null
  try {
    const value = sessionStorage.getItem(BACKEND_OVERRIDE_KEY)?.trim()
    if (!value) return null
    const normalized = value.replace(/\/+$/, '')
    if (isLocalDevBackendUrl(normalized) && !allowsExplicitLocalBackend()) return null
    return normalized
  } catch {
    return null
  }
}

export function hasSessionBackendOverride(): boolean {
  return getBackendUrlOverride() != null
}

export function setBackendUrlOverride(url: string | null): void {
  const trimmed = url?.trim().replace(/\/+$/, '') ?? ''
  if (trimmed && isLocalDevBackendUrl(trimmed) && !allowsExplicitLocalBackend()) {
    sessionStorage.removeItem(BACKEND_OVERRIDE_KEY)
    return
  }
  if (trimmed) {
    sessionStorage.setItem(BACKEND_OVERRIDE_KEY, trimmed)
  } else {
    sessionStorage.removeItem(BACKEND_OVERRIDE_KEY)
  }
}
