import { formatMomentActivityLine, type LiveHeatPoint } from '@streamclone/pulse-core'
import { formatCount } from './mostReacted.ts'

export function formatMomentMetricsLine(
  point: Pick<LiveHeatPoint, 'chatCount' | 'emoteCount' | 'viewerCount'>,
): string {
  const parts: string[] = []
  const viewers = point.viewerCount ?? 0
  const chat = point.chatCount ?? 0
  const emotes = point.emoteCount ?? 0
  if (viewers > 0) parts.push(`${formatCount(viewers)} viewers`)
  if (chat > 0) parts.push(`${formatCount(chat)} chat`)
  if (emotes > 0) parts.push(`${formatCount(emotes)} emotes`)
  if (parts.length === 0) return '0 chat · 0 emotes'
  return parts.join(' · ')
}

export function formatSelectedMomentActivity(point: Pick<
  LiveHeatPoint,
  'reason' | 'chatCount' | 'emoteCount' | 'viewerCount' | 'viewerDelta'
>): string {
  return formatMomentMetricsLine(point)
}

export function momentShowsViewerActivity(point: Pick<
  LiveHeatPoint,
  'reason' | 'chatCount' | 'emoteCount' | 'viewerCount'
>): boolean {
  const chat = point.chatCount ?? 0
  const emotes = point.emoteCount ?? 0
  const viewers = point.viewerCount ?? 0
  return point.reason === 'viewer_spike' || (chat + emotes === 0 && viewers > 0)
}
