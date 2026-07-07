export interface CommandCenterLabels {
  hubTitle: string
  hubEyebrow: string
  hubLede: string
  overview: string
  liveRail: string
  liveActivity: string
  pulseMoments: string
  emoteSignal: string
  trackedChannels: string
  coverage: string
  inspector: string
  liveFeedActive: string
  searchPlaceholder: string
  apiStatus: string
}

export const COMMAND_CENTER_LABELS: CommandCenterLabels = {
  hubTitle: 'Command center',
  hubEyebrow: 'Stream intelligence',
  hubLede:
    'Live IRC pool status, current viewer totals, and network peaks from tracked channels — not all of Twitch.',
  overview: 'Overview',
  liveRail: 'Featured live channels',
  liveActivity: 'Live Activity',
  pulseMoments: 'Pulse Moments',
  emoteSignal: 'Emote Signal',
  trackedChannels: 'Tracked Channels',
  coverage: 'Coverage',
  inspector: 'Moment Inspector',
  liveFeedActive: 'Live feed active',
  searchPlaceholder: 'Search channels…',
  apiStatus: 'Live',
}

export function sidebarLabelFor(
  sectionId: string,
  labels: CommandCenterLabels,
  fallback: string,
): string {
  const map: Record<string, keyof CommandCenterLabels> = {
    'section-overview': 'overview',
    'section-live-rail': 'liveRail',
    'section-network': 'liveActivity',
    'section-pulse-moments': 'pulseMoments',
    'section-emote-signal': 'emoteSignal',
    'section-tracked': 'trackedChannels',
    'section-coverage': 'coverage',
  }
  const key = map[sectionId]
  return key ? labels[key] : fallback
}
