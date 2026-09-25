import { apiClient } from './apiClient'
import type { DiscoveryDay } from './discoveryCatalogue'

const DAY_MS = 86_400_000
const MAX_CERTIFICATE_AGE_MS = 2 * 60 * 60 * 1000
export const CERTIFIED_HISTORY_DAYS = 30

export interface RankedAvailability {
  asOf: string
  serverToday: string
  certifiedFrom: string
  certifiedThroughExclusive: string
  verifiedAt: string
  certificateGeneration: number
  login: string
  days: DiscoveryDay[]
}

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const day = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString().slice(0, 10) === value
const instant = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|\+00:00)$/.test(value)
  && Number.isFinite(Date.parse(value))
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function certifiedWindowStart(certifiedFrom: string, serverToday: string) {
  return certifiedFrom > utcDay(Date.parse(serverToday) - CERTIFIED_HISTORY_DAYS * DAY_MS)
    ? certifiedFrom : utcDay(Date.parse(serverToday) - CERTIFIED_HISTORY_DAYS * DAY_MS)
}

/** Only the ranked availability route can establish calendar and retention evidence. */
export function normalizeRankedAvailability(value: unknown, requestedLogin = ''): RankedAvailability {
  const body = record(value)
  const invalid = (): never => { throw new Error('The certified date range could not be verified.') }
  if (body.schemaVersion !== 1 || body.state !== 'ready' || body.scope !== 'indexed_completed_public_irc_streams' || body.login !== requestedLogin
    || !count(body.certificateGeneration) || body.certificateGeneration < 1
    || !instant(body.asOf) || !instant(body.verifiedAt) || !day(body.serverToday)
    || !day(body.certifiedFrom) || !day(body.certifiedThroughExclusive)
    || body.serverToday !== body.asOf.slice(0, 10)
    || body.certifiedFrom >= body.certifiedThroughExclusive || body.certifiedThroughExclusive > body.serverToday
    || Date.parse(body.verifiedAt) > Date.parse(body.asOf)
    || Date.parse(body.asOf) - Date.parse(body.verifiedAt) >= MAX_CERTIFICATE_AGE_MS
    || !Array.isArray(body.days)) return invalid()

  const from = certifiedWindowStart(body.certifiedFrom, body.serverToday)
  const length = (Date.parse(body.certifiedThroughExclusive) - Date.parse(from)) / DAY_MS
  if (!Number.isInteger(length) || length < 1 || length > CERTIFIED_HISTORY_DAYS || body.days.length !== length) return invalid()
  const days: DiscoveryDay[] = body.days.map((value, index) => {
    const entry = record(value)
    if (entry.day !== utcDay(Date.parse(from) + index * DAY_MS) || !count(entry.streams) || !count(entry.measuredStreamMinutes)) return invalid()
    if (entry.state === 'measured') {
      if (entry.coverage !== 'partial' || entry.streams === 0 || entry.measuredStreamMinutes === 0
        || !count(entry.chatMessages) || !count(entry.emoteUses) || !count(entry.detections)) return invalid()
    } else if (entry.state !== 'no_measurement' || entry.coverage !== 'none' || entry.streams !== 0
      || entry.measuredStreamMinutes !== 0 || entry.chatMessages !== null || entry.emoteUses !== null
      || entry.detections !== null) return invalid()
    return entry as unknown as DiscoveryDay
  })
  return { asOf: body.asOf, serverToday: body.serverToday, certifiedFrom: body.certifiedFrom,
    certifiedThroughExclusive: body.certifiedThroughExclusive, verifiedAt: body.verifiedAt,
    certificateGeneration: body.certificateGeneration,
    login: requestedLogin, days }
}

export async function fetchRankedAvailability(login: string, signal: AbortSignal) {
  if (login && !/^[a-z0-9_]{1,25}$/.test(login)) throw new Error('Choose a valid creator login.')
  const query = new URLSearchParams()
  if (login) query.set('login', login)
  const suffix = query.size ? `?${query}` : ''
  const { data } = await apiClient<unknown>(`/v1/public/discovery/ranked/availability${suffix}`, { signal, timeoutMs: 8000, maxResponseBytes: 150_000 })
  return normalizeRankedAvailability(data, login)
}
