import { sendBackgroundMessage } from '../content/bridge.ts'
import { openHubAnalytics } from '../shared/analyticsLinks.ts'

/** The worker opens the website's page: no page links ship in the content script. */
export const openCommunity = (link: 'discord' | 'feedback') => void sendBackgroundMessage({ type: 'OPEN_COMMUNITY_LINK', link })

export interface AnalyticsHubCtaProps {
  backendUrl: string
  compact?: boolean
}

/**
 * The Hub button, with Discord beside it so it shows every time Pulse opens.
 * Its spacing and label type live in the shadow stylesheet (theme.ts).
 */
export function AnalyticsHubCta({ backendUrl, compact = false }: AnalyticsHubCtaProps) {
  return (
    <div className="pulse-hub-row" data-compact={compact || undefined}>
      <button
        type="button"
        className="pulse-analytics-hub-cta"
        data-pulse-hub-cta="true"
        aria-label="Open analytics hub"
        title="Browse full stream history, tracked channels, and deeper analytics"
        onClick={() => openHubAnalytics(backendUrl)}
      >
        <span>Open Analytics Hub →</span>
      </button>
      <button type="button" className="pulse-hub-discord" data-community-link="discord" onClick={() => openCommunity('discord')}>
        Discord
      </button>
    </div>
  )
}
