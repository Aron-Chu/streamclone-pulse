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
