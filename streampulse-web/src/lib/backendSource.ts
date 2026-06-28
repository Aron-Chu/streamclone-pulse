import { DEFAULT_BACKEND_URL, DEFAULT_PRODUCTION_BACKEND_URL } from './auth'
import { getBackendUrl } from './apiClient'

export type BackendSource = 'hosted' | 'local' | 'custom'

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** Classify which API the portal is reading (session override wins over env default). */
export function resolveBackendSource(url?: string): BackendSource {
  const resolved = normalizeUrl(url ?? getBackendUrl())
  if (resolved === normalizeUrl(DEFAULT_PRODUCTION_BACKEND_URL)) return 'hosted'
  try {
    const host = new URL(resolved).hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1') return 'local'
  } catch {
    /* fall through */
  }
  if (normalizeUrl(DEFAULT_BACKEND_URL) === resolved) return 'local'
  return 'custom'
}

export function backendSourceLabel(source: BackendSource): string {
  switch (source) {
    case 'hosted':
      return 'Hosted corpus'
    case 'local':
      return 'Local stack'
    case 'custom':
      return 'Custom API'
  }
}

export function backendSourceHost(url?: string): string {
  const resolved = url ?? getBackendUrl()
  try {
    return new URL(resolved).host
  } catch {
    return resolved
  }
}

export function backendSourceCaption(url?: string): string {
  const source = resolveBackendSource(url)
  return `Reading ${backendSourceLabel(source)} · ${backendSourceHost(url)}`
}
