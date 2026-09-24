/** Presentation policy only. BFF authorization remains authoritative for equip/publication. */
export const SUPPORTER_FEATURES = ['supporter.banner.v1', 'supporter.finish.v1', 'supporter.recognition.v1', 'supporter.chat_badge.v1'] as const
export type SupporterFeature = typeof SUPPORTER_FEATURES[number]
export interface SupporterScope { accountId: string; environment: 'sandbox' | 'live' }
export interface SupporterAccessSnapshot extends SupporterScope {
  schemaVersion: 1
  revision: number
  status: 'active' | 'grace' | 'pending' | 'expired' | 'review'
  serverTime: string
  accessFrom: string
  accessUntil: string
  cacheUntil: string
  features: Partial<Record<SupporterFeature, boolean>>
}
export type SupporterAccessDecision = 'allowed' | 'unavailable' | 'wrong-account' | 'expired' | 'disabled'

/** Validate untrusted storage/API data before UI use. elapsedMs must be measured
 * by the worker's monotonic clock since receipt; invalidate on worker restart
 * until a trusted wall-clock continuity check or a fresh server response exists.
 * Neither this function nor a cached boolean supplies server authorization.
 */
export function supporterAccess(raw: unknown, scope: SupporterScope, feature: SupporterFeature, elapsedMs: number, released: boolean): SupporterAccessDecision {
  if (!released || !SUPPORTER_FEATURES.includes(feature)) return 'disabled'
  if (!raw || typeof raw !== 'object' || !Number.isFinite(elapsedMs) || elapsedMs < 0) return 'unavailable'
  const s = raw as Partial<SupporterAccessSnapshot>
  if (!scope.accountId || !['sandbox', 'live'].includes(scope.environment) || s.accountId !== scope.accountId || s.environment !== scope.environment) return 'wrong-account'
  if (s.schemaVersion !== 1 || !Number.isSafeInteger(s.revision) || s.revision! <= 0) return 'unavailable'
  if (s.status !== 'active' && s.status !== 'grace') return 'unavailable'
  const parse = (value: unknown) => typeof value === 'string' ? Date.parse(value) : NaN
  const server = parse(s.serverTime), from = parse(s.accessFrom), until = parse(s.accessUntil), cache = parse(s.cacheUntil)
  if (![server, from, until, cache].every(Number.isFinite) || from > server || until <= from || cache > until || cache > server + 86_400_000) return 'unavailable'
  const now = server + elapsedMs
  if (now >= until || now >= cache) return 'expired'
  return s.features && Object.prototype.hasOwnProperty.call(s.features, feature) && s.features[feature] === true ? 'allowed' : 'disabled'
}
