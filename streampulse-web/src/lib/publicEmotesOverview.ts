import { apiClient } from './apiClient'

export type PublicEmotesOverviewState = 'ready' | 'degraded' | 'empty' | 'unavailable' | string

export interface PublicProviderSummaryPreview {
  provider: string
  sharePct: number
  totalUses: number
  trackedMinutes: number
  coveragePct: number
  confidence: number
}

export interface PublicCreatorLeaderboardPreviewRow {
  login: string
  displayName: string
  metricLabel: string
  metricValue: string
  trackedMinutes: number
  coveragePct: number
  confidence: number
  placeholder: boolean
}

export interface PublicRisingEmotePreviewRow {
  emoteKey: string
  name: string
  provider: string
  trendLabel: string
  trendValue: string
  trackedMinutes: number
  coveragePct: number
  confidence: number
  placeholder: boolean
}

export interface PublicEmotesSuppressionRules {
  mode: string
  minimumTrackedMinutes: number
  minimumCoveragePct: number
  minimumConfidencePct: number
  minimumTotalUses: number
  suppressedWhenCoverageLow: boolean
}

export interface PublicEmotesOverview {
  range: string
  generatedAt: string
  schemaVersion: string
  state: PublicEmotesOverviewState
  degraded: boolean
  stalenessSec: number
  trackedMinutes: number
  coveragePct: number
  confidence: number
  aggregateOnly: boolean
  providerSummaryPreview: PublicProviderSummaryPreview[]
  creatorLeaderboardPreview: PublicCreatorLeaderboardPreviewRow[]
  risingEmotePreview: PublicRisingEmotePreviewRow[]
  suppressionRules: PublicEmotesSuppressionRules
  unavailableReason?: string
}

export function normalizePublicEmotesOverview(raw: Partial<PublicEmotesOverview> | null | undefined): PublicEmotesOverview {
  const suppression: Partial<PublicEmotesSuppressionRules> = raw?.suppressionRules ?? {}
  return {
    range: raw?.range ?? '7d',
    generatedAt: raw?.generatedAt ?? new Date(0).toISOString(),
    schemaVersion: raw?.schemaVersion ?? 'ph3-auto-002b',
    state: raw?.state ?? 'empty',
    degraded: Boolean(raw?.degraded),
    stalenessSec: Number(raw?.stalenessSec ?? 0),
    trackedMinutes: Number(raw?.trackedMinutes ?? 0),
    coveragePct: Number(raw?.coveragePct ?? 0),
    confidence: Number(raw?.confidence ?? 0),
    aggregateOnly: raw?.aggregateOnly === true,
    providerSummaryPreview: Array.isArray(raw?.providerSummaryPreview) ? raw.providerSummaryPreview : [],
    creatorLeaderboardPreview: Array.isArray(raw?.creatorLeaderboardPreview) ? raw.creatorLeaderboardPreview : [],
    risingEmotePreview: Array.isArray(raw?.risingEmotePreview) ? raw.risingEmotePreview : [],
    suppressionRules: {
      mode: suppression.mode ?? 'suppress_below_minimums',
      minimumTrackedMinutes: Number(suppression.minimumTrackedMinutes ?? 300),
      minimumCoveragePct: Number(suppression.minimumCoveragePct ?? 60),
      minimumConfidencePct: Number(suppression.minimumConfidencePct ?? 60),
      minimumTotalUses: Number(suppression.minimumTotalUses ?? 100),
      suppressedWhenCoverageLow: suppression.suppressedWhenCoverageLow !== false,
    },
    unavailableReason: raw?.unavailableReason,
  }
}

export async function fetchPublicEmotesOverview(range = '7d', signal?: AbortSignal): Promise<PublicEmotesOverview> {
  const params = new URLSearchParams({ range })
  try {
    const { data } = await apiClient<PublicEmotesOverview>(`/v1/public/emotes/overview?${params.toString()}`, { signal })
    return normalizePublicEmotesOverview(data)
  } catch (err) {
    const status = err && typeof err === 'object' && 'status' in err ? Number((err as { status: number }).status) : 0
    if (status === 404 || status === 503) {
      return normalizePublicEmotesOverview({
        range,
        state: 'unavailable',
        unavailableReason: status === 404 ? 'route_not_deployed' : 'public_emotes_overview_unavailable',
        aggregateOnly: true,
      })
    }
    throw err
  }
}
