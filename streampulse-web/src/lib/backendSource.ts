import { DEFAULT_PRODUCTION_BACKEND_URL, isLocalDevBackendUrl } from './auth'
import { getBackendUrl } from './apiClient'

export type BackendSource = 'hosted' | 'local' | 'custom'

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** Classify which API the portal is reading (session override wins over env default). */
export function resolveBackendSource(url?: string): BackendSource {
  const resolved = normalizeUrl(url ?? getBackendUrl())
  if (resolved === normalizeUrl(DEFAULT_PRODUCTION_BACKEND_URL)) return 'hosted'
  if (isLocalDevBackendUrl(resolved)) return 'local'
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

/** True when raw Vite env still points at local stack (ignored unless dev:local opt-in). */
export function isEnvLocalBackendDefault(): boolean {
  const envDefault = import.meta.env.VITE_BACKEND_URL?.trim().replace(/\/+$/, '')
  return Boolean(envDefault && isLocalDevBackendUrl(envDefault))
}

export function isNonHostedBackend(url?: string): boolean {
  return resolveBackendSource(url) !== 'hosted'
}

export function localBackendDevCaption(): string {
  return 'Local dev stack — charts and IRC pool differ from public hosted analytics at api.streampulse.stream.'
}
