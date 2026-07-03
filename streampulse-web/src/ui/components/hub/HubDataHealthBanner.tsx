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
  text: `Could not refresh hub data - ${error}. Showing the last loaded snapshot if available.`,
  })
  }

  if (loadSource === 'stats-fallback') {
  messages.push({
  tone: 'warn',
  text: 'Public hub unavailable - showing aggregate stats only. Deploy `/v1/public/hub` on this backend or switch backend in Setup.',
  })
  } else if (hubEndpointOk && activitySummary.pointCount < 2) {
  messages.push({
  tone: 'info',
  text: 'Hub connected but no minute rollups yet - chart fills as IRC collectors write data.',
  })
  }

  if (activitySummary.gapCount > 0) {
  messages.push({
  tone: 'info',
  text: `${activitySummary.gapCount} gap${activitySummary.gapCount === 1 ? '' : 's'} in this window = minutes with no stored rollups (collector downtime or sparse pool).`,
  })
  }

  if (activitySummary.expectedBuckets > 0 && activitySummary.missingBuckets > 0) {
  messages.push({
  tone: 'warn',
  text: `Activity coverage ${activitySummary.pointCount}/${activitySummary.expectedBuckets} buckets (${Math.round(activitySummary.coveragePct)}%) - ${activitySummary.missingBuckets} bucket${activitySummary.missingBuckets === 1 ? '' : 's'} missing from backend rollups.`,
  })
  }

  const pipelineCritical =
    pipeline?.state === 'critical' ||
    (pipeline?.roster.collectorTracking ?? 0) <= 0
  if (pipelineCritical) {
    const tracking = pipeline?.roster.collectorTracking ?? 0
    const expected = Math.max(
      pipeline?.roster.expectedCollectorRows ?? 0,
      pipeline?.collectorMax ?? 0,
    )
    messages.push({
      tone: 'warn',
      text:
        tracking <= 0
          ? 'Partial live IRC coverage — collector admission is limited (0 tracked). Charts and moments reflect tracked channels only.'
          : `Partial live IRC coverage — ${tracking}${expected > 0 ? ` / ${expected}` : ''} Top-${pipeline?.topN ?? 'N'} channels tracked.`,
    })
  }

  messages.push({
  tone: 'info',
  text: 'Live network activity uses backend minute rollups only from the hosted API and IRC worker plane. Imported VOD sessions never fill this global graph.',
  })

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
