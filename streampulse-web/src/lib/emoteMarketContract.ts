/**
 * Public Emote Market contract (P2).
 * Breadth / rotation / co-movement require sanitized backend aggregations.
 * Until those fields exist on `/v1/public/hub`, UI modules that need them stay gated.
 */

export type EmoteMarketView = 'leaders' | 'breadth' | 'concentration' | 'rotation' | 'provider'

export interface HubEmoteMarketWatermark {
  /** Inclusive range start (unix ms). */
  rangeStart: number
  /** Inclusive range end (unix ms). */
  rangeEnd: number
  /** Server generation time (ISO or unix ms string). */
  measuredAt: string
  activityWindow?: string
}

/** Share of measured live channels using an emote in the range — backend-owned. */
export interface HubEmoteBreadthRow {
  name: string
  provider?: string
  channelSharePct: number
  channelCount: number
  measuredChannels: number
}

/** Equal-window rank change — backend-owned; do not invent from client poll history. */
export interface HubEmoteRotationRow {
  name: string
  provider?: string
  rank: number
  previousRank?: number
  rankDelta?: number
  status: 'entrant' | 'gainer' | 'loser' | 'stable' | 'exit'
}

export interface HubEmoteMarket {
  watermark: HubEmoteMarketWatermark
  breadth?: HubEmoteBreadthRow[]
  rotation?: HubEmoteRotationRow[]
  /** Top-N concentration shares (e.g. top1 / top5 / top10). */
  concentration?: {
    top1SharePct?: number
    top5SharePct?: number
    top10SharePct?: number
  }
}

const ROTATION_STATUSES = new Set([
  'entrant',
  'gainer',
  'loser',
  'stable',
  'exit',
])

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeBreadthRow(raw: unknown): HubEmoteBreadthRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  if ('clientSharePct' in row || 'localRank' in row) return null
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  const channelSharePct = finiteNumber(row.channelSharePct)
  const channelCount = finiteNumber(row.channelCount)
  const measuredChannels = finiteNumber(row.measuredChannels)
  if (!name || channelSharePct == null || channelCount == null || measuredChannels == null) {
    return null
  }
  if (channelSharePct < 0 || channelSharePct > 100) return null
  if (channelCount < 0 || measuredChannels < 0) return null
  if (channelCount > measuredChannels) return null
  return {
    name,
    provider: typeof row.provider === 'string' ? row.provider : undefined,
    channelSharePct,
    channelCount,
    measuredChannels,
  }
}

function normalizeRotationRow(raw: unknown): HubEmoteRotationRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  if ('pollHistoryDelta' in row || 'clientRank' in row) return null
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  const rank = finiteNumber(row.rank)
  const status = typeof row.status === 'string' ? row.status : ''
  if (!name || rank == null || rank < 1 || !ROTATION_STATUSES.has(status)) return null
  const previousRank =
    row.previousRank === undefined ? undefined : finiteNumber(row.previousRank) ?? undefined
  const rankDelta = row.rankDelta === undefined ? undefined : finiteNumber(row.rankDelta) ?? undefined
  if (row.previousRank !== undefined && previousRank == null) return null
  if (row.rankDelta !== undefined && rankDelta == null) return null
  return {
    name,
    provider: typeof row.provider === 'string' ? row.provider : undefined,
    rank,
    previousRank: previousRank != null && previousRank >= 1 ? previousRank : undefined,
    rankDelta,
    status: status as HubEmoteRotationRow['status'],
  }
}

function normalizeConcentration(
  raw: unknown,
): HubEmoteMarket['concentration'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const row = raw as Record<string, unknown>
  const out: NonNullable<HubEmoteMarket['concentration']> = {}
  for (const key of ['top1SharePct', 'top5SharePct', 'top10SharePct'] as const) {
    if (!(key in row)) continue
    const n = finiteNumber(row[key])
    if (n == null || n < 0 || n > 100) return undefined
    out[key] = n
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function normalizeHubEmoteMarket(raw: unknown): HubEmoteMarket | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  if ('clientPollHistory' in row || 'localLeaders' in row) return null

  const watermarkRaw = row.watermark
  if (!watermarkRaw || typeof watermarkRaw !== 'object' || Array.isArray(watermarkRaw)) {
    return null
  }
  const wm = watermarkRaw as Record<string, unknown>
  const rangeStart = finiteNumber(wm.rangeStart)
  const rangeEnd = finiteNumber(wm.rangeEnd)
  const measuredAt = typeof wm.measuredAt === 'string' ? wm.measuredAt.trim() : ''
  if (rangeStart == null || rangeEnd == null || !measuredAt) return null
  if (rangeEnd < rangeStart) return null

  const breadth = Array.isArray(row.breadth)
    ? row.breadth.map(normalizeBreadthRow).filter((r): r is HubEmoteBreadthRow => r != null)
    : undefined
  const rotation = Array.isArray(row.rotation)
    ? row.rotation.map(normalizeRotationRow).filter((r): r is HubEmoteRotationRow => r != null)
    : undefined

  // Hostile: claimed array present but every row malformed → reject market block.
  if (Array.isArray(row.breadth) && row.breadth.length > 0 && (breadth?.length ?? 0) === 0) {
    return null
  }
  if (Array.isArray(row.rotation) && row.rotation.length > 0 && (rotation?.length ?? 0) === 0) {
    return null
  }

  return {
    watermark: {
      rangeStart,
      rangeEnd,
      measuredAt,
      activityWindow: typeof wm.activityWindow === 'string' ? wm.activityWindow : undefined,
    },
    breadth: breadth && breadth.length > 0 ? breadth : undefined,
    rotation: rotation && rotation.length > 0 ? rotation : undefined,
    concentration: normalizeConcentration(row.concentration),
  }
}

export function emoteMarketModuleAvailable(
  market: HubEmoteMarket | null | undefined,
  view: EmoteMarketView,
): boolean {
  if (view === 'leaders' || view === 'provider' || view === 'concentration') return true
  if (!market) return false
  if (view === 'breadth') return (market.breadth?.length ?? 0) > 0
  if (view === 'rotation') return (market.rotation?.length ?? 0) > 0
  return false
}
