import type { HubCoverageState, HubEmote } from '../../../lib/publicHub'

/** 1234 -> "1.2K", 2_400_000 -> "2.4M". */
export function compact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '0'
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${trim(value / 1_000_000_000)}B`
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}M`
  if (abs >= 1_000) return `${trim(value / 1_000)}K`
  return `${Math.round(value)}`
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '')
}

export interface DeltaLabel {
  text: string
  tone: 'up' | 'down' | 'flat'
}

/** Backend momentum compares recent vs prior activity window (`windowTrendPct`). */
export const MOMENTUM_VS_PRIOR_LABEL = 'vs prior window'
export const MOMENTUM_TITLE =
  'Momentum: chat + emote activity in the recent window compared to the prior window of equal length.'
export const MOMENTUM_NO_SIGNAL_TITLE = 'Not enough recent chat or emote activity to measure momentum.'
export const MOMENTUM_COLUMN_TITLE = MOMENTUM_TITLE

/** @deprecated use MOMENTUM_* constants */
export const TREND_VS_PRIOR_5MIN_LABEL = MOMENTUM_VS_PRIOR_LABEL
/** @deprecated use MOMENTUM_TITLE */
export const TREND_VS_PRIOR_5MIN_TITLE = MOMENTUM_TITLE

export function deltaLabel(pct: number | null | undefined): DeltaLabel {
  if (pct == null || !Number.isFinite(pct) || Math.round(pct) === 0) {
    return { text: 'flat', tone: 'flat' }
  }
  const rounded = Math.round(pct)
  return rounded > 0
    ? { text: `▲ ${rounded}%`, tone: 'up' }
    : { text: `▼ ${Math.abs(rounded)}%`, tone: 'down' }
}

export interface CoverageMeta {
  /** css modifier suffix: synced | collecting | warming | chat | viewer | partial | stats */
  tone: 'synced' | 'collecting' | 'warming' | 'chat' | 'viewer' | 'partial' | 'stats'
  label: 'Chat tracked (IRC)' | 'Warming' | 'Metadata only — no chat coverage'
}

export function coverageMeta(state: HubCoverageState): CoverageMeta {
  switch (state) {
    case 'synced':
      return { tone: 'synced', label: 'Chat tracked (IRC)' }
    case 'collecting':
      return { tone: 'collecting', label: 'Chat tracked (IRC)' }
    case 'warming':
      return { tone: 'warming', label: 'Warming' }
    case 'chat_only':
      return { tone: 'chat', label: 'Chat tracked (IRC)' }
    case 'viewer_only':
      return { tone: 'viewer', label: 'Metadata only — no chat coverage' }
    case 'partial':
      return { tone: 'partial', label: 'Chat tracked (IRC)' }
    case 'stats_only':
      return { tone: 'stats', label: 'Metadata only — no chat coverage' }
    default:
      return { tone: 'stats', label: 'Metadata only — no chat coverage' }
  }
}

/** Context for Top movers empty/sparse honesty copy (IRC pool vs roster live). */
export interface TopMoversHonestyContext {
  rosterLive?: number
  collectorTracking?: number
  poolSize?: number
  windowMinutes?: number
}

export function formatTopMoversHonestyNote(
  ctx: TopMoversHonestyContext | undefined,
  moversCount: number,
): string | null {
  if (!ctx) return null
  const rosterLive = ctx.rosterLive ?? 0
  const collectorTracking = ctx.collectorTracking ?? 0
  if (rosterLive <= 0) return null
  if (moversCount >= 3) return null
  const windowMinutes = ctx.windowMinutes ?? 30
  const poolHint =
    ctx.poolSize != null && ctx.poolSize > 0
      ? ` Hub KPIs use a bounded IRC rollup pool (≤${compact(ctx.poolSize)} channels).`
      : ''
  return `Only ${compact(collectorTracking)} of ${compact(rosterLive)} live roster channels have IRC emote rollups in the last ${windowMinutes}m.${poolHint}`
}

export function formatMoverVelocity(mover: {
  emotesPerMin?: number
  seventvPerMin?: number
  chatPerMin?: number
}): { emoteLabel: string; chatLabel: string } {
  const emoteRate = Math.max(mover.emotesPerMin ?? 0, mover.seventvPerMin ?? 0)
  return {
    emoteLabel: `${compact(emoteRate)}/m`,
    chatLabel: `${compact(mover.chatPerMin ?? 0)} chat/m`,
  }
}

export function hubChatPerMinDisplay(channel: {
  chatPerMin: number
  coverageState?: HubCoverageState
}): { text: string; title?: string; muted?: boolean; showCoverageBadge?: boolean } {
  const state = channel.coverageState ?? ''
  const meta = coverageMeta(state)
  if (channel.chatPerMin > 0) {
    return { text: compact(channel.chatPerMin) }
  }
  if (state === 'stats_only' || state === 'viewer_only') {
    return {
      text: '—',
      title: `${meta.label}: no IRC chat rollups yet — 0 chat/min does not mean the channel is quiet on Twitch`,
      muted: true,
      showCoverageBadge: true,
    }
  }
  return {
    text: compact(channel.chatPerMin),
    title: channel.chatPerMin === 0 ? 'No chat rollups in the recent hub window' : undefined,
  }
}

export function isMetadataOnlyCoverage(state: HubCoverageState | undefined): boolean {
  return state === 'stats_only' || state === 'viewer_only'
}

/** Coverage percent -> table cell tone + color token. */
export function coveragePctMeta(pct: number): { cls: 'full' | 'mid' | 'low'; color: string } {
  if (pct >= 95) return { cls: 'full', color: 'hsl(var(--sc-chart-3))' }
  if (pct > 0) return { cls: 'mid', color: 'hsl(var(--sc-chart-4))' }
  return { cls: 'low', color: 'hsl(var(--sc-muted-foreground))' }
}

export function initial(login: string): string {
  return (login.trim()[0] || '?').toUpperCase()
}

export function displayName(login: string, name?: string): string {
  const trimmed = (name ?? '').trim()
  return trimmed.length > 0 ? trimmed : login
}

export type EmoteProviderKey = 'sevenTv' | 'twitch' | 'bttv' | 'ffz' | 'other'

const FALLBACK_PROVIDER_COLORS: Record<string, string> = {
  '7tv': '#86EFAC',
  seventv: '#86EFAC',
  twitch: '#8B5CF6',
  bttv: '#FB7185',
  ffz: '#FBBF24',
}

/** @deprecated Use getProviderColor — kept for tests and non-DOM contexts */
export const EMOTE_PROVIDER_COLORS: Record<EmoteProviderKey, string> = {
  sevenTv: FALLBACK_PROVIDER_COLORS.seventv,
  twitch: FALLBACK_PROVIDER_COLORS.twitch,
  bttv: FALLBACK_PROVIDER_COLORS.bttv,
  ffz: FALLBACK_PROVIDER_COLORS.ffz,
  other: 'var(--fma-muted, #52525b)',
}

export function providerCssVarKey(provider?: string): string {
  const lower = (provider ?? '').trim().toLowerCase()
  if (lower === '7tv' || lower === 'seventv') return '7tv'
  if (lower === 'twitch') return 'twitch'
  if (lower === 'bttv') return 'bttv'
  if (lower === 'ffz') return 'ffz'
  return lower || 'other'
}

export function getProviderColor(provider?: string, root?: HTMLElement | null): string {
  const key = providerCssVarKey(provider)
  if (typeof document !== 'undefined' && root) {
    const cssValue = getComputedStyle(root).getPropertyValue(`--sp-provider-${key}`).trim()
    if (cssValue) return cssValue
  }
  return FALLBACK_PROVIDER_COLORS[key] ?? EMOTE_PROVIDER_COLORS.other
}

export function emoteProviderKey(provider?: string): EmoteProviderKey {
  const lower = (provider ?? '').trim().toLowerCase()
  if (lower === '7tv' || lower === 'seventv') return 'sevenTv'
  if (lower === 'twitch') return 'twitch'
  if (lower === 'bttv') return 'bttv'
  if (lower === 'ffz') return 'ffz'
  return 'other'
}

export function emoteProviderColor(provider?: string, root?: HTMLElement | null): string {
  const key = emoteProviderKey(provider)
  if (key === 'other') return EMOTE_PROVIDER_COLORS.other
  return getProviderColor(provider, root)
}

export function providerLabel(provider?: string): string {
  const lower = (provider ?? '').trim().toLowerCase()
  if (lower === '7tv' || lower === 'seventv') return '7TV'
  if (lower === 'ffz') return 'FFZ'
  if (lower === 'bttv') return 'BTTV'
  if (lower === 'twitch') return 'Twitch'
  return provider?.trim() || 'Other'
}

export function emoteBadges(emote: Pick<HubEmote, 'provider' | 'zeroWidth' | 'animated'>): string[] {
  const badges = [providerLabel(emote.provider)]
  if (emote.zeroWidth) badges.push('OVERLAY')
  if (emote.animated) badges.push('ANIM')
  return badges
}

/**
 * Twitch live-stream preview thumbnail served from the public CDN over HTTPS.
 * Lets the hub show a "VOD preview" for any live login even when the hosted
 * payload only carries a login (e.g. Top-500 readiness rows without avatars).
 */
export function twitchLivePreviewUrl(login: string, width = 440, height = 248): string {
  const slug = login.trim().toLowerCase()
  return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${encodeURIComponent(slug)}-${width}x${height}.jpg`
}

/** Twitch preview CDN refreshes ~every few minutes; bucket cache-bust to match. */
export function twitchLivePreviewUrlFresh(login: string, width = 320, height = 180): string {
  const bucket = Math.floor(Date.now() / (3 * 60_000))
  return `${twitchLivePreviewUrl(login, width, height)}?t=${bucket}`
}

/** Human uptime from an ISO startedAt (e.g. "2h 14m"). */
export function formatStreamUptime(startedAt?: string): string {
  if (!startedAt?.trim()) return ''
  const ms = Date.parse(startedAt)
  if (!Number.isFinite(ms)) return ''
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const rem = min % 60
  if (h < 24) return rem > 0 ? `${h}h ${rem}m` : `${h}h`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`
}

export const LEADING_EMOTE_SHARE_TITLE =
  'Of every emote sent across tracked channels in this window, what share came from the single most-used emote? Example: if KEKW was used 2,900 times out of 10,000 total emotes, the #1 emote share is 29%.'

export interface LeadingEmoteShareCopy {
  label: string
  value: string
  sub: string
  title: string
}

/** Plain-language copy for the hub #1 emote share KPI. */
export function formatLeadingEmoteShare(
  topEmotes: Pick<HubEmote, 'name' | 'sharePct'>[],
  topEmoteSharePct: number,
): LeadingEmoteShareCopy {
  const leader = topEmotes[0]
  const pct = topEmoteSharePct > 0 ? Math.round(topEmoteSharePct) : 0
  const value = pct > 0 ? `${pct}%` : '—'
  const name = leader?.name?.trim()
  const sub =
    name && pct > 0
      ? `${name} · ${pct}% of all emotes in this window`
      : pct > 0
        ? `${pct}% of all emotes came from the #1 emote`
        : 'Shows when emote rollups exist for this window'
  return {
    label: '#1 emote share',
    value,
    sub,
    title: LEADING_EMOTE_SHARE_TITLE,
  }
}
