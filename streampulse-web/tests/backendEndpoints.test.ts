import { describe, expect, it } from 'vitest'
import {
  DEV_BACKEND_ENDPOINTS,
  devBackendSessionOverrideForPreset,
  normalizeBackendEndpointUrl,
  resolveDevBackendEndpointId,
} from '../src/lib/backendEndpoints'
import { DEFAULT_PRODUCTION_BACKEND_URL } from '../src/lib/auth'

describe('backendEndpoints', () => {
  it('defines hosted production and local stack presets', () => {
    expect(DEV_BACKEND_ENDPOINTS).toHaveLength(2)
    expect(DEV_BACKEND_ENDPOINTS[0]?.url).toBe(DEFAULT_PRODUCTION_BACKEND_URL)
    expect(DEV_BACKEND_ENDPOINTS[1]?.url).toBe('http://localhost:8090')
  })

  it('resolves localhost variants to local preset', () => {
    expect(resolveDevBackendEndpointId('http://localhost:8090')).toBe('local')
    expect(resolveDevBackendEndpointId('http://127.0.0.1:8090/')).toBe('local')
  })

  it('maps hosted preset to cleared session override', () => {
    expect(devBackendSessionOverrideForPreset('hosted')).toBeNull()
    expect(devBackendSessionOverrideForPreset('local')).toBe('http://localhost:8090')
  })

  it('normalizes trailing slashes', () => {
    expect(normalizeBackendEndpointUrl('https://api.streampulse.stream/')).toBe(
      DEFAULT_PRODUCTION_BACKEND_URL,
    )
  })
})
