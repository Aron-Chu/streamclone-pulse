export interface CommandCenterLabels {
  hubTitle: string
  hubEyebrow: string
  hubLede: string
  overview: string
  liveRail: string
  /** Chart / global activity section. */
  networkActivity: string
  /**
   * @deprecated Use networkActivity. Kept briefly for call-site migration; value is Global activity.
   */
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
  liveRail: 'Hottest live',
  // Chart section title — lifecycle feed is titled "Live Activity" in LiveActivityPanel.
  networkActivity: 'Global activity',
  liveActivity: 'Global activity',
  pulseMoments: 'Pulse Moments',
  emoteSignal: 'Emote Market',
  trackedChannels: 'Channel Screener',
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
    'section-network': 'networkActivity',
    'section-pulse-moments': 'pulseMoments',
    'section-emote-signal': 'emoteSignal',
    'section-tracked': 'trackedChannels',
    'section-coverage': 'coverage',
  }
  const key = map[sectionId]
  return key ? labels[key] : fallback
}
