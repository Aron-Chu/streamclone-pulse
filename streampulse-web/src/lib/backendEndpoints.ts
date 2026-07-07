import { DEFAULT_PRODUCTION_BACKEND_URL } from './auth'

export interface DevBackendEndpoint {
  id: 'hosted'
  label: string
  shortLabel: string
  url: string
  description: string
}

/** Portal dev always reads hosted production — no localhost :8090 preset. */
export const DEV_BACKEND_ENDPOINTS: readonly DevBackendEndpoint[] = [
  {
    id: 'hosted',
    label: 'Hosted production',
    shortLabel: 'Production',
    url: DEFAULT_PRODUCTION_BACKEND_URL,
    description: 'streampulse-vps IRC worker + corpus (api.streampulse.stream)',
  },
]

export type DevBackendEndpointId = DevBackendEndpoint['id']

export function normalizeBackendEndpointUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function resolveDevBackendEndpointId(url: string): DevBackendEndpointId | 'custom' {
  const normalized = normalizeBackendEndpointUrl(url)
  if (normalizeBackendEndpointUrl(DEFAULT_PRODUCTION_BACKEND_URL) === normalized) {
    return 'hosted'
  }
  return 'custom'
}

export function devBackendEndpointById(id: DevBackendEndpointId): DevBackendEndpoint {
  return DEV_BACKEND_ENDPOINTS.find((entry) => entry.id === id) ?? DEV_BACKEND_ENDPOINTS[0]
}

/** Session override value: null clears override so hosted env default applies. */
export function devBackendSessionOverrideForPreset(_id: DevBackendEndpointId): string | null {
  return null
}
