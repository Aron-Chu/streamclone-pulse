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
  label: string
}

export function coverageMeta(state: HubCoverageState): CoverageMeta {
  switch (state) {
    case 'synced':
      return { tone: 'synced', label: 'Synced' }
    case 'collecting':
      return { tone: 'collecting', label: 'Collecting' }
    case 'warming':
      return { tone: 'warming', label: 'Warming' }
    case 'chat_only':
      return { tone: 'chat', label: 'Chat only' }
    case 'viewer_only':
      return { tone: 'viewer', label: 'Viewers only' }
    case 'partial':
      return { tone: 'partial', label: 'Partial' }
    case 'stats_only':
      return { tone: 'stats', label: 'Stats-only' }
    default:
      return { tone: 'stats', label: 'Tracked' }
  }
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
