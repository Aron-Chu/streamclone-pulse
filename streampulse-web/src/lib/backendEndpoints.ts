import { DEFAULT_PRODUCTION_BACKEND_URL } from './auth'

export interface DevBackendEndpoint {
  id: 'hosted' | 'local'
  label: string
  shortLabel: string
  url: string
  description: string
}

const LOCAL_DEV_BACKEND_URL = import.meta.env.DEV
  ? `http://localhost:${String(8090)}`
  : ''

/** Preset API bases for Vite dev (:5173). Production builds only embed hosted URLs. */
export const DEV_BACKEND_ENDPOINTS: readonly DevBackendEndpoint[] = import.meta.env.DEV
  ? [
      {
        id: 'hosted',
        label: 'Hosted production',
        shortLabel: 'Production',
        url: DEFAULT_PRODUCTION_BACKEND_URL,
        description: 'streampulse-vps IRC worker + corpus (api.streampulse.stream)',
      },
      {
        id: 'local',
        label: 'Local Streamclone stack',
        shortLabel: 'Local :8090',
        url: LOCAL_DEV_BACKEND_URL,
        description: 'Caddy on localhost:8090 from `make up` in streamclone',
      },
    ]
  : [
      {
        id: 'hosted',
        label: 'Hosted production',
        shortLabel: 'Production',
        url: DEFAULT_PRODUCTION_BACKEND_URL,
        description: 'streampulse-vps IRC worker + corpus (api.streampulse.stream)',
      },
    ]

export type DevBackendEndpointId = (typeof DEV_BACKEND_ENDPOINTS)[number]['id']

export function normalizeBackendEndpointUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function resolveDevBackendEndpointId(url: string): DevBackendEndpointId | 'custom' {
  const normalized = normalizeBackendEndpointUrl(url)
  for (const preset of DEV_BACKEND_ENDPOINTS) {
    if (normalizeBackendEndpointUrl(preset.url) === normalized) {
      return preset.id
    }
  }
  if (import.meta.env.DEV && normalized === `http://127.0.0.1:${String(8090)}`) {
    return 'local'
  }
  return 'custom'
}

export function devBackendEndpointById(id: DevBackendEndpointId): DevBackendEndpoint {
  return DEV_BACKEND_ENDPOINTS.find((entry) => entry.id === id) ?? DEV_BACKEND_ENDPOINTS[0]
}

/** Session override value: null clears override so env default applies (hosted in dev). */
export function devBackendSessionOverrideForPreset(id: DevBackendEndpointId): string | null {
  return id === 'hosted' ? null : devBackendEndpointById(id).url
}
