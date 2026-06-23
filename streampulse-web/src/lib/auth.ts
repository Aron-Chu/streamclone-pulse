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

export function getBackendUrlOverride(): string | null {
  try {
    const value = sessionStorage.getItem(BACKEND_OVERRIDE_KEY)?.trim()
    return value ? value.replace(/\/+$/, '') : null
  } catch {
    return null
  }
}

export function setBackendUrlOverride(url: string | null): void {
  if (url?.trim()) {
    sessionStorage.setItem(BACKEND_OVERRIDE_KEY, url.trim().replace(/\/+$/, ''))
  } else {
    sessionStorage.removeItem(BACKEND_OVERRIDE_KEY)
  }
}

export const DEFAULT_BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL?.trim().replace(/\/+$/, '') ||
  'http://localhost:8090'

export const DEFAULT_PRODUCTION_BACKEND_URL = 'https://api.streampulse.stream'
