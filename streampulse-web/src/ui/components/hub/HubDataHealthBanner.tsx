import { AlertTriangle, Info } from 'lucide-react'
import type { HubCorpusPipeline } from '../../../lib/publicHub'
import type { PublicHubLoadSource } from '../../../lib/publicHub'
import { backendSourceCaption } from '../../../lib/backendSource'
import type { ActivitySummary } from '../../../lib/hubActivitySummary'

export interface HubDataHealthBannerProps {
  loadSource: PublicHubLoadSource
  hubEndpointOk: boolean
  activitySummary: ActivitySummary
  pipeline?: HubCorpusPipeline
  liveRosterCount: number
  error?: string | null
  backendUrl?: string
}

function tierIdle(tier: HubCorpusPipeline['silver']): boolean {
  return tier.total === 0 && tier.queued === 0 && tier.running === 0
}

export function HubDataHealthBanner({
  loadSource,
  hubEndpointOk,
  activitySummary,
  pipeline,
  liveRosterCount,
  error,
  backendUrl,
}: HubDataHealthBannerProps) {
  const messages: Array<{ tone: 'warn' | 'info'; text: string }> = []

  if (error) {
    messages.push({
      tone: 'warn',
      text: `Could not refresh hub data — ${error}. Showing the last loaded snapshot if available.`,
    })
  }

  if (loadSource === 'readiness-fallback') {
    messages.push({
      tone: 'warn',
      text: 'Hub chart unavailable — using roster snapshot only. Deploy `/v1/public/hub` on this backend or switch backend in Setup.',
    })
  } else if (hubEndpointOk && activitySummary.pointCount < 2) {
    messages.push({
      tone: 'info',
      text: 'Hub connected but no minute rollups yet — chart fills as IRC collectors write data.',
    })
  }

  if (activitySummary.gapCount > 0) {
    messages.push({
      tone: 'info',
      text: `${activitySummary.gapCount} gap${activitySummary.gapCount === 1 ? '' : 's'} in this window = minutes with no stored rollups (collector downtime or sparse pool).`,
    })
  }

  if (
    pipeline &&
    liveRosterCount > 0 &&
    tierIdle(pipeline.silver) &&
    tierIdle(pipeline.gold)
  ) {
    messages.push({
      tone: 'info',
      text: 'VOD/Gold queues idle is normal; live IRC is separate.',
    })
  }

  if (messages.length === 0) return null

  const caption = backendSourceCaption(backendUrl)

  return (
    <div className="hx-health-banner" role="status" aria-live="polite">
      {messages.map((message, index) => {
        const Icon = message.tone === 'warn' ? AlertTriangle : Info
        return (
          <div
            key={index}
            className={`hx-health-banner__row hx-health-banner__row--${message.tone}`}
          >
            <Icon aria-hidden="true" size={16} />
            <span>{message.text}</span>
          </div>
        )
      })}
      <div className="hx-health-banner__caption muted">{caption}</div>
    </div>
  )
}
