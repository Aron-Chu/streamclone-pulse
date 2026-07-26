import type { PulsePayload } from '../shared/messages.ts'

export interface LastStreamPeakStats {
  peakViewers: number
  peakChatPerMin: number
  peakEmotePerMin: number
}

/** Peak minute rates for ended streams (VOD sidebar). */
export function lastStreamPeakStats(payload: PulsePayload): LastStreamPeakStats | null {
  const rollups = (payload.fullRollups?.length ?? 0) > 0 ? payload.fullRollups! : payload.rollups
  if (rollups.length === 0) return null

  let peakChatPerMin = 0
  let peakEmotePerMin = 0
  for (const rollup of rollups) {
    peakChatPerMin = Math.max(peakChatPerMin, rollup.chatCount ?? 0)
    peakEmotePerMin = Math.max(
      peakEmotePerMin,
      rollup.totalEmoteCount ?? rollup.sevenTvEmoteCount ?? 0,
    )
  }

  return {
    peakViewers: payload.peakViewers ?? 0,
    peakChatPerMin,
    peakEmotePerMin: payload.peakEmotePerMin ?? peakEmotePerMin,
  }
}
