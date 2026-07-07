import type { PulsePayload } from '../shared/messages.ts'
import { pulseLiveAccessAllowsChart, type PulseLiveAccessState } from './resolvePulseLiveAccess.ts'

export interface PulsePanelSections {
  showLiveStatsBand: boolean
  showMostReacted: boolean
  showWarming: boolean
  showRecap: boolean
  showOffline: boolean
}

/** Match Streamclone web StreamPulsePanel: live band + Most Reacted; recap only after stream ends. */
export function resolvePulsePanelSections(
  payload: PulsePayload | null,
  options: {
    liveHeatVisible: boolean
    warming: boolean
    pageIsLive?: boolean
    pulseLiveAccess?: PulseLiveAccessState
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
  const showMostReacted = isLive && fullLiveAccess && options.liveHeatVisible
  const showWarming = isLive && !showMostReacted && (options.warming || !fullLiveAccess)

  return {
    showLiveStatsBand: isLive && fullLiveAccess,
    showMostReacted,
    showWarming,
    showRecap,
    showOffline: false,
  }
}
