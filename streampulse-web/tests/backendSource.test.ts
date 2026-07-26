import { describe, expect, it } from 'vitest'
import {
  backendSourceCaption,
  backendSourceLabel,
  isEnvLocalBackendDefault,
  localBackendDevCaption,
  resolveBackendSource,
} from '../src/lib/backendSource'
import {
  DEFAULT_BACKEND_URL,
  DEFAULT_PRODUCTION_BACKEND_URL,
  isLocalDevBackendUrl,
  resolvePortalDefaultBackendUrl,
} from '../src/lib/auth'

describe('backendSource', () => {
  it('defaults to hosted production API', () => {
    expect(DEFAULT_BACKEND_URL).toBe(DEFAULT_PRODUCTION_BACKEND_URL)
    expect(resolveBackendSource(DEFAULT_PRODUCTION_BACKEND_URL)).toBe('hosted')
    expect(backendSourceLabel('hosted')).toBe('Hosted API')
    expect(backendSourceCaption(DEFAULT_PRODUCTION_BACKEND_URL)).toContain('Hosted API')
    expect(backendSourceCaption(DEFAULT_PRODUCTION_BACKEND_URL)).toContain('api.streampulse.stream')
  })

  it('classifies localhost and 127.0.0.1 as local', () => {
    expect(resolveBackendSource('http://localhost:8081')).toBe('local')
    expect(resolveBackendSource('http://127.0.0.1:8081')).toBe('local')
  })

  it('classifies other hosts as custom', () => {
    expect(resolveBackendSource('https://staging.example.com')).toBe('custom')
  })

  it('never treats portal env default as local without dev:local opt-in', () => {
    expect(isEnvLocalBackendDefault()).toBe(false)
    expect(resolvePortalDefaultBackendUrl({ viteBackendUrl: 'http://localhost:8081', allowLocal: false })).toBe(
      DEFAULT_PRODUCTION_BACKEND_URL,
    )
  })

  it('allows explicit local dev when opt-in flag is set', () => {
    expect(
      resolvePortalDefaultBackendUrl({ viteBackendUrl: 'http://localhost:8081', allowLocal: true }),
    ).toBe('http://localhost:8081')
  })

  it('documents local dev divergence copy', () => {
    expect(localBackendDevCaption()).toContain('api.streampulse.stream')
  })

  it('detects local dev URLs consistently with auth helper', () => {
    expect(isLocalDevBackendUrl('http://localhost:8081')).toBe(true)
    expect(isLocalDevBackendUrl('https://api.streampulse.stream')).toBe(false)
  })
})
