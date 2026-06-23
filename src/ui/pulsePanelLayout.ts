import type { PulsePayload } from '../shared/messages.ts'

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
  options: { liveHeatVisible: boolean; warming: boolean; pageIsLive?: boolean },
): PulsePanelSections {
  const backendLive = Boolean(payload?.isLive)
  const pageLive = Boolean(options.pageIsLive)
  const isLive = backendLive || (pageLive && payload !== null)
  const showRecap = Boolean(payload?.recap && !isLive)
  const showMostReacted = isLive && options.liveHeatVisible
  const showWarming = isLive && options.warming && !showMostReacted

  return {
    showLiveStatsBand: isLive,
    showMostReacted,
    showWarming,
    showRecap,
    showOffline: false,
  }
}
