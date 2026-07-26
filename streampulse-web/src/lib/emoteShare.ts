import type { FigmaEmoteBurst } from './figmaSessionAnalytics'
import type { HubEmote } from './publicHub'

export const ESTIMATED_SHARE_TITLE = 'Estimated from raw counts in this panel — not a backend rollup share.'
export const BACKEND_SHARE_TITLE = 'Share of counted emote sends in this window (from backend rollups).'

export interface EmoteShareRow {
  sharePct: number
  shareEstimated: boolean
}

export function isBackendSharePct(sharePct: number | null | undefined): boolean {
  return sharePct != null && Number.isFinite(sharePct) && sharePct > 0
}

export function computeSharePctFromCounts(count: number, total: number): number | undefined {
  if (total <= 0 || count <= 0) return undefined
  return Math.round((count / total) * 1000) / 10
}

export function resolveEmoteShare(
  count: number | undefined,
  sharePct: number | undefined,
  total: number,
): EmoteShareRow | null {
  const normalizedCount = Math.max(0, count ?? 0)
  if (isBackendSharePct(sharePct)) {
    return { sharePct: sharePct!, shareEstimated: false }
  }
  const estimated = computeSharePctFromCounts(normalizedCount, total)
  if (estimated == null) return null
  return { sharePct: estimated, shareEstimated: true }
}

export type HubEmoteWithShare = HubEmote & EmoteShareRow

export function withComputedSharePct(emotes: HubEmote[]): HubEmoteWithShare[] {
  const total = emotes.reduce((sum, emote) => sum + Math.max(0, emote.count ?? 0), 0)
  return emotes.map((emote) => {
    const resolved = resolveEmoteShare(emote.count, emote.sharePct, total)
    if (!resolved) return { ...emote, sharePct: 0, shareEstimated: false }
    return { ...emote, sharePct: resolved.sharePct, shareEstimated: resolved.shareEstimated }
  })
}

export type FigmaEmoteBurstWithShare = FigmaEmoteBurst & EmoteShareRow

export function withComputedBurstShare(bursts: FigmaEmoteBurst[]): FigmaEmoteBurstWithShare[] {
  const total = bursts.reduce((sum, burst) => sum + Math.max(0, burst.count ?? 0), 0)
  return bursts.map((burst) => {
    const resolved = resolveEmoteShare(burst.count, burst.sharePct, total)
    if (!resolved) return { ...burst, sharePct: 0, shareEstimated: false }
    return { ...burst, sharePct: resolved.sharePct, shareEstimated: resolved.shareEstimated }
  })
}

export function formatSharePctLabel(sharePct: number): string {
  if (!Number.isFinite(sharePct) || sharePct <= 0) return '—'
  return sharePct < 10 ? `${sharePct.toFixed(1)}%` : `${Math.round(sharePct)}%`
}
