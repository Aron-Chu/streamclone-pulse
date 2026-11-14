import type { LiveHeatPoint } from '@streampulse/pulse-core'
import { formatCount } from './mostReacted.ts'

/** A moment's minute, as the site writes it: '44.7K viewers · 1,204 chat/min · 340 emotes/min' (Z09). */
export function formatMomentMetricsLine(point: Pick<LiveHeatPoint, 'chatCount' | 'emoteCount' | 'viewerCount'>): string {
  return momentMetricsParts(point).join(' · ')
}

/** The same line's figures, viewers first; a narrow list row drops them from the front (item 4). */
export function momentMetricsParts(point: Pick<LiveHeatPoint, 'chatCount' | 'emoteCount' | 'viewerCount'>): string[] {
  const parts: string[] = []
  const viewers = point.viewerCount ?? 0
  const chat = point.chatCount ?? 0
  const emotes = point.emoteCount ?? 0
  if (viewers > 0) parts.push(`${formatCount(viewers)} viewers`)
  if (chat > 0) parts.push(`${formatCount(chat)} chat/min`)
  if (emotes > 0) parts.push(`${formatCount(emotes)} emotes/min`)
  return parts.length ? parts : ['0 chat/min', '0 emotes/min']
}
