import { describe, expect, it } from 'vitest'
import {
  extensionBackendSourceCaption,
  extensionBackendSourceLabel,
  resolveExtensionBackendSource,
} from '../src/shared/backendSource.ts'
import { DEFAULT_BACKEND_URL } from '../src/shared/storage.ts'

describe('extension backendSource', () => {
  it('defaults to hosted production API', () => {
    expect(resolveExtensionBackendSource(DEFAULT_BACKEND_URL)).toBe('hosted')
    expect(extensionBackendSourceLabel('hosted')).toBe('Hosted corpus')
    expect(extensionBackendSourceCaption(DEFAULT_BACKEND_URL)).toContain('api.streampulse.stream')
  })

  it('classifies localhost as local stack', () => {
    expect(resolveExtensionBackendSource('http://localhost:8090')).toBe('local')
    expect(extensionBackendSourceLabel('local')).toBe('Local stack')
    expect(extensionBackendSourceCaption('http://localhost:8090')).toContain('localhost:8090')
  })

  it('classifies other hosts as custom', () => {
    expect(resolveExtensionBackendSource('https://staging.example.com')).toBe('custom')
    expect(extensionBackendSourceLabel('custom')).toBe('Custom API')
  })
})
