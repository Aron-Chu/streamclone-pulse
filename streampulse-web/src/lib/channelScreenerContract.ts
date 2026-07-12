/**
 * Channel Screener view contract (P2).
 * Acceleration / divergence / anomaly reason require backend-owned fields.
 * Never invent these from client poll history or local scoring.
 */

export type ChannelScreenerView = 'overview' | 'momentum' | 'coverage' | 'anomalies'

export interface HubChannelScreenerFields {
  chatAcceleration?: number
  emoteAcceleration?: number
  viewerChatDivergence?: number
  anomalyReason?: string
  newlyLive?: boolean
  dataFreshnessAt?: string
}

/** Client-invented keys that must never appear on a server screener payload. */
const REJECT_CLIENT_INVENTED_KEYS = [
  'pulseScore',
  'clientScore',
  'localAcceleration',
  'derivedAnomaly',
  'computedMomentum',
] as const

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Normalize backend-owned screener fields. Returns null for hostile/malformed
 * payloads (wrong types, client-invented scoring keys, or empty objects).
 */
export function normalizeHubChannelScreenerFields(
  raw: unknown,
): HubChannelScreenerFields | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>

  for (const key of REJECT_CLIENT_INVENTED_KEYS) {
    if (key in row) return null
  }

  const out: HubChannelScreenerFields = {}
  let hasServerField = false

  if ('chatAcceleration' in row) {
    const n = finiteNumber(row.chatAcceleration)
    if (n == null) return null
    out.chatAcceleration = n
    hasServerField = true
  }
  if ('emoteAcceleration' in row) {
    const n = finiteNumber(row.emoteAcceleration)
    if (n == null) return null
    out.emoteAcceleration = n
    hasServerField = true
  }
  if ('viewerChatDivergence' in row) {
    const n = finiteNumber(row.viewerChatDivergence)
    if (n == null) return null
    out.viewerChatDivergence = n
    hasServerField = true
  }
  if ('anomalyReason' in row) {
    if (typeof row.anomalyReason !== 'string') return null
    const reason = row.anomalyReason.trim()
    if (!reason) return null
    out.anomalyReason = reason
    hasServerField = true
  }
  if ('newlyLive' in row) {
    if (typeof row.newlyLive !== 'boolean') return null
    out.newlyLive = row.newlyLive
    hasServerField = true
  }
  if ('dataFreshnessAt' in row) {
    if (typeof row.dataFreshnessAt !== 'string') return null
    const at = row.dataFreshnessAt.trim()
    if (!at) return null
    out.dataFreshnessAt = at
    hasServerField = true
  }

  return hasServerField ? out : null
}

export function screenerViewLabel(view: ChannelScreenerView): string {
  switch (view) {
    case 'overview':
      return 'Overview'
    case 'momentum':
      return 'Momentum'
    case 'coverage':
      return 'Coverage'
    case 'anomalies':
      return 'Anomalies'
  }
}
