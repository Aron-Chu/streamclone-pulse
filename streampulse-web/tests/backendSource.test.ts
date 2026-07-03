import { describe, expect, it } from 'vitest'
import {
  backendSourceCaption,
  backendSourceLabel,
  isEnvLocalBackendDefault,
  resolveBackendSource,
} from '../src/lib/backendSource'
import { DEFAULT_PRODUCTION_BACKEND_URL } from '../src/lib/auth'

describe('backendSource', () => {
  it('defaults to hosted production API', () => {
    expect(resolveBackendSource(DEFAULT_PRODUCTION_BACKEND_URL)).toBe('hosted')
    expect(backendSourceLabel('hosted')).toBe('Hosted corpus')
    expect(backendSourceCaption(DEFAULT_PRODUCTION_BACKEND_URL)).toContain('Hosted corpus')
    expect(backendSourceCaption(DEFAULT_PRODUCTION_BACKEND_URL)).toContain('api.streampulse.stream')
  })

  it('classifies localhost and 127.0.0.1 as local', () => {
    expect(resolveBackendSource('http://localhost:8090')).toBe('local')
    expect(resolveBackendSource('http://127.0.0.1:8090')).toBe('local')
  })

  it('classifies other hosts as custom', () => {
    expect(resolveBackendSource('https://staging.example.com')).toBe('custom')
  })

  it('reports env local default only when VITE_BACKEND_URL is local', () => {
    const envDefault = import.meta.env.VITE_BACKEND_URL?.trim().replace(/\/+$/, '')
    if (envDefault === 'http://localhost:8090') {
      expect(isEnvLocalBackendDefault()).toBe(true)
    } else {
      expect(isEnvLocalBackendDefault()).toBe(false)
    }
  })
})
