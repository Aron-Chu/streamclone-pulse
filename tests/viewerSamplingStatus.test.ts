import { describe, expect, it } from 'vitest'
import { displayBackendMode, displayBackendVersion, summarizeViewerSampling } from '../src/shared/viewerSamplingStatus.ts'

describe('viewer sampling health copy', () => {
  it('does not double-prefix backend versions', () => {
    expect(displayBackendVersion('v0.2.28')).toBe('v0.2.28')
    expect(displayBackendVersion('0.2.29')).toBe('v0.2.29')
  })

  it('surfaces the backend deployment mode instead of inferring it from the URL', () => {
    expect(displayBackendMode(true)).toBe('Hosted mode')
    expect(displayBackendMode(false)).toBe('Local mode')
    expect(displayBackendMode()).toBe('Mode unknown')
  })

  it('distinguishes an old backend from an explicitly disabled sampler', () => {
    expect(summarizeViewerSampling()).toEqual({
      state: 'unknown',
      label: 'Viewer sampling unavailable in this backend build',
    })
    expect(summarizeViewerSampling({
      enabled: false,
      streamsWritten: 0,
      consecutiveFailures: 0,
    }).state).toBe('off')
  })

  it('reports active writes and failures without channel identity', () => {
    expect(summarizeViewerSampling({
      enabled: true,
      lastSampleAt: 1,
      lastSampleAgeSeconds: 12,
      streamsWritten: 2,
      lastResult: 'success',
      consecutiveFailures: 0,
    }).label).toBe('Viewer sampler active · 2 streams written · last write 12s ago')

    expect(summarizeViewerSampling({
      enabled: true,
      streamsWritten: 0,
      lastResult: 'error',
      consecutiveFailures: 3,
    }).label).toContain('3 consecutive failures')
  })
})
