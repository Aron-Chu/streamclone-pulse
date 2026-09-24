import type { ExtensionHealthResponse } from './messages.ts'

export interface ViewerSamplingSummary {
  state: 'unknown' | 'off' | 'warming' | 'ok' | 'error'
  label: string
}

/** Short state label for compact status rows; `label` retains the full detail. */
export function compactViewerSamplingLabel(summary: ViewerSamplingSummary): string {
  switch (summary.state) {
    case 'ok': return 'Active'
    case 'warming': return 'Warming up'
    case 'off': return 'Off'
    case 'error': return 'Error'
    default: return 'Unavailable'
  }
}

export function displayBackendVersion(version?: string): string {
  const normalized = String(version ?? '').trim()
  if (!normalized) return 'unknown version'
  return normalized.startsWith('v') ? normalized : `v${normalized}`
}

/** Display the backend's declared deployment mode without guessing from the URL. */
export function displayBackendMode(hostedMode?: boolean): string {
  if (hostedMode === true) return 'Hosted mode'
  if (hostedMode === false) return 'Local mode'
  return 'Mode unknown'
}

/** Aggregate-only health copy; never infers per-channel samples from Helix metadata. */
export function summarizeViewerSampling(
  sampler?: ExtensionHealthResponse['viewerSampling'],
): ViewerSamplingSummary {
  if (!sampler) {
    return {
      state: 'unknown',
      label: 'Viewer sampling unavailable in this backend build',
    }
  }
  if (!sampler.enabled) {
    return { state: 'off', label: 'Viewer sampling is off' }
  }
  if (sampler.lastResult === 'error' || sampler.consecutiveFailures > 0) {
    const suffix = sampler.consecutiveFailures > 0
      ? ` · ${sampler.consecutiveFailures} consecutive failure${sampler.consecutiveFailures === 1 ? '' : 's'}`
      : ''
    return { state: 'error', label: `Viewer sampler error${suffix}` }
  }
  if (sampler.lastResult === 'empty') {
    return { state: 'warming', label: 'Viewer sampler active · no tracked live streams' }
  }
  if (!sampler.lastSampleAt) {
    return { state: 'warming', label: 'Viewer sampler starting' }
  }
  const written = Math.max(0, sampler.streamsWritten)
  const age = sampler.lastSampleAgeSeconds
  const ageLabel = typeof age === 'number' && Number.isFinite(age)
    ? ` · last write ${Math.max(0, Math.round(age))}s ago`
    : ''
  return {
    state: 'ok',
    label: `Viewer sampler active · ${written} stream${written === 1 ? '' : 's'} written${ageLabel}`,
  }
}
