import type { ExtensionRollup } from '../shared/messages.ts'
import { minuteEmoteTotal } from './chartRollupUtils.ts'

export interface ChartReadoutValues {
  offsetSeconds: number
  viewerCount: number | null
  chatCount: number
  emoteCount: number
  missing?: boolean
}

export function chartReadoutValues(
  rollup: ExtensionRollup | null | undefined,
): ChartReadoutValues | null {
  if (!rollup) return null
  const values: ChartReadoutValues = {
    offsetSeconds: rollup.offsetSeconds,
    viewerCount: rollup.viewerCount == null ? null : Math.max(0, rollup.viewerCount),
    chatCount: Math.max(0, rollup.chatCount ?? 0),
    emoteCount: Math.max(0, minuteEmoteTotal(rollup)),
  }
  if (rollup.missing) values.missing = true
  return values
}
