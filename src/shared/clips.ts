import type { ExtensionClip } from './messages.ts'

/** Only clips whose creation timestamps fall inside this live stream window. */
export function selectStreamClips(items: ExtensionClip[], startedAt: string, endedAt: string): ExtensionClip[] {
  const start = Date.parse(startedAt)
  const end = Date.parse(endedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []
  const seen = new Set<string>()
  return items.filter(clip => {
    const created = Date.parse(clip.createdAt ?? '')
    if (!clip.id || seen.has(clip.id) || !Number.isFinite(created) || created < start || created > end) return false
    seen.add(clip.id)
    return true
  }).sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0)).slice(0, 10)
}

/** Pick the clip with the highest viewCount; null when empty or all zero views. */
export function pickTopClip(items: ExtensionClip[]): ExtensionClip | null {
  if (items.length === 0) return null
  let best: ExtensionClip | null = null
  for (const clip of items) {
    const views = clip.viewCount ?? 0
    if (!best || views > (best.viewCount ?? 0)) {
      best = clip
    }
  }
  return best
}

export function clipWindowBounds(
  startedAt?: string,
  isLive?: boolean,
): { startedAt: string; endedAt: string } {
  const now = new Date()
  const endedAt = now.toISOString()
  if (startedAt && isLive) {
    return { startedAt, endedAt }
  }
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  return { startedAt: weekAgo.toISOString(), endedAt }
}
