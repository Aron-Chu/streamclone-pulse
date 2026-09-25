import type { PulsePayload } from '../shared/messages.ts'
import { pulseLiveAccessAllowsChart, type PulseLiveAccessState } from './resolvePulseLiveAccess.ts'

export interface PulsePanelSections {
  surfaceState: PulsePanelSurfaceState
  showLiveStatsBand: boolean
  showMostReacted: boolean
  showWarming: boolean
  showRecap: boolean
  showOffline: boolean
}

/**
 * Exhaustive top-level states for the Pulse body. Keeping this separate from
 * the individual section booleans prevents a valid payload from falling
 * through to a blank panel when a stream is offline or a request fails.
 */
export type PulsePanelSurfaceState =
  | 'loading'
  | 'error'
  | 'identity_mismatch'
  | 'unsupported'
  | 'live_tracked'
  | 'live_late'
  | 'live_untracked'
  | 'offline_recap'
  | 'offline_empty'

export interface PulsePanelSurfaceInput {
  payload: PulsePayload | null
  error?: string | null
  pageIsLive?: boolean
  pulseLiveAccess?: PulseLiveAccessState
  pulseSupported?: boolean
}

const IDENTITY_MISMATCH_PATTERN = /(?:broadcaster|stream|channel|identity)[-_ ]?(?:mismatch|changed|unknown)|\bmismatch\b/i

/** API resolution errors that must never be allowed to repaint another stream. */
export function isPulseIdentityMismatch(value: string | null | undefined): boolean {
  return Boolean(value && IDENTITY_MISMATCH_PATTERN.test(value))
}

function payloadIsLive(payload: PulsePayload | null, pageIsLive: boolean): boolean {
  if (!payload) return pageIsLive
  if (payload.recap && !payload.isLive) return false
  return Boolean(payload.isLive || pageIsLive)
}

export function resolvePulsePanelSurfaceState({
  payload,
  error = null,
  pageIsLive = false,
  pulseLiveAccess,
  pulseSupported = true,
}: PulsePanelSurfaceInput): PulsePanelSurfaceState {
  if (!payload) return error ? 'error' : 'loading'
  if (isPulseIdentityMismatch(payload.resolutionState) || isPulseIdentityMismatch(error)) {
    return 'identity_mismatch'
  }
  if (!pulseSupported) return 'unsupported'

  const isLive = payloadIsLive(payload, pageIsLive)
  if (isLive) {
    if (pulseLiveAccess === 'full_live') return 'live_tracked'
    if (pulseLiveAccess === 'late_session') return 'live_late'
    return 'live_untracked'
  }
  return payload.recap ? 'offline_recap' : 'offline_empty'
}

export function pulseSurfaceStatusLabel(state: PulsePanelSurfaceState): string {
  switch (state) {
    case 'loading': return 'Loading'
    case 'error': return 'Unavailable'
    case 'identity_mismatch': return 'Stream changed'
    case 'unsupported': return 'Limited roster'
    case 'live_tracked': return 'Live chart'
    case 'live_late': return 'Joined late'
    case 'live_untracked': return 'Not tracked'
    case 'offline_recap': return 'Replay ready'
    case 'offline_empty': return 'Offline'
  }
}

/** Match Streamclone web StreamPulsePanel: live band + Most Reacted; recap only after stream ends. */
export function resolvePulsePanelSections(
  payload: PulsePayload | null,
  options: {
    liveHeatVisible: boolean
    warming: boolean
    pageIsLive?: boolean
    pulseLiveAccess?: PulseLiveAccessState
    error?: string | null
    pulseSupported?: boolean
  },
): PulsePanelSections {
  const backendLive = Boolean(payload?.isLive)
  const pageLive = Boolean(options.pageIsLive)
  const collecting = Boolean(payload?.tracking)
  const fullLiveAccess = options.pulseLiveAccess
    ? pulseLiveAccessAllowsChart(options.pulseLiveAccess)
    : collecting
  const hasFinishedRecap = Boolean(payload?.recap && !payload?.isLive)
  const isLive = hasFinishedRecap
    ? false
    : backendLive || (pageLive && payload !== null)
  const showRecap = Boolean(payload?.recap && !isLive)
  const surfaceState = resolvePulsePanelSurfaceState({
    payload,
    error: options.error,
    pageIsLive: options.pageIsLive,
    pulseLiveAccess: options.pulseLiveAccess,
    pulseSupported: options.pulseSupported ?? true,
  })
  const identityMismatch = surfaceState === 'identity_mismatch'
  const showMostReacted = isLive && fullLiveAccess && options.liveHeatVisible && !identityMismatch
  const showWarming = isLive && !showMostReacted && (options.warming || !fullLiveAccess)

  return {
    surfaceState,
    showLiveStatsBand: isLive && fullLiveAccess && !identityMismatch,
    showMostReacted,
    showWarming,
    showRecap,
    showOffline: surfaceState === 'offline_empty',
  }
}
