import { describe, expect, it } from 'vitest'
import {
  DEV_BACKEND_ENDPOINTS,
  devBackendSessionOverrideForPreset,
  normalizeBackendEndpointUrl,
  resolveDevBackendEndpointId,
} from '../src/lib/backendEndpoints'
import { DEFAULT_PRODUCTION_BACKEND_URL } from '../src/lib/auth'

describe('backendEndpoints', () => {
  it('defines hosted production preset only (no local :8090)', () => {
    expect(DEV_BACKEND_ENDPOINTS).toHaveLength(1)
    expect(DEV_BACKEND_ENDPOINTS[0]?.url).toBe(DEFAULT_PRODUCTION_BACKEND_URL)
  })

  it('treats localhost as custom, not a portal preset', () => {
    expect(resolveDevBackendEndpointId('http://localhost:8081')).toBe('custom')
    expect(resolveDevBackendEndpointId('http://127.0.0.1:8081/')).toBe('custom')
    expect(resolveDevBackendEndpointId(DEFAULT_PRODUCTION_BACKEND_URL)).toBe('hosted')
  })

  it('maps hosted preset to cleared session override', () => {
    expect(devBackendSessionOverrideForPreset('hosted')).toBeNull()
  })

  it('normalizes trailing slashes', () => {
    expect(normalizeBackendEndpointUrl('https://api.streampulse.stream/')).toBe(
      DEFAULT_PRODUCTION_BACKEND_URL,
    )
  })
})
