import type { DiscoveryDay } from './discoveryCatalogue'

export function discoveryDayLabel(d: DiscoveryDay) {
  if (d.state === 'future') return `${d.day}: future day`
  if (d.state === 'no_measurement') return `${d.day}: no indexed measurements; not a measured zero`
  return `${d.day}: ${d.chatMessages?.toLocaleString()} measured chat messages, ${d.detections?.toLocaleString()} detections across ${d.streams} indexed broadcasts; ${d.emoteUses?.toLocaleString()} measured emote uses; partial coverage`
}
