import { momentScoreReasonLabel } from '@streamclone/pulse-core'
import type { ExtensionEmote, ExtensionPeak } from '../shared/messages.ts'

export function peakReasonLabel(peak: ExtensionPeak): string {
  if (peak.reasonLabel?.trim()) return peak.reasonLabel.trim()
  return momentScoreReasonLabel(peak.reasons[0] ?? '')
}

export function peakChatCount(peak: ExtensionPeak): number {
  return peak.chatCount ?? 0
}

export function peakEmoteCount(peak: ExtensionPeak): number {
  return peak.emoteCount ?? 0
}

export function peakEmoteKey(emote: ExtensionEmote, index: number): string {
  return emote.id ?? `${emote.name}-${emote.provider ?? 'unknown'}-${index}`
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}
